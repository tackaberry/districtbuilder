import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { TypeOrmCrudService } from "@nestjsx/crud-typeorm";
import { Repository } from "typeorm";

import { ProjectTemplate } from "../entities/project-template.entity";
import { ProjectVisibility } from "../../../../shared/constants";
import {
  OrganizationSlug,
  DistrictProperties,
  UserId,
  ProjectId,
  ProjectTemplateId
} from "../../../../shared/entities";
import { Organization } from "../../organizations/entities/organization.entity";
import { Project } from "../../projects/entities/project.entity";
import { selectSimplifiedDistricts } from "../../projects/services/projects.service";

export type ProjectExportRow = {
  readonly userId: UserId;
  readonly userName: string;
  readonly userEmail: string;
  readonly mapName: string;
  readonly projectId: ProjectId;
  readonly createdDt: Date;
  readonly updatedDt: Date;
  readonly templateName: string;
  readonly regionName: string;
  readonly regionS3URI: string;
  readonly chamberName?: string;
  readonly districtProperties: readonly DistrictProperties[];
  readonly submittedDt: Date | null;
  readonly planscoreUrl: string;
};

@Injectable()
export class ProjectTemplatesService extends TypeOrmCrudService<ProjectTemplate> {
  constructor(@InjectRepository(ProjectTemplate) readonly repo: Repository<ProjectTemplate>) {
    super(repo);
  }

  async findAdminOrgProjectsWithDistrictProperties(
    slug: OrganizationSlug
  ): Promise<ProjectExportRow[]> {
    // Returns admin-only listing of all organization projects, with data for CSV export
    const builder = this.repo
      .createQueryBuilder("projectTemplate")
      .innerJoin("projectTemplate.organization", "organization")
      .innerJoin("projectTemplate.regionConfig", "regionConfig")
      .innerJoin("projectTemplate.projects", "projects")
      .innerJoin("projects.user", "user")
      .leftJoin("projects.chamber", "chamber")
      .where("organization.slug = :slug", { slug })
      .andWhere("projects.visibility <> :private", { private: ProjectVisibility.Private })
      .andWhere("projects.archived <> TRUE")
      .select("user.id", "userId")
      .addSelect("user.name", "userName")
      .addSelect("user.email", "userEmail")
      .addSelect("projects.name", "mapName")
      .addSelect("projects.id", "projectId")
      .addSelect("projects.createdDt", "createdDt")
      .addSelect("projects.updatedDt", "updatedDt")
      .addSelect("projects.submittedDt", "submittedDt")
      .addSelect("projects.planscoreUrl", "planscoreUrl")
      .addSelect("projectTemplate.name", "templateName")
      .addSelect("regionConfig.name", "regionName")
      .addSelect("regionConfig.s3URI", "regionS3URI")
      .addSelect("chamber.name", "chamberName")
      .addSelect(
        // Extract just the geojson properties, so we avoid querying the (much larger) geometries
        `jsonb_path_query_array("projects"."districts", '$.features[*].properties')`,
        "districtProperties"
      )
      .orderBy("projects.name");
    return builder.getRawMany<ProjectExportRow>();
  }

  async findAdminOrgProjects(slug: string): Promise<ProjectTemplate[]> {
    // Returns admin-only listing of all organization projects
    const builder = this.repo.createQueryBuilder("projectTemplate");
    const data = await builder
      .innerJoinAndSelect("projectTemplate.organization", "organization")
      .innerJoinAndSelect("projectTemplate.regionConfig", "regionConfig")
      .innerJoinAndSelect("projectTemplate.projects", "projects")
      .innerJoinAndSelect("projects.user", "user")
      .where("organization.slug = :slug", { slug })
      .andWhere("projects.visibility <> :private", { private: ProjectVisibility.Private })
      .andWhere("projects.archived <> TRUE")
      .select([
        "projectTemplate.name",
        "projectTemplate.numberOfDistricts",
        "projectTemplate.id",
        "projects.name",
        "projects.isFeatured",
        "projects.id",
        "projects.updatedDt",
        "projects.visibility",
        "projects.submittedDt",
        "regionConfig.name",
        "user.name",
        "user.email"
      ])
      .orderBy("projects.name")
      .getMany();
    return data;
  }

  async findOrgFeaturedProjects(slug: OrganizationSlug): Promise<ProjectTemplate[]> {
    // Returns public listing of all featured projects for an organization
    const builder = this.repo.createQueryBuilder("projectTemplate");
    const data = await selectSimplifiedDistricts(
      builder
        .innerJoin("projectTemplate.organization", "organization")
        .innerJoinAndSelect("projectTemplate.regionConfig", "regionConfig")
        .leftJoin("projectTemplate.projects", "project", "project.isFeatured = TRUE")
        .innerJoin("project.user", "user")
        .where("organization.slug = :slug", { slug: slug })
        .addSelect([
          "projectTemplate.name",
          "projectTemplate.numberOfDistricts",
          "projectTemplate.id",
          "project.name",
          "project.isFeatured",
          "project.id",
          "project.updatedDt",
          "user.name"
        ])
        .orderBy("project.name")
    ).getMany();
    return data;
  }

  async createFromProject(
    description: string,
    details: string,
    organization: Organization,
    project: Project
  ): Promise<ProjectTemplate> {
    const template = new ProjectTemplate();
    /* eslint-disable functional/immutable-data */
    template.description = description;
    template.details = details;
    template.organization = organization;

    template.name = project.name;
    template.numberOfDistricts = project.numberOfDistricts;
    template.districtsDefinition = project.districtsDefinition;
    template.numberOfMembers = project.numberOfMembers;
    template.pinnedMetricFields = project.pinnedMetricFields;
    template.populationDeviation = project.populationDeviation;

    template.regionConfig = project.regionConfig;
    template.chamber = project.chamber;
    /* eslint-enable functional/immutable-data */

    // @ts-ignore
    return this.repo.save(template);
  }

  async archiveProjectTemplate(id: ProjectTemplateId): Promise<ProjectTemplateId> {
    await this.repo
      .createQueryBuilder("projectTemplate")
      .update(ProjectTemplate)
      .set({ isActive: false })
      .where("id = :id", { id })
      .execute();
    return id;
  }
}
