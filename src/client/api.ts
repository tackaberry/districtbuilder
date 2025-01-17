import axios, { AxiosResponse } from "axios";
import { saveAs } from "file-saver";
import memoize from "memoizee";

import {
  CreateProjectData,
  IOrganization,
  IProject,
  IProjectTemplateWithProjects,
  IRegionConfig,
  IUser,
  JWT,
  OrganizationSlug,
  ProjectId,
  ProjectTemplateId,
  UpdateProjectData,
  UpdateUserData,
  UserId,
  RegionConfigId,
  ProjectNest,
  DistrictsImportApiResponse,
  IReferenceLayer,
  ReferenceLayerId,
  CreateReferenceLayerData,
  IProjectTemplate,
  CreateProjectTemplateData,
  IStaticMetadata,
  UpdateReferenceLayer
} from "../shared/entities";
import { PLANSCORE_POLL_MS, PLANSCORE_POLL_MAX_TRIES } from "../shared/constants";
import {
  DistrictsGeoJSON,
  DynamicProjectData,
  PaginatedResponse,
  ReferenceLayerWithGeojson
} from "./types";
import { getJWT, setJWT } from "./jwt";
import { fetchStaticMetadata } from "./s3";

const apiAxios = axios.create();

function setAxiosAuthHeaders(jwt: JWT): void {
  // Disabling 'functional/immutable-data' without naming it.
  // See https://github.com/jonaskello/eslint-plugin-functional/issues/105
  // eslint-disable-next-line
  apiAxios.defaults.headers.common.Authorization = `Bearer ${jwt}`;
}

const authToken = getJWT();
// Disabling 'functional/no-conditional-statement' without naming it.
// See https://github.com/jonaskello/eslint-plugin-functional/issues/105
// eslint-disable-next-line
if (authToken) {
  setAxiosAuthHeaders(authToken);
}

function saveJWT(response: AxiosResponse<JWT>): JWT {
  const jwt = response.data;
  setJWT(jwt);
  setAxiosAuthHeaders(jwt);
  return jwt;
}

function formatProject(project: IProject): IProject {
  return {
    ...project,
    createdDt: new Date(project.createdDt),
    updatedDt: new Date(project.updatedDt),
    submittedDt: project.submittedDt ? new Date(project.submittedDt) : undefined
  };
}

export async function authenticateUser(email: string, password: string): Promise<JWT> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post("/api/auth/email/login", { email, password })
      .then(response => resolve(saveJWT(response)))
      .catch(error => reject(error.response?.data || error));
  });
}

export async function fetchUser(): Promise<IUser> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get("/api/user")
      .then(response => resolve(response.data))
      .catch(error => reject(error.message));
  });
}

export async function patchUser(userData: Partial<UpdateUserData>): Promise<IUser> {
  return new Promise((resolve, reject) => {
    apiAxios
      .patch(`/api/user/`, userData)
      .then(response => resolve(response.data))
      .catch(() => reject());
  });
}

export async function registerUser(
  name: string,
  email: string,
  password: string,
  organization?: string
): Promise<JWT> {
  const data = organization ? { name, email, password, organization } : { name, email, password };
  return new Promise((resolve, reject) => {
    apiAxios
      .post("/api/auth/email/register", data)
      .then(response => resolve(saveJWT(response)))
      .catch(error => reject(error.response?.data || error));
  });
}

export async function initiateForgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/auth/email/forgot-password/${email}`)
      .then(() => resolve())
      .catch(error => reject(error.response?.data || error));
  });
}

export async function resendConfirmationEmail(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/auth/email/resend-verification/${email}`)
      .then(() => resolve())
      .catch(error => reject(error.response?.data || error));
  });
}

export async function activateAccount(token: string): Promise<JWT> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/auth/email/verify/${token}`)
      .then(response => resolve(response.data))
      .catch(error => reject(error.message));
  });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/auth/email/reset-password/${token}`, { password })
      .then(() => resolve())
      .catch(error => reject(error.response?.data || error));
  });
}

export async function createProject(data: CreateProjectData): Promise<IProject> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post("/api/projects", data)
      .then(response => resolve(formatProject(response.data)))
      .catch(error => reject(error.response?.data || error));
  });
}

export async function copyProject(id: ProjectId): Promise<IProject> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/projects/${id}/duplicate`)
      .then(response => resolve(formatProject(response.data)))
      .catch(error => reject(error.response?.data || error));
  });
}

async function fetchProject(id: ProjectId): Promise<IProject> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/projects/${id}`)
      .then(response => resolve(formatProject(response.data)))
      .catch(error =>
        reject({ errorMessage: error.response.data, statusCode: error.response.status })
      );
  });
}

export async function fetchProjectGeoJson(id: ProjectId): Promise<DistrictsGeoJSON> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/projects/${id}/export/geojson`)
      .then(response => resolve(response.data))
      .catch(error => reject(error.response.data));
  });
}

export async function fetchProjectReferenceLayers(
  id: ProjectId
): Promise<readonly IReferenceLayer[]> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/reference-layer/project/${id}`)
      .then(response => resolve(response.data))
      .catch(error => reject(error.response.data));
  });
}

