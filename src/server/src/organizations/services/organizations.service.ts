import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { TypeOrmCrudService } from "@nestjsx/crud-typeorm";
import { Repository } from "typeorm";

import { Organization } from "../entities/organization.entity";

@Injectable()
export class OrganizationsService extends TypeOrmCrudService<Organization> {
  constructor(@InjectRepository(Organization) repo: Repository<Organization>) {
    super(repo);
  }

  save(org: Organization): Promise<Organization> {
    // @ts-ignore
    return this.repo.save(org);
  }

  async getOrgAndProjectTemplates(slug: string): Promise<Organization | undefined> {
    // Returns public data for organization screen
    const builder = this.repo.createQueryBuilder("organization");
    const data = await builder
      .select()
      .leftJoin("organization.users", "users")
      .addSelect(["users.id", "users.name"])
      .leftJoin("organization.admin", "admin")
      .addSelect(["admin.id", "admin.name"])
      .leftJoin(
        "organization.projectTemplates",
        "projectTemplates",
        "projectTemplates.isActive = TRUE"
      )
      .addSelect([
        "projectTemplates.id",
        "projectTemplates.name",
        "projectTemplates.numberOfDistricts",
        "projectTemplates.description",
        "projectTemplates.details",
        "projectTemplates.isActive"
      ])
      .leftJoinAndSelect("projectTemplates.regionConfig", "regionConfig")
      .where("organization.slug = :slug", { slug: slug })
      .getOne();
    return data;
  }
}
