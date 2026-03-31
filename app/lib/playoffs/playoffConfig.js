export const PLAYOFF_CURRENT_SEASON_ID = 20252026;
export const PLAYOFF_CURRENT_SEASON_KEY = "25-26";
export const PLAYOFF_REGULAR_SEASON_END_DATE = "2026-04-18";

export const PLAYOFF_CACHE_SECONDS = 900;
export const PLAYOFF_OVERVIEW_SIM_COUNT = 4000;
export const PLAYOFF_CONDITIONAL_SIM_COUNT = 1800;
export const PLAYOFF_MAX_LEAGUE_IMPACT_TEAMS = 8;
export const PLAYOFF_POINT_BIN_WIDTH = 4;
export const PLAYOFF_SERIES_HOME_ICE_EDGE = 0.045;
export const PLAYOFF_SERIES_STRENGTH_SCALE = 0.06;
export const PLAYOFF_DEFAULT_GAME_DATE_WINDOW = 7;

export const PLAYOFF_BRANCHES = [
  { key: "away_reg", label: "Away Win (Reg)", teamOutcomeLabel: { away: "If Win", home: "If Lose Reg" } },
  { key: "away_ot", label: "Away Win (OT)", teamOutcomeLabel: { away: "If Win", home: "If Lose OT" } },
  { key: "home_ot", label: "Home Win (OT)", teamOutcomeLabel: { away: "If Lose OT", home: "If Win" } },
  { key: "home_reg", label: "Home Win (Reg)", teamOutcomeLabel: { away: "If Lose Reg", home: "If Win" } },
];

export const CONFERENCE_KEYS = ["Eastern", "Western"];
