import { isThisYear, isToday } from "date-fns";
import format from "date-fns/format";
import { FeatureCollection, Feature, Point } from "geojson";
import { cloneDeep, mapKeys, mapValues, pick, pickBy } from "lodash";
import { toast } from "react-toastify";

import {
  DemographicCounts,
  DistrictsDefinition,
  MutableGeoUnitCollection,
  GeoLevelHierarchy,
  GeoUnits,
  GeoUnitIndices,
  GeoUnitHierarchy,
  NestedArray,
  IStaticMetadata,
  ReferenceLayerProperties,
  GroupTotal,
  DemographicsGroup,
  IProject
} from "../shared/entities";
import { State } from "./reducers";

import { Resource, WriteResource } from "./resource";
import {
  ChoroplethSteps,
  DistrictGeoJSON,
  ElectionYear,
  DistrictsGeoJSON,
  ReferenceLayerGeojson,
  PviBucket
} from "./types";

export function areAnyGeoUnitsSelected(geoUnits: GeoUnits) {
  return Object.values(geoUnits).some(geoUnitsForLevel => geoUnitsForLevel.size);
}

export function canSwitchGeoLevels(
  currentIndex: number,
  newIndex: number,
  geoLevelHierarchy: GeoLevelHierarchy,
  selectedGeounits: GeoUnits
): boolean {
  const areGeoUnitsSelected = areAnyGeoUnitsSelected(selectedGeounits);
  const isBaseLevelAlwaysVisible = isBaseGeoLevelAlwaysVisible(geoLevelHierarchy);
  const isBaseGeoLevelSelected = newIndex === geoLevelHierarchy.length - 1;
  const isCurrentLevelBaseGeoLevel = currentIndex === geoLevelHierarchy.length - 1;
  return !(
    !isBaseLevelAlwaysVisible &&
    areGeoUnitsSelected &&
    // block level selected, so disable all higher geolevels
    ((isBaseGeoLevelSelected && !isCurrentLevelBaseGeoLevel) ||
      // non-block level selected, so disable block level
      (!isBaseGeoLevelSelected && isCurrentLevelBaseGeoLevel))
  );
}

// Determines if we are in a scenario where all geolevels have the same minimum zoom,
// and thus, the base geolevel doesn't require special handling
export function isBaseGeoLevelAlwaysVisible(geoLevelHierarchy: GeoLevelHierarchy) {
  return new Set(geoLevelHierarchy.map(level => level.minZoom)).size === 1;
}

export function allGeoUnitIndices(geoUnits: GeoUnits) {
  return Object.values(geoUnits).flatMap(geoUnitForLevel => Array.from(geoUnitForLevel.values()));
}

export function allGeoUnitIds(geoUnits: GeoUnits) {
  return Object.values(geoUnits).flatMap(geoUnitForLevel => Array.from(geoUnitForLevel.keys()));
}

export const capitalizeFirstLetter = (s: string) =>
  s.substring(0, 1).toUpperCase() + s.substring(1);

export const getPartyColor = (party: string) =>
  party === "republican" ? "#BF4E6A" : party === "democrat" ? "#4E56BF" : "#F7AD00";

export const getMajorityRaceDisplay = (feature: DistrictGeoJSON) =>
  feature.properties.majorityRace && capitalizeFirstLetter(feature.properties.majorityRace);

/* Creates array of party-labelled pvi bucket counts as strings */
export function formatPviByDistrict(
  pviBuckets: readonly (PviBucket | undefined)[] | undefined
): readonly string[] | undefined {
  const partyLabels = ["R", "E (Even)", "D"];
  // Count by partyLabels
  const bucketCounts = pviBuckets?.reduce(
    (allBuckets: { readonly [key: string]: number } | undefined, bucket: PviBucket | undefined) => {
      const name =
        bucket &&
        partyLabels.find(label => bucket.name.includes(label) || label.includes(bucket.name));
      return name
        ? allBuckets && name in allBuckets
          ? { ...allBuckets, [name]: allBuckets[name] + 1 }
          : { ...allBuckets, [name]: 1 }
        : allBuckets;
    },
    {}
  );
  // Create string with partyLabels label
  const bucketCountsStrings =
    bucketCounts &&
    partyLabels
      .map((label: string) => {
        return bucketCounts[label]
          ? `${bucketCounts[label].toLocaleString(undefined, {
              maximumFractionDigits: 0
            })} ${label}`
          : undefined;
      })
      .filter((bucket: string | undefined): bucket is string => bucket !== undefined);
  return bucketCountsStrings && bucketCountsStrings.length > 0 ? bucketCountsStrings : undefined;
}

