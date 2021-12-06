/** @jsx jsx */
import { jsx, Checkbox, Label, Select } from "theme-ui";
import { Button as MenuButton, Wrapper, Menu } from "react-aria-menubutton";
import { style } from "./MenuButton.styles";
import store from "../store";
import {
  toggleLimitDrawingToWithinCounty,
  setElectionYear,
  setPopulationKey
} from "../actions/projectOptions";
import Tooltip from "./Tooltip";
import Icon from "./Icon";
import { IStaticMetadata, GroupTotal } from "../../shared/entities";
import { ElectionYear } from "../types";

function getPopulationLabel(key: string) {
  return key === "population"
    ? "All people"
    : key === "VAP"
    ? "Voting age population (VAP)"
    : key === "CVAP"
    ? "Citizen voting age population (CVAP)"
    : key;
}

const MapSelectionOptionsFlyout = ({
  limitSelectionToCounty,
  metadata,
  topGeoLevelName,
  electionYear,
  populationKey
}: {
  readonly limitSelectionToCounty: boolean;
  readonly metadata?: IStaticMetadata;
  readonly topGeoLevelName?: string;
  readonly electionYear: ElectionYear;
  readonly populationKey: GroupTotal;
}) => {
  const votingIds = metadata?.voting?.map(file => file.id) || [];
  const hasMultipleElections =
    votingIds.some(id => id.endsWith("16")) && votingIds.some(id => id.endsWith("20"));
  const populations =
    metadata?.demographicsGroups?.flatMap(group => (group.total ? [group.total] : [])) || [];
  const hasMultiplePopulationTotals = populations.length > 1;
  return (
    <Wrapper closeOnSelection={false}>
      <Tooltip content="Drawing options">
        <MenuButton
          sx={{
            outline: "none",
            display: "inline-block",
            height: "22px",
            width: "22px",
            textAlign: "center",
            borderRadius: "100px",
            cursor: "pointer",
            "&:hover:not([disabled]):not(:active)": {
              bg: "rgba(89, 89, 89, 0.1)"
            },
            "&:focus": {
              boxShadow: "0 0 0 2px rgb(109 152 186 / 30%)"
            }
          }}
        >
          <Icon name="cog" />
        </MenuButton>
      </Tooltip>
      <Menu sx={{ ...style.menu }}>
        <ul sx={style.menuList}>
          <li>
            <legend>Drawing</legend>
            <Label
              sx={{
                textTransform: "none",
                color: "heading",
                lineHeight: "1.2",
                fontWeight: "medium"
              }}
            >
              <Checkbox
                onChange={() => {
                  store.dispatch(toggleLimitDrawingToWithinCounty());
                }}
                defaultChecked={limitSelectionToCounty}
              />
              Limit drawing to within {topGeoLevelName}
            </Label>
          </li>
          {hasMultipleElections && (
            <li>
              <legend>Tooltip</legend>
              <Label
                htmlFor="election-dropdown"
                sx={{ display: "inline-block", width: "auto", mb: 0, mr: 2 }}
              >
                Election data:
              </Label>
              <Select
                id="election-dropdown"
                value={electionYear}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const year = e.currentTarget.value;
                  (year === "16" || year === "20") && store.dispatch(setElectionYear(year));
                }}
              >
                <option value={"16"}>Presidential 2016</option>
                <option value={"20"}>Presidential 2020</option>
              </Select>
            </li>
          )}
          {hasMultiplePopulationTotals && (
            <li>
              <legend>Districts</legend>
              <Label
                htmlFor="demographics-dropdown"
                sx={{ display: "inline-block", width: "auto", mb: 0, mr: 2 }}
              >
                Population:
              </Label>
              <Select
                id="demographics-dropdown"
                value={populationKey}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  const key = e.currentTarget.value;
                  store.dispatch(setPopulationKey(key));
                }}
                sx={{ width: "150px" }}
              >
                {populations?.map(key => (
                  <option key={key} value={key}>
                    {getPopulationLabel(key)}
                  </option>
                ))}
              </Select>
            </li>
          )}
        </ul>
      </Menu>
    </Wrapper>
  );
};

export default MapSelectionOptionsFlyout;