export async function fetchProjects(
  page: number,
  limit: number
): Promise<PaginatedResponse<IProject>> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/projects?page=${page}&limit=${limit}&sort=updatedDt,DESC`)
      .then(response => resolve(response.data))
      .catch(error => reject(error.response.data));
  });
}

export async function fetchAllPublishedProjects(
  page: number,
  limit: number,
  region?: string
): Promise<PaginatedResponse<IProject>> {
  const endpoint = region
    ? `/api/globalProjects?page=${page}&limit=${limit}&completed=true&region=${region}`
    : `/api/globalProjects?page=${page}&limit=${limit}&completed=true`;
  return new Promise((resolve, reject) => {
    apiAxios
      .get(endpoint)
      .then(response => {
        return resolve(response.data);
      })
      .catch(error => reject(error.response.data));
  });
}

export async function fetchProjectData(id: ProjectId): Promise<DynamicProjectData> {
  return Promise.all([fetchProject(id), fetchProjectGeoJson(id)]).then(([project, geojson]) => ({
    project,
    geojson
  }));
}

export async function fetchRegionConfigs(): Promise<IRegionConfig> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get("/api/region-configs?sort=name,ASC")
      .then(response => {
        resolve(response.data);
      })
      .catch(error => reject(error.message));
  });
}

export async function fetchRegionProperties(
  region: RegionConfigId,
  geoLevel: string,
  fields: readonly string[]
): Promise<readonly Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/region-configs/${region}/properties/${geoLevel}?fields=${fields.join("&fields=")}`)
      .then(response => {
        resolve(response.data);
      })
      .catch(error => reject(error.message));
  });
}

export async function patchProject(
  id: ProjectId,
  projectData: Partial<UpdateProjectData>
): Promise<IProject> {
  return new Promise((resolve, reject) => {
    apiAxios
      .patch(`/api/projects/${id}`, projectData)
      .then(response => resolve(formatProject(response.data)))
      .catch(error => reject(error.response?.data || error));
  });
}

export async function exportProjectCsv(project: IProject): Promise<void> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/projects/${project.id}/export/csv`)
      .then(response => {
        return resolve(
          saveAs(
            new Blob([response.data], { type: "text/csv;charset=utf-8" }),
            `${project.name}.csv`
          )
        );
      })
      .catch(error => reject(error.message));
  });
}

export async function exportProjectGeoJson(project: IProject): Promise<void> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/projects/${project.id}/export/geojson`)
      .then(response => {
        return resolve(
          saveAs(
            new Blob([JSON.stringify(response.data)], { type: "application/json" }),
            `${project.name}.geojson`
          )
        );
      })
      .catch(error => reject(error.message));
  });
}

export async function exportProjectShp(project: IProject): Promise<void> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/projects/${project.id}/export/shp`, { responseType: "blob" })
      .then(response => {
        return resolve(
          saveAs(new Blob([response.data], { type: "application/zip" }), `${project.name}.zip`)
        );
      })
      .catch(error => reject(error.message));
  });
}

export async function importCsv(
  file: Blob,
  regionConfigId?: RegionConfigId
): Promise<DistrictsImportApiResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return new Promise((resolve, reject) => {
    apiAxios
      .post(
        `/api/districts/import/csv${regionConfigId ? `?regionConfigId=${regionConfigId}` : ""}`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" }
        }
      )
      .then(response => {
        return resolve(response.data);
      })
      .catch(error => reject(error.message));
  });
}

export async function createReferenceLayer(
  referenceLayer: CreateReferenceLayerData
): Promise<ReferenceLayerWithGeojson> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/reference-layer/`, referenceLayer)
      .then(response => {
        return resolve(response.data);
      })
      .catch(error => reject(error.message));
  });
}

export async function deleteReferenceLayer(
  referenceLayerId: ReferenceLayerId
): Promise<ReferenceLayerId> {
  return new Promise((resolve, reject) => {
    apiAxios
      .delete(`/api/reference-layer/${referenceLayerId}`)
      .then(() => resolve(referenceLayerId))
      .catch(error => reject(error.message));
  });
}

export async function patchReferenceLayer(
  referenceLayerId: ReferenceLayerId,
  color: Partial<UpdateReferenceLayer>
): Promise<ReferenceLayerWithGeojson> {
  return new Promise((resolve, reject) => {
    apiAxios
      .patch(`/api/reference-layer/${referenceLayerId}`, color)
      .then(response => resolve(response.data))
      .catch(error => reject(error.message));
  });
}

export async function fetchOrganization(slug: OrganizationSlug): Promise<IOrganization> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/organization/${slug}`)
      .then(response => resolve(response.data))
      .catch(error => {
        reject({ errorMessage: error.response.data, statusCode: error.response.status });
      });
  });
}

export async function fetchOrganizationProjects(
  slug: OrganizationSlug
): Promise<readonly IProjectTemplateWithProjects[]> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/project_templates/${slug}`)
      .then(response => {
        resolve(response.data);
      })
      .catch(error => {
        reject(error.response.data);
      });
  });
}

