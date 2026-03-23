/**
 * Shared config for the Fantasy Hub.
 * Depends only on app-level season assumptions and drives local-state defaults,
 * scoring models, tab labels, and filter options used across the fantasy tools.
 */
import { TEAM_FULL } from "@/app/lib/nhlTeams";

export const CURRENT_SEASON = "25-26";
export const FANTASY_STORAGE_KEY = "nhl-analytics:fantasy-hub";

export const FANTASY_TABS = [
  { key: "my-team", label: "My Team" },
  { key: "rankings", label: "Rankings" },
  { key: "compare", label: "Compare Players" },
  { key: "schedule", label: "Schedule" },
];

export const TIMEFRAME_OPTIONS = [
  { key: "ros", label: "Rest of Season" },
  { key: "7d", label: "Next 7 Days" },
  { key: "14d", label: "Next 14 Days" },
];

export const COMPARE_TIMEFRAME_OPTIONS = [
  { key: "today", label: "Today" },
  { key: "this-week", label: "This Week" },
  { key: "7d", label: "Next 7 Days" },
  { key: "14d", label: "Next 14 Days" },
  { key: "ros", label: "Rest of Season" },
];

export const POSITION_OPTIONS = ["ALL", "F", "D", "G"];
export const ROSTER_FILTER_OPTIONS = [
  { key: "all", label: "All Players" },
  { key: "available", label: "Available" },
  { key: "rostered", label: "Rostered" },
];

export const TEAM_OPTIONS = [
  { value: "ALL", label: "All Teams" },
  ...Object.entries(TEAM_FULL).map(([abbr, name]) => ({
    value: abbr,
    label: name,
  })),
];

export const DEFAULT_FANTASY_STATE = {
  teamName: "My Fantasy Team",
  settings: {
    leagueType: "points",
    skaterWeights: {
      goals: 3,
      assists: 2,
      shots: 0.4,
      hits: 0.2,
      blocks: 0.25,
      ppp: 0.5,
      shp: 0,
      takeaways: 0,
      giveaways: 0,
      fol: 0,
      fwPct: 0,
      toi: 0,
      ppToi: 0,
    },
    goalieWeights: {
      wins: 3,
      saves: 0.2,
      goalsAgainst: -1,
      shutouts: 3,
      savePct: 0,
      gaa: 0,
      qualityStarts: 0,
      shotsAgainst: 0,
    },
    categoryWeights: {
      goals: true,
      assists: true,
      shots: true,
      hits: true,
      blocks: true,
      ppp: true,
      shp: false,
      takeaways: false,
      giveaways: false,
      fol: false,
      fwPct: false,
      toi: false,
      ppToi: false,
      wins: true,
      saves: true,
      savePct: true,
      gaa: true,
      qualityStarts: false,
      shotsAgainst: false,
    },
    rosterSlots: {
      forwards: 6,
      defense: 4,
      goalies: 2,
      bench: 4,
      ir: 1,
    },
  },
  roster: {
    forwards: [],
    defense: [],
    goalies: [],
    bench: [],
    ir: [],
  },
};