function computeRowFillInterval(stops: ChoroplethSteps, value?: number) {
  if (value) {
    // eslint-disable-next-line
    for (let i = 0; i < stops.length; i++) {
      const r = stops[i];
      if (value >= r[0]) {
        if (i < stops.length - 1) {
          const r1 = stops[i + 1];
          if (value < r1[0]) {
            return r[1];
          }
        } else {
          return r[1];
        }
      } else {
        return r[1];
      }
    }
  }
  return "#fff";
}

export function computeRowFill(stops: ChoroplethSteps, value?: number, interval?: boolean): string {
  // eslint-disable-next-line
  let i = 0;
  if (!interval) {
    // eslint-disable-next-line
    while (i < stops.length) {
      const r = stops[i];
      if (value && value < r[0]) {
        return r[1];
      } else {
        i++;
      }
    }
    return "#fff";
  } else {
    return computeRowFillInterval(stops, value);
  }
}

// Source: https://cookpolitical.com/analysis/national/pvi/introducing-2021-cook-political-report-partisan-voter-index
const nationalDemVoteShare16 = 51.1;
const nationalDemVoteShare20 = 52.3;
const nationalDemVoteShareAvg = (nationalDemVoteShare16 + nationalDemVoteShare20) / 2;

// Computes share of votes for party1
export function calculatePartyVoteShare(
  party1Votes: number,
  otherVotes: number
): number | undefined {
  const total = party1Votes + otherVotes;
  return total ? (100 * party1Votes) / total : undefined;
}

export function getPartyVoteShareDisplay(percent?: number): string {
  return percent ? percent.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0";
}

export function computeDemographicSplit(demographic: number, total: number): string | undefined {
  const percent = total !== 0 ? Math.abs(demographic / total) * 100 : undefined;
  return percent ? percent.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "0";
}

export function isMajorityMinority(f: DistrictGeoJSON): boolean {
  return (
    (f.properties.majorityRace && f.properties.majorityRace !== "white" && f.id !== 0) || false
  );
}

export function getDemographicsPercentages(
  demographics: { readonly [id: string]: number },
  demographicsGroups: readonly DemographicsGroup[],
  populationKey: GroupTotal
): { readonly [id: string]: number } {
  // To handle cases where adjustments have caused negative pop. use absolute values
  const total = Math.abs(demographics[populationKey]);
  const group =
    demographicsGroups.find(group => group.total === populationKey) || demographicsGroups[0];
  const selectedDemographics = pick(demographics, group.subgroups);
  const renamedDemographics =
    populationKey === "population"
      ? selectedDemographics
      : mapKeys(selectedDemographics, (val, key) =>
          // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
          key.slice(populationKey.length + 1).toLowerCase()
        );
  const percentages = mapValues(renamedDemographics, (population: number) =>
    Math.min((total ? population / total : 0) * 100, 100)
  );
  return percentages;
}

/**
 * Computes the Cook Political Partisan Voting Index (PVI).
 * Positive values indicate that a district leans Democrat,
 * and negative values indicate that a district leans Republican.
 * @param  {[DemographicCounts]} voting
 * @return {[number | undefined]} pvi
 */
export function calculatePVI(voting: DemographicCounts, year?: ElectionYear): number | undefined {
  if (
    "democrat16" in voting &&
    "republican16" in voting &&
    "democrat20" in voting &&
    "republican20" in voting &&
    year !== "16" &&
    year !== "20"
  ) {
    const votes16 = calculatePartyVoteShare(voting.democrat16, voting.republican16);
    const votes20 = calculatePartyVoteShare(voting.democrat20, voting.republican20);
    if (votes16 !== undefined && votes20 !== undefined) {
      const avgVoteShare = (votes16 + votes20) / 2;
      return avgVoteShare - nationalDemVoteShareAvg;
    }
  } else if (year === "20") {
    const voteShare =
      "democrat20" in voting && "republican20" in voting
        ? calculatePartyVoteShare(voting.democrat20, voting.republican20)
        : "democrat" in voting && "republican" in voting
        ? calculatePartyVoteShare(voting.democrat, voting.republican)
        : undefined;
    if (voteShare !== undefined) {
      return voteShare - nationalDemVoteShare20;
    }
  } else {
    // We have some states for which we anticipate having only 2016 election data
    // We assume unspecified vote totals are from 2016
    const voteShare =
      "democrat16" in voting && "republican16" in voting
        ? calculatePartyVoteShare(voting.democrat16, voting.republican16)
        : "democrat" in voting && "republican" in voting
        ? calculatePartyVoteShare(voting.democrat, voting.republican)
        : undefined;
    if (voteShare !== undefined) {
      return voteShare - nationalDemVoteShare16;
    }
  }
}