export async function createProjectTemplate(
  slug: OrganizationSlug,
  data: CreateProjectTemplateData
): Promise<IProjectTemplate> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/project_templates/${slug}`, data)
      .then(response => resolve(response.data))
      .catch(error => reject(error.response?.data || error));
  });
}

export async function archiveProjectTemplate(
  slug: OrganizationSlug,
  id: ProjectTemplateId
): Promise<ProjectTemplateId> {
  return new Promise((resolve, reject) => {
    apiAxios
      .put(`/api/project_templates/${slug}/${id}`)
      .then(response => resolve(response.data))
      .catch(error => reject(error.message));
  });
}

export async function fetchOrganizationFeaturedProjects(
  slug: OrganizationSlug
): Promise<readonly IProjectTemplateWithProjects[]> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/project_templates/featured/${slug}`)
      .then(response => {
        resolve(response.data);
      })
      .catch(error => {
        reject(error.response.data);
      });
  });
}

export const fetchMemoizedStateBbox = memoize(
  async (region: IRegionConfig): Promise<IStaticMetadata["bbox"]> => {
    const staticMetadata = await fetchStaticMetadata(region.s3URI);
    return staticMetadata.bbox;
  },
  {
    normalizer: (args: [region: IRegionConfig]) => JSON.stringify(args[0].id)
  }
);

export async function exportOrganizationProjectsCsv(slug: OrganizationSlug): Promise<void> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/project_templates/${slug}/export/maps-csv/`)
      .then(response => {
        const today = new Date();
        const dateString = today.toISOString().split("T")[0];
        return resolve(
          saveAs(
            new Blob([response.data], { type: "text/csv;charset=utf-8" }),
            `${dateString}-${slug}-maps.csv`
          )
        );
      })
      .catch(error => reject(error.message));
  });
}

export async function exportOrganizationUsersCsv(slug: OrganizationSlug): Promise<void> {
  return new Promise((resolve, reject) => {
    apiAxios
      .get(`/api/organization/${slug}/export/users-csv/`)
      .then(response => {
        const today = new Date();
        const dateString = today.toISOString().split("T")[0];
        return resolve(
          saveAs(
            new Blob([response.data], { type: "text/csv;charset=utf-8" }),
            `${dateString}-${slug}-users.csv`
          )
        );
      })
      .catch(error => reject(error.message));
  });
}

export async function saveProjectFeatured(project: ProjectNest): Promise<IOrganization> {
  return new Promise((resolve, reject) => {
    const projectPost = {
      isFeatured: !project.isFeatured
    };
    apiAxios
      .post(`/api/projects/${project.id}/toggleFeatured`, projectPost)
      .then(response => resolve(response.data))
      .catch(error => {
        reject(error.message);
      });
  });
}

export async function submitProject(projectId: ProjectId): Promise<IProject> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/projects/${projectId}/submit`)
      .then(response => resolve(formatProject(response.data)))
      .catch(error => {
        reject(error.message);
      });
  });
}

async function uploadToPlanScore(project: IProject): Promise<void> {
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/projects/${project.id}/plan-score`)
      .then(() => resolve())
      .catch(error => {
        reject(error.message);
      });
  });
}

async function pollForPlanScoreUpdates(projectId: ProjectId, numTries = 1): Promise<IProject> {
  return new Promise((resolve, reject) => {
    fetchProject(projectId)
      .then(project =>
        // Return an error for either an explicit error from the backend or a timeout
        project.planscoreUrl === "error" || numTries > PLANSCORE_POLL_MAX_TRIES
          ? reject()
          : project.planscoreUrl === ""
          ? setTimeout(
              () => resolve(pollForPlanScoreUpdates(projectId, numTries + 1)),
              PLANSCORE_POLL_MS
            )
          : resolve(project)
      )
      .catch(() => reject());
  });
}

export async function checkPlanScoreAPI(project: IProject): Promise<IProject> {
  await uploadToPlanScore(project);
  return pollForPlanScoreUpdates(project.id);
}

export async function addUserToOrganization(
  slug: OrganizationSlug,
  user: UserId
): Promise<IOrganization> {
  const userAdd = { userId: user };
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/organization/${slug}/join`, userAdd)
      .then(response => resolve(response.data))
      .catch(error => {
        reject(error.message);
      });
  });
}

export async function removeUserFromOrganization(
  slug: OrganizationSlug,
  user: UserId
): Promise<IOrganization> {
  const userRemove = { userId: user };
  return new Promise((resolve, reject) => {
    apiAxios
      .post(`/api/organization/${slug}/leave`, userRemove)
      .then(response => resolve(response.data))
      .catch(error => {
        reject(error.message);
      });
  });
}

// Retrieves total population for the region by fetching metadata & querying topojson properties
export async function fetchTotalPopulation(region: IRegionConfig) {
  const staticMetadata = await fetchStaticMetadata(region.s3URI);
  const topLevel = staticMetadata.geoLevels[staticMetadata.geoLevels.length - 1].id;
  const records = await fetchRegionProperties(region.id, topLevel, ["population"]);
  return records.reduce((total, record) => total + Number(record["population"]), 0);
}
