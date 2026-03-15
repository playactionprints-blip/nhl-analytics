import type { ModelConfig } from "../types/types";

export const NHL_LEAGUE_AVERAGES = {
  goalsPerTeamGame: 3.05,
  shotsPerTeamGame: 29.8,
  xgfPer60: 2.58,
  xgaPer60: 2.58,
  fiveOnFiveXgfPct: 50,
  shootingPct: 0.099,
  savePct: 0.903,
  powerPlayPct: 0.215,
  penaltyKillPct: 0.785,
  xgPerShot: 0.0975,
} as const;

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  modelVersion: "v1",
  simulationCount: 10000,
  leagueAverages: NHL_LEAGUE_AVERAGES,
  shrinkageGames: {
    shootingPct: 60,
    savePct: 60,
    recentForm: 12,
  },
  homeIceAdvantage: {
    goals: 0.12,
    shots: 0.9,
    overtimeWinPct: 0.02,
  },
  fatigueAdjustments: {
    backToBackPenalty: 0.035,
    travelPenalty: 0.02,
    extraRestBoostPerDay: 0.006,
    maxRestBoost: 0.03,
  },
  simulation: {
    overtimeResolutionRate: 0.78,
    shootoutHomeEdge: 0.01,
    maxGoalsTracked: 8,
  },
  shotAndGoalBounds: {
    minShots: 20,
    maxShots: 42,
    minGoals: 1.6,
    maxGoals: 5.8,
  },
  weights: {
    offense: {
      goalsFor: 0.26,
      xgfPer60: 0.28,
      fiveOnFiveXgfPct: 0.14,
      shotsFor: 0.2,
      splitRecord: 0.12,
    },
    defense: {
      goalsAgainst: 0.28,
      xgaPer60: 0.28,
      shotsAgainst: 0.22,
      fiveOnFiveXgfPct: 0.1,
      splitRecord: 0.12,
    },
    expectedShots: {
      offense: 0.25,
      shotRate: 0.28,
      opponentShotSuppression: 0.24,
      form: 0.08,
      schedule: 0.08,
      homeIce: 0.07,
    },
    expectedGoals: {
      offense: 0.25,
      opponentDefense: 0.2,
      finishing: 0.18,
      opponentGoaltending: 0.18,
      specialTeams: 0.1,
      homeIce: 0.09,
    },
    overtime: {
      offense: 0.4,
      finishing: 0.22,
      goaltending: 0.28,
      homeIce: 0.1,
    },
  },
};

export const DEFAULT_MARKET_CALIBRATION_WEIGHT = 0;
