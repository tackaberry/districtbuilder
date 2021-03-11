/** @jsx jsx */
import { useEffect } from "react";
import { connect } from "react-redux";
import { useParams } from "react-router-dom";
import { Box, Flex, Heading, jsx } from "theme-ui";
import { organizationFetch } from "../actions/organization";
import { organizationProjectsFetch } from "../actions/organizationProjects";
import { State } from "../reducers";
import { OrganizationState } from "../reducers/organization";
import { UserState } from "../reducers/user";
import store from "../store";
import SiteHeader from "../components/SiteHeader";
import PageNotFoundScreen from "./PageNotFoundScreen";
import { OrganizationProjectsState } from "../reducers/organizationProjects";
import OrganizationAdminProjectsTable from "../components/OrganizationAdminProjectsTable";
import { userFetch } from "../actions/user";
import { isThisYear, isToday } from "date-fns";
import format from "date-fns/format";

interface StateProps {
  readonly organization: OrganizationState;
  readonly organizationProjects: OrganizationProjectsState;
  readonly user: UserState;
}

const style = {
  main: { width: "100%", mx: 0, flexDirection: "column" },
  header: {
    bg: "gray.0",
    borderBottom: "1px solid",
    borderColor: "gray.1",
    boxShadow: "small",
    p: 5,
    "> *": {
      m: 5
    }
  },
  projectList: {
    borderColor: "gray.1",
    boxShadow: "small",
    p: 5,
    "> *": {
      m: 5
    }
  },
  projectCount: {
    float: "right"
  },
  project: {
    boxShadow: "small",
    p: 20,
    "> *": {
      m: 5
    }
  },
  logo: {
    flex: "none",
    objectFit: "contain"
  },
  item: {
    pr: 2
  },
  join: {
    whiteSpace: "nowrap"
  },
  joinText: {
    fontSize: 0,
    maxWidth: "200px",
    p: 1,
    pt: 3,
    textAlign: "center"
  },
  templates: {
    p: 5
  },
  templateContainer: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, 300px)",
    gridGap: "30px",
    justifyContent: "space-between"
  },
  template: {
    flexDirection: "column"
  }
} as const;

function formatDate(date: Date): string {
  const d = new Date(date);
  return date
    ? isToday(d)
      ? format(d, "h:mm a")
      : isThisYear(d)
      ? format(d, "MMM d")
      : format(d, "MMM d yyyy")
    : "—";
}

const OrganizationAdminScreen = ({ organization, user, organizationProjects }: StateProps) => {
  const { organizationSlug } = useParams();
  const projects =
    "resource" in organizationProjects.projectTemplates
      ? organizationProjects.projectTemplates.resource
          .map(pt => {
            return pt.projects.map(p => {
              return {
                ...p,
                updatedAgo: formatDate(p.updatedDt),
                creator: p.user.name,
                templateName: pt.name,
                regionConfig: pt.regionConfig,
                numberOfDistricts: pt.numberOfDistricts
              };
            });
          })
          .flat()
      : undefined;

  const featuredProjects = projects?.reduce((total, x) => (x.isFeatured ? total + 1 : total), 0);

  const userIsAdmin =
    "resource" in organization && "resource" in user
      ? organization.resource.admin?.id === user.resource.id
      : null;

  useEffect(() => {
    store.dispatch(organizationProjectsFetch(organizationSlug));
    store.dispatch(organizationFetch(organizationSlug));
    store.dispatch(userFetch());
  }, [organizationSlug]);

  return (
    <Flex sx={{ flexDirection: "column" }}>
      <SiteHeader user={user} />
      <Flex as="main" sx={style.main}>
        {"resource" in organization && userIsAdmin ? (
          <Box>
            <Flex sx={style.header}>
              <Box>
                <Heading as="h3">{organization.resource.name}</Heading>
                <Heading>Maps</Heading>
                <Box>
                  Published maps that were created by members of your organization. You can select
                  up to 12 maps to feature on your organization profile page.
                </Box>
              </Box>
            </Flex>
            {projects ? (
              <Box sx={{ p: 5 }}>
                <OrganizationAdminProjectsTable
                  projects={projects}
                  organizationSlug={organizationSlug}
                />
                <Box>
                  {featuredProjects ? (
                    <Box sx={style.projectCount}>
                      <strong>{featuredProjects}</strong> / 12 projects currently featured
                    </Box>
                  ) : (
                    <Box sx={style.projectCount}>0 / 12 projects currently featured</Box>
                  )}
                </Box>
              </Box>
            ) : (
              <div>Loading</div>
            )}
          </Box>
        ) : ("statusCode" in organization && organization.statusCode === 404) ||
          userIsAdmin === false ? (
          <PageNotFoundScreen model={"organization"} />
        ) : (
          <Box>Loading...</Box>
        )}
      </Flex>
    </Flex>
  );
};

function mapStateToProps(state: State): StateProps {
  return {
    organization: state.organization,
    organizationProjects: state.organizationProjects,
    user: state.user
  };
}

export default connect(mapStateToProps)(OrganizationAdminScreen);
