import area from "@turf/area";
import length from "@turf/length";
import polygonToLine from "@turf/polygon-to-line";
import { Feature, MultiPolygon as GeoJSONMultiPolygon } from "geojson";
import LRU from "lru-cache";
import os from "os";
import _ from "lodash";
import { expose } from "threads/worker";
import * as topojson from "topojson-client";
import {
  GeometryCollection,
  GeometryObject,
  MultiPolygon,
  Polygon,
  Topology
} from "topojson-specification";
import Pbf from "pbf";
import * as geobuf from "geobuf";

import {
  Contiguity,
  DistrictsDefinition,
  IUser,
  IChamber,
  IRegionConfig,
  GeoUnitCollection,
  GeoUnitDefinition,
  IStaticMetadata,
  TypedArrays,
  DistrictProperties,
  S3URI
} from "../../shared/entities";
import { getAllBaseIndices, getDemographics, getVoting } from "../../shared/functions";
import { DistrictsGeoJSON } from "./projects/entities/project.entity";

interface GeoUnitPolygonHierarchy {
  geom: Polygon | MultiPolygon;
  children: ReadonlyArray<GeoUnitPolygonHierarchy>;
}

type GroupedPolygons = {
  [groupName: string]: { [geounitId: string]: ReadonlyArray<Polygon | MultiPolygon> };
};

type FeatureProperties = Pick<DistrictProperties, "demographics" | "voting">;

// @ts-ignore
const cachedTopology = new LRU<string, Topology>({
  maxSize: Math.ceil(os.totalmem() / (os.cpus().length + 2))
});

function getOrDecode(s3URI: S3URI, topologyBuf: Uint8Array) {
  const cachedLayer = cachedTopology.get(s3URI);
  if (cachedLayer) {
    return cachedLayer;
  }
  const layer = geobuf.decode(new Pbf(topologyBuf)) as Topology;
  cachedTopology.set(s3URI, layer);
  return layer;
}

// Creates a list of trees for the nested geometries of the geounits
// This matches the possible structure of the DistrictDefinition
//
// We'll walk this hierarchy in conjuction with the district definition later
// to get the geometries needed to build our GeoJSON
function group(
  topology: Topology,
  definition: GeoUnitDefinition
): ReadonlyArray<GeoUnitPolygonHierarchy> {
  // Run through all topology objects in a single pass and build up a list of
  // them keyed by their parent geometries ID, which we'll use to quickly look
  // up child geometries when we build up our list of trees later in getNode
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
      const childCollection = topology.objects[childGroupName] as GeometryCollection;
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
  return toplevelCollection.geometries.map(geom => getNode(geom, definition, geounits));
}

function getNode(
  geometry: GeometryObject<any>,
  definition: GeoUnitDefinition,
  geounitsByParentId: GroupedPolygons
): GeoUnitPolygonHierarchy {
  const firstGroup = definition.groups[0];
  const remainingGroups = definition.groups.slice(1);
  const geomId = geometry.properties[firstGroup];
  const childGeoms = geounitsByParentId[firstGroup][geomId];
  return {
    geom: geometry,
    children: childGeoms.map(childGeom =>
      getNode(childGeom, { ...definition, groups: remainingGroups }, geounitsByParentId)
    )
  } as GeoUnitPolygonHierarchy;
}

/*
 * Calculate Polsby-Popper compactness
 *
 * See https://fisherzachary.github.io/public/r-output.html#polsby-popper
 */
function calcPolsbyPopper(feature: Feature): [number, Contiguity] {
  if (
    feature.geometry &&
    feature.geometry.type === "MultiPolygon" &&
    feature.geometry.coordinates.length === 0
  ) {
    return [0, ""];
  }
  if (
    feature.geometry &&
    feature.geometry.type === "MultiPolygon" &&
    feature.geometry.coordinates.length > 1
  ) {
    return [0, "non-contiguous"];
  }
  const districtArea: number = area(feature);
  // @ts-ignore
  const outline = polygonToLine(feature);
  const districtPerimeter: number = length(outline, { units: "meters" });
  return [(4 * Math.PI * districtArea) / districtPerimeter ** 2, "contiguous"];
}

