/**
 * Shared constants for the Armchair GM roster builder page.
 * Depends on no external data beyond the season/year assumptions used
 * by the current NHL app and can be updated centrally each offseason.
 */
export const CURRENT_SEASON = "25-26";
export const CURRENT_OFFSEASON_YEAR = 2026;
export const NHL_CAP_CEILING = 88_000_000;
export const DEFAULT_TEAM_NAME = "My Team";

export const FORWARD_LINES = ["F1", "F2", "F3", "F4"];
export const DEFENSE_PAIRS = ["D1", "D2", "D3"];
export const GOALIE_SLOTS = ["G1", "G2"];

export const FORWARD_POSITIONS = ["LW", "C", "RW"];
export const DEFENSE_POSITIONS = ["LD", "RD"];
export const GOALIE_POSITION = "G";

export const POSITION_FILTERS = ["ALL", "F", "D", "G"];

export const ROSTER_SLOT_ORDER = [
  ["F1", "LW"],
  ["F1", "C"],
  ["F1", "RW"],
  ["F2", "LW"],
  ["F2", "C"],
  ["F2", "RW"],
  ["F3", "LW"],
  ["F3", "C"],
  ["F3", "RW"],
  ["F4", "LW"],
  ["F4", "C"],
  ["F4", "RW"],
  ["D1", "LD"],
  ["D1", "RD"],
  ["D2", "LD"],
  ["D2", "RD"],
  ["D3", "LD"],
  ["D3", "RD"],
  ["G1", "G"],
  ["G2", "G"],
];

export const EMPTY_ROSTER_STATE = {
  teamName: DEFAULT_TEAM_NAME,
  lines: {
    F1: { LW: null, C: null, RW: null },
    F2: { LW: null, C: null, RW: null },
    F3: { LW: null, C: null, RW: null },
    F4: { LW: null, C: null, RW: null },
    D1: { LD: null, RD: null },
    D2: { LD: null, RD: null },
    D3: { LD: null, RD: null },
    G1: { G: null },
    G2: { G: null },
  },
};