export const hasMultipleElections = (staticMetadata?: IStaticMetadata) =>
  staticMetadata?.voting?.some(file => file.id.endsWith("16")) &&
  staticMetadata?.voting?.some(file => file.id.endsWith("20"));

export const has16Election = (staticMetadata?: IStaticMetadata) => {
  return (
    staticMetadata?.voting?.some(file => file.id.endsWith("16")) ||
    (staticMetadata?.voting &&
      Object.keys(staticMetadata?.voting || {}).length > 0 &&
      !has20Election(staticMetadata)) ||
    false
  );
};

export const has20Election = (staticMetadata?: IStaticMetadata) =>
  staticMetadata?.voting?.some(file => file.id.endsWith("20")) || false;

export function extractYear(voting: DemographicCounts, year?: ElectionYear): DemographicCounts {
  return year
    ? mapKeys(
        pickBy(voting, (val, key) => key.endsWith(year)),
        (val, key) => key.slice(0, -2)
      )
    : voting;
}

/*
 * Assign nested geounit to district.
 *
 * This can require the creation of intermediate levels using the current
 * district id as we recurse more deeply.
 */
function assignNestedGeounit(
  currentDistrictsDefinition: MutableGeoUnitCollection,
  currentGeounitData: readonly number[],
  currentGeoUnitHierarchy: GeoUnitHierarchy,
  districtId: number
): MutableGeoUnitCollection {
  const [currentLevelGeounitId, ...remainingLevelsGeounitIds] = currentGeounitData;
  // Update districts definition using existing values or explode out district id using hierarchy
  // eslint-disable-next-line
  let newDefinition: MutableGeoUnitCollection =
    typeof currentDistrictsDefinition === "number"
      ? // Auto-fill district ids using current value based on number of geounits at this level
        new Array(currentGeoUnitHierarchy.length).fill(currentDistrictsDefinition)
      : // Copy existing district ids at this level
        currentDistrictsDefinition;
  /* eslint-disable */
  if (remainingLevelsGeounitIds.length) {
    // We need to go deeper...
    newDefinition[currentLevelGeounitId] = assignNestedGeounit(
      newDefinition[currentLevelGeounitId] as MutableGeoUnitCollection,
      currentGeounitData.slice(1),
      currentGeoUnitHierarchy[currentLevelGeounitId] as readonly number[],
      districtId
    );
  } else {
    // End of the line. Update value with new district id
    newDefinition[currentLevelGeounitId] = districtId;
    if (newDefinition.every(value => value === districtId)) {
      // Update district definition for this level to be just the district id
      // eg. instead of [3, 3, 3, 3, ...] for every geounit at this level, just 3
      newDefinition = districtId;
    }
  }
  /* eslint-enable */
  return newDefinition;
}

/*
 * Return new districts definition after assigning the selected geounits to the current district
 */
export function assignGeounitsToDistrict(
  districtsDefinition: DistrictsDefinition,
  geoUnitHierarchy: GeoUnitHierarchy,
  geounitIndices: readonly GeoUnitIndices[],
  districtId: number
): DistrictsDefinition {
  const districtsDefinitionCopy = cloneDeep(districtsDefinition);
  return geounitIndices.reduce((newDistrictsDefinition, geounitData) => {
    const initialGeounitId = geounitData[0];
    // eslint-disable-next-line
    newDistrictsDefinition[initialGeounitId] =
      geounitData.length === 1
        ? // Assign entire county
          districtId
        : // Need to assign nested geounit
          assignNestedGeounit(
            newDistrictsDefinition[initialGeounitId],
            geounitData.slice(1),
            geoUnitHierarchy[initialGeounitId] as NestedArray<number>,
            districtId
          );
    return newDistrictsDefinition;
  }, districtsDefinitionCopy);
}

export function getPopulationPerRepresentative(
  geojson: DistrictsGeoJSON,
  numberOfMembers: readonly number[]
) {
  const totalPopulation = geojson.features.reduce(
    (total, feature) => total + feature.properties.demographics.population,
    0
  );
  const totalReps = numberOfMembers.reduce((total, numberOfReps) => total + numberOfReps, 0);
  return totalPopulation / totalReps;
}

