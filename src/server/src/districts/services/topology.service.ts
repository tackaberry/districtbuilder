import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import S3 from "aws-sdk/clients/s3";
import { spawn } from "child_process";
import { cpus } from "os";
import { Repository } from "typeorm";

import { TypedArrays, IStaticFile, IStaticMetadata, S3URI } from "../../../../shared/entities";
import { RegionConfig } from "../../region-configs/entities/region-config.entity";
import { GeoUnitTopology } from "../entities/geo-unit-topology.entity";
import { GeoUnitProperties } from "../entities/geo-unit-properties.entity";
import _ from "lodash";
import { getObject, s3Options } from "../../common/s3-wrapper";

const MAX_RETRIES = 5;
// Loading a topojson layer is a mix of I/O and CPU intensive work,
// so we can afford to have more layers loading than we have cores, but not too many
const BATCH_SIZE = cpus().length * 2;
// 10 largest states by geojson file size
const STATE_ORDER = ["TX", "CA", "PA", "FL", "NC", "MO", "NY", "IL", "TN", "VA"];

type Layer = Promise<GeoUnitTopology | GeoUnitProperties | undefined>;

interface Layers {
  [s3URI: string]: null | Layer;
}

// https://stackoverflow.com/a/48007240
async function asyncLoop<T>(asyncFns: ReadonlyArray<() => Promise<T>>, concurrent = 5) {
  // queue up simultaneous calls
  const queue: Promise<T>[] = [];
  // eslint-disable-next-line functional/no-loop-statement
  for (const fn of asyncFns) {
    // fire the async function, add its promise to the queue, and remove
    // it from queue when complete
    const p = fn().then(res => {
      // eslint-disable-next-line functional/immutable-data
      queue.splice(queue.indexOf(p), 1);
      return res;
    });
    // eslint-disable-next-line functional/immutable-data
    queue.push(p);
    // if max concurrent, wait for one to finish
    if (queue.length >= concurrent) {
      await Promise.race(queue);
    }
  }
  // wait for the rest of the calls to finish
  await Promise.all(queue);
}

@Injectable()
export class TopologyService {
  private _layers?: Layers = undefined;
  private readonly logger = new Logger(TopologyService.name);
  private readonly s3 = new S3();

  constructor(@InjectRepository(RegionConfig) private readonly repo: Repository<RegionConfig>) {}

  public loadLayers() {
    void this.repo.find().then(regionConfigs => {
      const getLayers = async () => {
        // eslint-disable-next-line functional/immutable-data
        this._layers = regionConfigs.reduce(
          (layers, regionConfig) => ({
            ...layers,
            [regionConfig.s3URI]: null
          }),
          {}
        );
        // Load largest states first
        const sortedRegions = _.sortBy(regionConfigs, region => [
          !STATE_ORDER.includes(region.regionCode),
          STATE_ORDER.indexOf(region.regionCode)
        ]);

        // Load a number of regions in parallel, adding another as each one completes
        await asyncLoop(
          sortedRegions.map(region => () => {
            const promise = this.fetchLayer(region.s3URI, region.archived);
            // eslint-disable-next-line functional/immutable-data
            this._layers = { ...this._layers, [region.s3URI]: promise };
            return promise;
          }),
          BATCH_SIZE
        );
      };
      void getLayers();
    });
  }

  public layers(): Readonly<Layers> | undefined {
    return this._layers && Object.freeze({ ...this._layers });
  }

  public async get(s3URI: S3URI): Promise<GeoUnitTopology | GeoUnitProperties | undefined> {
    if (!this._layers) {
      return;
    }
    if (!(s3URI in this._layers)) {
      // If we encounter a new layer (i.e. one added after the service has started),
      // then store the results in the `_layers` object.
      // @ts-ignore
      // eslint-disable-next-line functional/immutable-data
      this._layers[s3URI] = this.fetchLayer(s3URI).catch(err => {
        this.logger.error(err);
      });
    }
    const layer = this._layers[s3URI];
    if (layer !== null) {
      return layer;
    }
  }

