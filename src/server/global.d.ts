declare module "geojson2shp" {
  import { GeoJSON } from "geojson";
  import * as stream from "stream";

  interface ConvertOptions {
    readonly layer?: string;
    readonly sourceCrs?: number;
    readonly targetCrs?: number;
  }

  export function convert(
    input: string | GeoJSON,
    output: string | stream.Writable,
    options?: ConvertOptions
  ): Promise<void>;
}

declare module "simplify-geojson" {
  import { GeoJSON } from "geojson";

  export function simplify(feature: GeoJSON, tolerance?: number): void;
}

declare module "geobuf" {
  import Pbf = require("pbf");
  import { GeoJSON } from "geojson";
  import { Topology } from "topojson-specification";

  export function decode(pbf: Pbf): GeoJSON | Topology;
  export function encode(obj: GeoJSON | Topology, pbf: Pbf): Uint8Array;
}
