/** @jsx jsx */
import MapboxGL from "mapbox-gl";
import React, { useEffect, useRef, useState } from "react";
import { useBeforeunload } from "react-beforeunload";
import { connect } from "react-redux";
import { Redirect, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { Flex, jsx, Spinner, ThemeUIStyleObject } from "theme-ui";

import {
  GeoUnitHierarchy,
  IProject,
  IReferenceLayer,
  IStaticMetadata,
  IUser,
  ProjectId,
  RegionLookupProperties,
  TypedArrays
} from "../../shared/entities";

import {
  clearDuplicationState,
  projectDataFetch,
  projectReferenceLayersFetch
} from "../actions/projectData";
import { resetProjectState } from "../actions/root";
import { userFetch } from "../actions/user";
import "../App.css";
import AddReferenceLayerModal from "../components/AddReferenceLayerModal";
import CenteredContent from "../components/CenteredContent";
import CopyMapModal from "../components/CopyMapModal";
import DeleteReferenceLayerModal from "../components/DeleteReferenceLayerModal";
import ProjectEvaluateSidebar from "../components/evaluate/ProjectEvaluateSidebar";
import Icon from "../components/Icon";
import AdvancedEditingModal from "../components/map/AdvancedEditingModal";
import KeyboardShortcutsModal from "../components/map/KeyboardShortcutsModal";
import Map from "../components/map/Map";
import MapHeader from "../components/MapHeader";
import ProjectDetailsModal from "../components/ProjectDetailsModal";
import ProjectHeader from "../components/ProjectHeader";
import ProjectSidebar from "../components/ProjectSidebar";
import SiteHeader from "../components/SiteHeader";
import SubmitMapModal from "../components/SubmitMapModal";
import Tour from "../components/Tour";
import { areAnyGeoUnitsSelected, destructureResource, isProjectReadOnly } from "../functions";
import { isUserLoggedIn } from "../jwt";
import { State } from "../reducers";
import { DistrictDrawingState } from "../reducers/districtDrawing";
import { ProjectOptionsState } from "../reducers/projectOptions";
import { Resource } from "../resource";
import store from "../store";
import { DistrictsGeoJSON, EvaluateMetricWithValue } from "../types";

import PageNotFoundScreen from "./PageNotFoundScreen";

interface StateProps {
  readonly project?: IProject;
  readonly geojson?: DistrictsGeoJSON;
  readonly staticMetadata?: IStaticMetadata;
  readonly staticGeoLevels: TypedArrays;
  readonly projectNotFound?: boolean;
  readonly findMenuOpen: boolean;
  readonly regionProperties: Resource<readonly RegionLookupProperties[]>;
  readonly evaluateMode: boolean;
  readonly evaluateMetric: EvaluateMetricWithValue | undefined;
  readonly geoUnitHierarchy?: GeoUnitHierarchy;
  readonly expandedProjectMetrics?: boolean;
  readonly districtDrawing: DistrictDrawingState;
  readonly isLoading: boolean;
  readonly isReadOnly: boolean;
  readonly isArchived: boolean;
  readonly referenceLayers: Resource<readonly IReferenceLayer[]>;
  readonly mapLabel: string | undefined;
  readonly user: Resource<IUser>;
  readonly limitSelectionToCounty: boolean;
  readonly projectOptions: ProjectOptionsState;
}

interface Params {
  readonly projectId: ProjectId;
}

const style: Record<string, ThemeUIStyleObject> = {
  tourStart: {
    width: "300px",
    height: "10px",
    background: "transparent",
    bottom: "0",
    right: "10px",
    pointerEvents: "none",
    position: "absolute"
  }
};

const wasSubmitted = (project?: IProject) => (project ? !!project.submittedDt : undefined);

const ProjectScreen = ({
  project,
  geojson,
  staticMetadata,
  staticGeoLevels,
  evaluateMode,
  evaluateMetric,
  regionProperties,
  projectNotFound,
  findMenuOpen,
  geoUnitHierarchy,
  districtDrawing,
  mapLabel,
  isLoading,
  referenceLayers,
  isReadOnly,
  isArchived,
  user,
  limitSelectionToCounty,
  projectOptions
}: StateProps) => {
  const { projectId } = useParams<Params>();
  const [map, setMap] = useState<MapboxGL.Map | undefined>(undefined);
  const isLoggedIn = isUserLoggedIn();
  const isFirstLoadPending = isLoading && (project === undefined || staticMetadata === undefined);
  const presentDrawingState = districtDrawing.undoHistory.present.state;

  const wasSubmittedRef = useRef<boolean | undefined>();

  useEffect(() => {
    if (wasSubmittedRef.current === false && wasSubmitted(project)) {
      toast.success(
        <span>
          <Icon name="check" /> Your map was submitted!
        </span>
      );
    }
    if (project) {
      wasSubmittedRef.current = wasSubmitted(project);
    }
  }, [project]);

  // Warn the user when attempting to leave the page with selected geounits
  useBeforeunload(event => {
    // Disabling 'functional/no-conditional-statement' without naming it.
    // eslint-disable-next-line
    if (areAnyGeoUnitsSelected(presentDrawingState.selectedGeounits)) {
      // Old style, used by e.g. Chrome
      // Disabling 'functional/immutable-data' without naming it.
      // eslint-disable-next-line
      event.returnValue = true;
      // New style, used by e.g. Firefox
      event.preventDefault();
      // The message isn't actually displayed on most browsers
      return "You have unsaved changes. Accept or reject changes to save your map.";
    }
  });

  // Reset component redux state on unmount
  useEffect(
    () => () => {
      store.dispatch(resetProjectState());
    },
    []
  );

  // Clear duplication state when mounting, in case the user navigated to project page from a post-duplication redirect
  useEffect(() => {
    store.dispatch(clearDuplicationState());
  }, []);

  useEffect(() => {
    isLoggedIn && store.dispatch(userFetch());
    projectId && store.dispatch(projectReferenceLayersFetch(projectId));
    projectId && store.dispatch(projectDataFetch(projectId));
  }, [projectId, isLoggedIn]);

  useEffect(() => {
    //eslint-disable-next-line
    document.title = "DistrictBuilder " + (project ? `| ${project.name}` : "");
  });

  return isFirstLoadPending ? (
    <CenteredContent>
      <Flex sx={{ justifyContent: "center" }}>
        <Spinner variant="styles.spinner.large" />
      </Flex>
    </CenteredContent>
  ) : "errorMessage" in user ? (
    <Redirect to={"/login"} />
  ) : projectNotFound ? (
    <Flex sx={{ height: "100%", flexDirection: "column" }}>
      <SiteHeader user={user} />
      <PageNotFoundScreen model={"project"} />
    </Flex>
  ) : (
    <Flex sx={{ height: "100%", flexDirection: "column" }}>
      <ProjectHeader map={map} project={project} isArchived={isArchived} isReadOnly={isReadOnly} />
      <Flex sx={{ flex: 1, overflowY: "auto" }}>
        {!evaluateMode ? (
          <ProjectSidebar
            project={project}
            geojson={geojson}
            isLoading={isLoading}
            staticMetadata={staticMetadata}
            selectedDistrictId={districtDrawing.selectedDistrictId}
            selectedGeounits={presentDrawingState.selectedGeounits}
            highlightedGeounits={districtDrawing.highlightedGeounits}
            expandedProjectMetrics={districtDrawing.expandedProjectMetrics}
            geoUnitHierarchy={geoUnitHierarchy}
            referenceLayers={referenceLayers}
            showReferenceLayers={districtDrawing.showReferenceLayers}
            lockedDistricts={presentDrawingState.lockedDistricts}
            hoveredDistrictId={districtDrawing.hoveredDistrictId}
            saving={districtDrawing.saving}
            populationKey={projectOptions.populationKey}
            isReadOnly={isReadOnly}
            pinnedMetrics={districtDrawing.undoHistory.present.state.pinnedMetricFields}
          />
        ) : (
          <ProjectEvaluateSidebar
            geojson={geojson}
            metric={evaluateMetric}
            project={project}
            regionProperties={regionProperties}
            staticMetadata={staticMetadata}
            isArchived={isArchived}
          />
        )}
        {
          <Flex
            sx={{
              flexDirection: "column",
              flex: 1,
              background: "#fff",
              display: !evaluateMode && districtDrawing.expandedProjectMetrics ? "none" : "flex"
            }}
          >
            {!evaluateMode ? (
              <MapHeader
                label={mapLabel}
                metadata={staticMetadata}
                selectionTool={districtDrawing.selectionTool}
                findMenuOpen={findMenuOpen}
                paintBrushSize={districtDrawing.paintBrushSize}
                geoLevelIndex={presentDrawingState.geoLevelIndex}
                selectedGeounits={presentDrawingState.selectedGeounits}
                limitSelectionToCounty={limitSelectionToCounty}
                advancedEditingEnabled={project?.advancedEditingEnabled}
                isReadOnly={isReadOnly}
                electionYear={projectOptions.electionYear}
                populationKey={projectOptions.populationKey}
              />
            ) : (
              <Flex></Flex>
            )}

            {project && staticMetadata && staticGeoLevels && geojson ? (
              <React.Fragment>
                {!isReadOnly && "resource" in user && (
                  <Tour
                    geojson={geojson}
                    project={project}
                    staticMetadata={staticMetadata}
                    user={user.resource}
                  />
                )}
                <Map
                  project={project}
                  geojson={geojson}
                  staticMetadata={staticMetadata}
                  staticGeoLevels={staticGeoLevels}
                  selectedGeounits={presentDrawingState.selectedGeounits}
                  selectedDistrictId={districtDrawing.selectedDistrictId}
                  hoveredDistrictId={districtDrawing.hoveredDistrictId}
                  zoomToDistrictId={districtDrawing.zoomToDistrictId}
                  selectionTool={districtDrawing.selectionTool}
                  paintBrushSize={districtDrawing.paintBrushSize}
                  geoLevelIndex={presentDrawingState.geoLevelIndex}
                  expandedProjectMetrics={districtDrawing.expandedProjectMetrics}
                  lockedDistricts={presentDrawingState.lockedDistricts}
                  evaluateMode={evaluateMode}
                  evaluateMetric={evaluateMetric}
                  isReadOnly={isReadOnly}
                  isArchived={isArchived}
                  limitSelectionToCounty={limitSelectionToCounty}
                  label={mapLabel}
                  map={map}
                  setMap={setMap}
                />
                {!isReadOnly && (
                  <AdvancedEditingModal
                    id={project.id}
                    geoLevels={staticMetadata.geoLevelHierarchy}
                  />
                )}
                <CopyMapModal project={project} />
                <KeyboardShortcutsModal
                  isReadOnly={isReadOnly}
                  evaluateMode={evaluateMode}
                  staticMetadata={staticMetadata}
                />
                <AddReferenceLayerModal project={project} />
                <ProjectDetailsModal project={project} geojson={geojson} />
                <SubmitMapModal project={project} />
                <DeleteReferenceLayerModal />
                <Flex id="tour-start" sx={style.tourStart}></Flex>
              </React.Fragment>
            ) : null}
          </Flex>
        }
      </Flex>
    </Flex>
  );
};

function mapStateToProps(state: State): StateProps {
  const project: IProject | undefined = destructureResource(state.project.projectData, "project");
  return {
    project,
    geojson: destructureResource(state.project.projectData, "geojson"),
    staticMetadata: destructureResource(state.project.staticData, "staticMetadata"),
    staticGeoLevels: destructureResource(state.project.staticData, "staticGeoLevels"),
    geoUnitHierarchy: destructureResource(state.project.staticData, "geoUnitHierarchy"),
    evaluateMode: state.project.evaluateMode,
    evaluateMetric: state.project.evaluateMetric,
    findMenuOpen: state.project.findMenuOpen,
    mapLabel: state.project.mapLabel,
    projectOptions: state.projectOptions,
    limitSelectionToCounty: state.projectOptions.limitSelectionToCounty,
    districtDrawing: state.project,
    referenceLayers: state.project.referenceLayers,
    regionProperties: state.regionConfig.regionProperties,
    isLoading:
      ("isPending" in state.project.projectData && state.project.projectData.isPending) ||
      ("isPending" in state.project.staticData && state.project.staticData.isPending),
    projectNotFound:
      "statusCode" in state.project.projectData && state.project.projectData.statusCode === 404,
    isArchived: project !== undefined && project.regionConfig.archived,
    isReadOnly: isProjectReadOnly(state),
    user: state.user
  };
}

export default connect(mapStateToProps)(ProjectScreen);
