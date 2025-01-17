import { createAction } from "typesafe-actions";
import { ProjectVisibility } from "../../shared/constants";
import {
  DistrictsDefinition,
  IProject,
  IReferenceLayer,
  LockedDistricts,
  ProjectId,
  ReferenceLayerId,
  UpdateReferenceLayer
} from "../../shared/entities";
import { DynamicProjectData, StaticProjectData } from "../types";
import { ResourceFailure } from "../resource";

interface PinnedMetrics {
  readonly pinnedMetricFields: readonly string[];
  readonly isReadOnly: boolean;
}

export const projectFetch = createAction("Project fetch")<ProjectId>();
export const projectFetchSuccess = createAction("Project fetch success")<DynamicProjectData>();
export const projectFetchFailure = createAction("Project fetch failure")<ResourceFailure>();

export const projectDataFetch = createAction("Project data fetch")<ProjectId>();
export const projectDataFetchSuccess = createAction(
  "Project data fetch success"
)<DynamicProjectData>();
export const projectDataFetchFailure = createAction(
  "Project data fetch failure"
)<ResourceFailure>();

export const projectReferenceLayersFetch = createAction(
  "Project reference layers fetch"
)<ProjectId>();
export const projectReferenceLayersFetchSuccess = createAction(
  "Project reference layers fetch success"
)<readonly IReferenceLayer[]>();
export const projectReferenceLayersFetchFailure = createAction(
  "Project reference layers fetch failure"
)<ResourceFailure>();

export const referenceLayerUpdate = createAction("Reference layer update")<{
  readonly id: ReferenceLayerId;
  readonly layer_color: UpdateReferenceLayer;
}>();
export const referenceLayerUpdateSuccess = createAction(
  "Reference layer update success"
)<IReferenceLayer>();
export const referenceLayerUpdateFailure = createAction(
  "Reference layer update failure"
)<ResourceFailure>();

export const referenceLayerDelete = createAction("Reference layer delete")<ReferenceLayerId>();
export const referenceLayerDeleteSuccess = createAction(
  "Reference layer delete success"
)<ReferenceLayerId>();
export const referenceLayerDeleteFailure = createAction(
  "Reference layer delete failure"
)<ResourceFailure>();

export const setDeleteReferenceLayer = createAction(
  "Set the id for the delete reference layer modal"
)<IReferenceLayer | undefined>();

export const staticDataFetchSuccess = createAction(
  "Static data fetch success"
)<StaticProjectData>();
export const staticDataFetchFailure = createAction("Static data fetch failure")<string>();

export const setProjectNameEditing = createAction("Toggle editing project name")<boolean>();

export const updateProjectName = createAction("Update project name")<string>();
export const updateProjectNameSuccess = createAction(
  "Update project name success"
)<DynamicProjectData>();

export const updateProjectDetailsSuccess = createAction(
  "Update project details success"
)<DynamicProjectData>();

export const updateProjectVisibility = createAction(
  "Update project visibility"
)<ProjectVisibility>();
export const updateProjectVisibilitySuccess = createAction(
  "Update project visibility success"
)<DynamicProjectData>();

export const updateDistrictsDefinition = createAction(
  "Update districts definition"
)<DistrictsDefinition | null>();
export const updateDistrictsDefinitionSuccess = createAction(
  "Update districts definition success"
)<IProject>();
export const updateDistrictsDefinitionRefetchGeoJsonSuccess = createAction(
  "Update districts definition refetch geojson success"
)<DynamicProjectData>();

export const updateDistrictLocks = createAction("Update district locks")<LockedDistricts>();
export const updateDistrictLocksSuccess = createAction(
  "Update district locks success"
)<DynamicProjectData>();
export const updateDistrictLocksFailure = createAction("Update district locks failure")<string>();

export const updatePinnedMetrics = createAction("Update pinned metrics")<PinnedMetrics>();
export const updatePinnedMetricsSuccess = createAction(
  "Update pinned metrics success"
)<DynamicProjectData>();
export const updatedPinnedMetricsFailure = createAction("Update pinned metrics failure")<string>();

export const updateProjectFailed = createAction("Update project failure")();

export const duplicateProject = createAction("Duplicate project")<IProject>();
export const duplicateProjectSuccess = createAction("Duplicate project success")<IProject>();
export const duplicateProjectFailure = createAction("Duplicate project failure")<string>();

export const toggleReferenceLayersModal = createAction("Toggle reference layers modal")();
export const toggleProjectDetailsModal = createAction("Toggle project details modal")();

export const clearDuplicationState = createAction("Clear duplication state")();

export const exportCsv = createAction("Export project CSV")<IProject>();
export const exportCsvFailure = createAction("Export project CSV failure")<string>();

export const exportGeoJson = createAction("Export project GeoJSON")<IProject>();
export const exportGeoJsonFailure = createAction("Export project GeoJSON failure")<string>();

export const exportShp = createAction("Export project Shapefile")<IProject>();
export const exportShpFailure = createAction("Export project Shapefile failure")<string>();

export const projectSubmit = createAction("Project submit")();
export const projectSubmitSuccess = createAction("Project submit success")<DynamicProjectData>();
