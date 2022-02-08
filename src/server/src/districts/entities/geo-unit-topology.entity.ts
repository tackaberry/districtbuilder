import {
  GeometryCollection,
  GeometryObject,
  MultiPolygon,
  Polygon,
  Topology
} from "topojson-specification";
import * as _ from "lodash";
import { spawn, Pool, Worker } from "threads";
import * as geobuf from "geobuf";

import {
  GeoUnitDefinition,
  HierarchyDefinition,
  IStaticMetadata,
  TypedArrays,
  DistrictsDefinition,
  GeoUnitHierarchy,
  IRegionConfig,
  IUser,
  IChamber
} from "../../../../shared/entities";
import { DistrictsGeoJSON } from "../../projects/entities/project.entity";
import { Functions } from "../../worker";
import Pbf from "pbf";

const workerPool = Pool(() => spawn<Functions>(new Worker("../../worker")));

export async function terminatePool() {
  return workerPool.terminate();
}

type GroupedPolygons = {
  [groupName: string]: { [geounitId: string]: ReadonlyArray<Polygon | MultiPolygon> };
};

// Groups a topology into a hierarchy of geounits corresponding to a geo unit definition structure.
// Note: this function, along with getNodeForHierarchy are copy-pasted directly (w/rename) from
// process-geojson. We will need to fix #179 before we can share such code among projects.
function groupForHierarchy(topology: Topology, definition: GeoUnitDefinition): HierarchyDefinition {
  const geounitsByParentId = definition.groups.map((groupName, index) => {
    const parentCollection = topology.objects[groupName] as GeometryCollection;
    const mutableMappings: {
      [geounitId: string]: Array<Polygon | MultiPolygon>;
    } = Object.fromEntries(
      parentCollection.geometries.map((geom: GeometryObject<any>) => [
        geom.properties[groupName],
        []
      ])
    );
    const childGroupName = definition.groups[index + 1];
    if (childGroupName) {
      const childCollection = topology.objects[childGroupName] as GeometryCollection<any>;
      childCollection.geometries.forEach((geometry: GeometryObject<any>) => {
        if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
          mutableMappings[geometry.properties[groupName]].push(geometry);
        }
      });
    }
    return [groupName, mutableMappings];
  });

  const firstGroup = definition.groups[0];
  const toplevelCollection = topology.objects[firstGroup] as GeometryCollection<any>;
  const geounits: GroupedPolygons = Object.fromEntries(geounitsByParentId);
  return toplevelCollection.geometries.map(geom => getNodeForHierarchy(geom, definition, geounits));
}

// Helper for recursively collecting geounit hierarchy node information
function getNodeForHierarchy(
  geometry: GeometryObject<any>,
  definition: GeoUnitDefinition,
  geounitsByParentId: GroupedPolygons
): HierarchyDefinition {
  const firstGroup = definition.groups[0];
  const remainingGroups = definition.groups.slice(1);
  const geomId = geometry.properties[firstGroup];
  const childGeoms = geounitsByParentId[firstGroup][geomId];

  // Recurse until we get to the base geolevel, at which point we list the base geounit indices
  // eslint-disable-next-line
  return remainingGroups.length > 1
    ? childGeoms.map(childGeom =>
        getNodeForHierarchy(
          childGeom as GeometryObject<any>,
          { ...definition, groups: remainingGroups },
          geounitsByParentId
        )
      )
    : // eslint-disable-next-line
      childGeoms.map((childGeom: any) => childGeom.id);
}

export class GeoUnitTopology {
  public readonly hierarchySize: number;

  constructor(
    public readonly topology: Uint8Array,
    public readonly definition: GeoUnitDefinition,
    public readonly staticMetadata: IStaticMetadata,
    public readonly demographics: TypedArrays,
    public readonly voting: TypedArrays,
    public readonly geoLevels: TypedArrays
  ) {
    const topo = geobuf.decode(new Pbf(this.topology)) as Topology;
    const firstGroup = definition.groups[0];
    const toplevelCollection = topo.objects[firstGroup] as GeometryCollection<any>;
    this.hierarchySize = toplevelCollection.geometries.length;
  }

  /*
   * Performs a merger of the specified districts into a GeoJSON collection,
   * or returns null if the district definition is invalid
   */
  async merge({
    districtsDefinition,
    numberOfDistricts,
    user,
    chamber,
    regionConfig
  }: {
    readonly districtsDefinition: DistrictsDefinition;
    readonly numberOfDistricts: number;
    readonly user: IUser;
    readonly chamber?: IChamber;
    readonly regionConfig: IRegionConfig;
  }): Promise<DistrictsGeoJSON | null> {
    return workerPool.queue(worker =>
      worker.merge({
        districtsDefinition,
        numberOfDistricts,
        user,
        chamber,
        regionConfig,
        definition: this.definition,
        staticMetadata: this.staticMetadata,
        topologyBuf: this.topology,
        demographics: this.demographics,
        voting: this.voting,
        geoLevels: this.geoLevels
      })
    );
  }

  importFromCSV(blockToDistricts: { readonly [block: string]: number }): DistrictsDefinition {
    const baseGeoLevel = this.definition.groups.slice().reverse()[0];
    const baseGeoUnitProperties = this.topologyProperties[baseGeoLevel];

    // The geounit hierarchy and district definition have the same structure (except the
    // hierarchy always goes out to the base geounit level), so we use it as a starting point
    // and transform it into our districts definition.
    const mapToDefinition = (hierarchySubset: GeoUnitHierarchy): DistrictsDefinition =>
      hierarchySubset.map(hierarchyNumOrArray => {
        if (typeof hierarchyNumOrArray === "number") {
          // The numbers found in the hierarchy are the base geounit indices of the topology.
          // Access this item in the topology to find it's base geounit id.
          const props: any = baseGeoUnitProperties[hierarchyNumOrArray];
          const id = props[baseGeoLevel];
          return blockToDistricts[id] || 0;
        } else {
          // Keep recursing into the hierarchy until we reach the end
          const results = mapToDefinition(hierarchyNumOrArray);
          // Simplify if possible
          return results.length !== 1 && results.every(item => item === results[0])
            ? results[0]
            : results;
        }
      });

    return mapToDefinition(this.hierarchyDefinition);
  }

  get topologyProperties() {
    const topology = geobuf.decode(new Pbf(this.topology)) as Topology;
    return _.mapValues(topology.objects, collection =>
      collection.type === "GeometryCollection"
        ? collection.geometries.map(feature => feature.properties || {})
        : []
    );
  }

  // Generates the geounit hierarchy corresponding to a geo unit definition structure
  get hierarchyDefinition() {
    const topology = geobuf.decode(new Pbf(this.topology)) as Topology;
    const geoLevelIds = this.staticMetadata.geoLevelHierarchy.map(level => level.id);
    const definition = { groups: geoLevelIds.slice().reverse() };
    return groupForHierarchy(topology, definition);
  }
}