  private async fetchLayer(
    s3URI: S3URI,
    archived: boolean,
    numRetries = 0
  ): Promise<GeoUnitTopology | GeoUnitProperties | undefined> {
    try {
      const [topojsonResponse, staticMetadataResponse] = await Promise.all([
        getObject(this.s3, s3Options(s3URI, "topo.buf")),
        getObject(this.s3, s3Options(s3URI, "static-metadata.json"))
      ]);

      const staticMetadataBody = staticMetadataResponse.Body?.toString("utf8");
      const topojsonBody = topojsonResponse.Body as Buffer;
      if (staticMetadataBody && topojsonBody) {
        const staticMetadata = JSON.parse(staticMetadataBody) as IStaticMetadata;
        const geoLevelHierarchy = staticMetadata.geoLevelHierarchy.map(gl => gl.id);
        if (!geoLevelHierarchy) {
          this.logger.error(`geoLevelHierarchy missing from static metadata for ${s3URI}`);
        }
        const topology = new Uint8Array(new SharedArrayBuffer(topojsonBody.length));
        topology.set(topojsonBody);
        const [demographics, geoLevels, voting] = await Promise.all([
          this.fetchStaticFiles(s3URI, staticMetadata.demographics),
          this.fetchStaticFiles(s3URI, staticMetadata.geoLevels),
          this.fetchStaticFiles(s3URI, staticMetadata.voting || [])
        ]);

        this.logger.debug(`downloaded data for s3URI ${s3URI}`);
        const geoUnitTopology = new GeoUnitTopology(
          topology,
          { groups: geoLevelHierarchy.slice().reverse() },
          staticMetadata,
          demographics,
          voting,
          geoLevels
        );
        // For archived read-only regions, we get the properties of the topology (which are used for exports)
        // and let the much larger TopoJSON geometries get garbage collected
        return archived ? GeoUnitProperties.fromTopology(geoUnitTopology) : geoUnitTopology;
      } else {
        this.logger.error("Invalid TopoJSON or metadata bodies");
      }
    } catch (err) {
      this.logger.error(
        `Failed to load topology for '${s3URI}' ${numRetries + 1} times, err ${err}`
      );
      if (numRetries < MAX_RETRIES) {
        return this.fetchLayer(s3URI, archived, numRetries + 1);
      } else {
        // Nest spawns multiple processes, so to shutdown the main container process we need to
        // kill all running node instances
        spawn("pkill", ["node"]).once("exit", () => {
          process.exit(1);
        });
      }
    }
  }

  private async fetchStaticFiles(path: S3URI, files: readonly IStaticFile[]): Promise<TypedArrays> {
    const requests = files.map(fileMeta => getObject(this.s3, s3Options(path, fileMeta.fileName)));

    return new Promise((resolve, reject) => {
      Promise.all(requests)
        .then(response =>
          resolve(
            response.map((res, ind) => {
              const bpe = files[ind].bytesPerElement;
              const unsigned = files[ind].unsigned;
              const typedArrayConstructor =
                unsigned || unsigned === undefined
                  ? bpe === 1
                    ? Uint8Array
                    : bpe === 2
                    ? Uint16Array
                    : Uint32Array
                  : bpe === 1
                  ? Int8Array
                  : bpe === 2
                  ? Int16Array
                  : Int32Array;

              // Note this is different from how we construct these typed
              // arrays on the client, due to differences in how Buffer works
              // in Node.js (see https://nodejs.org/api/buffer.html)
              const buf = res.Body as Buffer;
              const typedArray = new typedArrayConstructor(buf.buffer);
              const sharedBuffer = new typedArrayConstructor(
                new SharedArrayBuffer(buf.byteLength + buf.byteOffset)
              );
              sharedBuffer.set(typedArray, 0);
              return sharedBuffer;
            })
          )
        )
        .catch(error => reject(error.message));
    });
  }
}