/*
 * Helper function to get exhaustiveness checking.
 *
 * See: https://www.typescriptlang.org/docs/handbook/advanced-types.html#exhaustiveness-checking
 */
export function assertNever(x: never): never {
  // eslint-disable-next-line
  throw new Error(`Unexpected: ${x}`);
}

export const geoLevelLabel = (id: string): string => {
  switch (id) {
    case "county":
      return "Counties";
    default:
      return id[0].toUpperCase() + id.slice(1) + "s";
  }
};

export const geoLevelLabelSingular = (id: string): string => {
  switch (id) {
    case "county":
      return "County";
    default:
      return id[0].toUpperCase() + id.slice(1);
  }
};

export function getSelectedGeoLevel(geoLevelHierarchy: GeoLevelHierarchy, geoLevelIndex: number) {
  return geoLevelHierarchy[geoLevelHierarchy.length - 1 - geoLevelIndex];
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function destructureResource<T extends object>(
  resourceT: Resource<T>,
  key: keyof T
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | undefined {
  return "resource" in resourceT ? resourceT.resource[key] : undefined;
}

export function mergeGeoUnits(a: GeoUnits, b: GeoUnits): GeoUnits {
  const geoLevels = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return Object.fromEntries(
    geoLevels.map(geoLevelId => {
      return [geoLevelId, new Map([...(a[geoLevelId] || []), ...(b[geoLevelId] || [])])];
    })
  );
}

export const showActionFailedToast = () => toast.error("Something went wrong, please try again.");
export const showResourceFailedToast = () =>
  toast.error("Something went wrong, please refresh the page.");
export const showMapActionToast = (mapAction: string) => toast.info(mapAction);

export const formatDate = (date: Date): string => {
  const d = new Date(date);
  return date
    ? isToday(d)
      ? format(d, "h:mm a")
      : isThisYear(d)
      ? format(d, "MMM d")
      : format(d, "MMM d yyyy")
    : "—";
};

type ParseResults = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly data: readonly any[];
  readonly errors: readonly unknown[];
};

export const convertCsvToGeojson = (csv: ParseResults): ReferenceLayerGeojson => {
  const geojson: FeatureCollection<Point, ReferenceLayerProperties> = {
    type: "FeatureCollection",
    features: []
  };
  // eslint-disable-next-line functional/no-loop-statement
  for (const record of csv.data) {
    const recTransformed: Feature<Point, ReferenceLayerProperties> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Point",
        coordinates: []
      }
    };
    /* eslint-disable functional/immutable-data */
    recTransformed.properties = record;
    if ("lat" in record && "lon" in record) {
      recTransformed.geometry.coordinates = [Number(record.lon), Number(record.lat)];
    } else if ("latitude" in record && "longitude" in record) {
      recTransformed.geometry.coordinates = [Number(record.longitude), Number(record.latitude)];
    } else if ("x" in record && "y" in record) {
      recTransformed.geometry.coordinates = [Number(record.x), Number(record.y)];
    }

    geojson.features.push(recTransformed);
    /* eslint-enable functional/immutable-data */
  }
  return geojson;
};

// Extends/shrinks the number of members array to match the provided number of districts
export function updateNumberOfMembers(
  numberOfDistricts: number | null,
  numberOfMembers: readonly number[] | null
): readonly number[] | null {
  return numberOfDistricts === null
    ? null
    : numberOfMembers !== null
    ? numberOfMembers.length > numberOfDistricts
      ? numberOfMembers.slice(0, numberOfDistricts)
      : numberOfMembers.concat(new Array(numberOfDistricts - numberOfMembers.length).fill(1))
    : (new Array(numberOfDistricts).fill(1) as readonly number[]);
}

export function extractErrors<D, T>(
  resource: WriteResource<D, T>,
  field: keyof D
): readonly string[] | undefined {
  return "errors" in resource && typeof resource.errors.message === "object"
    ? resource.errors.message[field]
    : undefined;
}

export function isProjectReadOnly(state: State) {
  const project: IProject | undefined = destructureResource(state.project.projectData, "project");
  return (
    !("resource" in state.user) ||
    (project !== undefined && state.user.resource.id !== project.user.id) ||
    (project !== undefined && project.regionConfig.archived) ||
    (project !== undefined && !!project.submittedDt)
  );
}