function merge({
  districtsDefinition,
  numberOfDistricts,
  user,
  chamber,
  regionConfig,
  definition,
  staticMetadata,
  topologyBuf,
  demographics,
  voting,
  geoLevels
}: {
  readonly districtsDefinition: DistrictsDefinition;
  readonly numberOfDistricts: number;
  readonly user: IUser;
  readonly chamber?: IChamber;
  readonly regionConfig: IRegionConfig;
  readonly definition: GeoUnitDefinition;
  readonly staticMetadata: IStaticMetadata;
  readonly topologyBuf: Uint8Array;
  readonly demographics: TypedArrays;
  readonly voting: TypedArrays;
  readonly geoLevels: TypedArrays;
}): DistrictsGeoJSON | null {
  const topology = getOrDecode(regionConfig.s3URI, topologyBuf);
  const hierarchy = group(topology, definition);
  // mutableDistrictGeoms contains the individual geometries prior to being merged
  // indexed by district id then by geolevel index
  const mutableDistrictGeoms: Array<Array<Array<MultiPolygon | Polygon>>> = Array.from(
    Array(numberOfDistricts + 1)
  ).map(_ => staticMetadata.geoLevelHierarchy.map(_ => []));
  const addToDistrict = (
    elem: GeoUnitCollection,
    hierarchy: GeoUnitPolygonHierarchy,
    level = 0
  ): boolean => {
    if (Array.isArray(elem)) {
      // If the array length doesn't match the length of our current place in
      // the hierarchy, the district definition is invalid
      if (elem.length !== hierarchy.children.length) {
        return false;
      }
      return elem.every((subelem: GeoUnitCollection, idx: number) =>
        addToDistrict(subelem, hierarchy.children[idx], level + 1)
      );
    } else if (typeof elem === "number" && elem >= 0) {
      const districtIndex = elem;
      mutableDistrictGeoms[districtIndex][level].push(hierarchy.geom);
      return true;
    }
    // Elements that are not non-negative numbers or arrays of the same are invalid
    return false;
  };

  const valid =
    districtsDefinition.length === hierarchy.length &&
    districtsDefinition.every((elem, idx) => addToDistrict(elem, hierarchy[idx]));

  if (!valid) {
    return null;
  }

  const merged = mutableDistrictGeoms.map((geometries, idx) => {
    const mutableGeom = topojson.mergeArcs(topology, geometries.flat());
    const baseIndices = geometries.reduce((indices: number[], levelGeometries, levelIndex) => {
      const levelIds = levelGeometries
        .map(geom => geom.id)
        .filter(id => id !== undefined && typeof id === "number") as number[];
      const levelIndices = getAllBaseIndices(geoLevels.slice().reverse(), levelIndex, levelIds);
      return indices.concat(levelIndices);
    }, []);
    mutableGeom.id = idx;
    const geom: MultiPolygon<FeatureProperties> = {
      ...mutableGeom,
      properties: {
        demographics: getDemographics(baseIndices, staticMetadata, demographics),
        voting: getVoting(baseIndices, staticMetadata, voting)
      }
    };
    return geom;
  });
  const featureCollection = topojson.feature(topology, {
    type: "GeometryCollection",
    geometries: merged
  });
  return {
    ...featureCollection,
    // FeatureCollection objects cannot have 'properties' (RFC7964 Sec 7),
    // but they can have other unrecognized fields (Sec 6.1)
    // so we put all non-district data in this top-level metadata field
    metadata: {
      completed:
        featureCollection.features[0].geometry.type === "MultiPolygon" &&
        featureCollection.features[0].geometry.coordinates.length === 0,
      chamber,
      creator: _.pick(user, ["id", "name"]),
      regionConfig: _.pick(regionConfig, ["id", "name", "regionCode", "countryCode", "s3URI"])
    },
    features: featureCollection.features.map(feature => {
      const [compactness, contiguity] = calcPolsbyPopper(feature);
      const geometry = feature.geometry as GeoJSONMultiPolygon;

      return {
        ...feature,
        geometry,
        properties: {
          ...feature.properties,
          compactness,
          contiguity
        }
      };
    })
  };
}

function hasLayer(s3URI: S3URI): boolean {
  return cachedTopology.has(s3URI);
}

const functions = {
  merge,
  hasLayer
};

export type Functions = typeof functions;

expose(functions);
