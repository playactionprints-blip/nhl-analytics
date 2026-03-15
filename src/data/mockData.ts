import type { GameContext, HistoricalGameRecord, MarketInputs, TeamSeasonStats } from "../types/types";

export const torontoMapleLeafs: TeamSeasonStats = {
  teamId: "TOR",
  teamName: "Toronto Maple Leafs",
  gamesPlayed: 66,
  goalsForPerGame: 3.31,
  goalsAgainstPerGame: 2.87,
  shotsForPerGame: 31.2,
  shotsAgainstPerGame: 28.8,
  xgfPer60: 2.81,
  xgaPer60: 2.45,
  fiveOnFiveXgfPct: 52.6,
  shootingPct: 0.107,
  savePct: 0.905,
  powerPlayPct: 0.241,
  penaltyKillPct: 0.791,
  recent10: {
    pointsPct: 0.65,
    goalsForPerGame: 3.5,
    goalsAgainstPerGame: 2.7,
  },
  homeRecord: {
    wins: 20,
    losses: 10,
    overtimeLosses: 3,
    pointPct: 0.652,
  },
  awayRecord: {
    wins: 18,
    losses: 12,
    overtimeLosses: 3,
    pointPct: 0.591,
  },
};

export const bostonBruins: TeamSeasonStats = {
  teamId: "BOS",
  teamName: "Boston Bruins",
  gamesPlayed: 66,
  goalsForPerGame: 3.08,
  goalsAgainstPerGame: 2.95,
  shotsForPerGame: 30.1,
  shotsAgainstPerGame: 29.2,
  xgfPer60: 2.63,
  xgaPer60: 2.58,
  fiveOnFiveXgfPct: 51.1,
  shootingPct: 0.101,
  savePct: 0.901,
  powerPlayPct: 0.227,
  penaltyKillPct: 0.796,
  recent10: {
    pointsPct: 0.58,
    goalsForPerGame: 3.0,
    goalsAgainstPerGame: 2.9,
  },
  homeRecord: {
    wins: 19,
    losses: 11,
    overtimeLosses: 3,
    pointPct: 0.621,
  },
  awayRecord: {
    wins: 17,
    losses: 13,
    overtimeLosses: 3,
    pointPct: 0.561,
  },
};

export const mockGameContext: GameContext = {
  homeTeam: torontoMapleLeafs,
  awayTeam: bostonBruins,
  homeRestDays: 2,
  awayRestDays: 1,
  homeBackToBack: false,
  awayBackToBack: true,
  awayTravelDisadvantage: true,
  homeStartingGoalie: {
    goalieName: "Joseph Woll",
    savePct: 0.908,
    gsaxPer60: 0.08,
  },
  awayStartingGoalie: {
    goalieName: "Jeremy Swayman",
    savePct: 0.905,
    gsaxPer60: 0.03,
  },
  homeInjuryAdjustment: -0.015,
  awayInjuryAdjustment: -0.03,
  homeLineupStrengthAdjustment: 0.01,
  awayLineupStrengthAdjustment: -0.01,
};

export const mockMarketInputs: MarketInputs = {
  homeMoneyline: -120,
  awayMoneyline: +108,
  marketCalibrationWeight: 0.1,
};

export const mockBacktestGames: HistoricalGameRecord[] = [
  {
    id: "game-1",
    context: mockGameContext,
    actualHomeWin: true,
    actualAwayWin: false,
    actualWentToOvertime: false,
    actualHomeGoals: 4,
    actualAwayGoals: 2,
    marketInputs: mockMarketInputs,
  },
  {
    id: "game-2",
    context: {
      ...mockGameContext,
      homeTeam: bostonBruins,
      awayTeam: torontoMapleLeafs,
      homeRestDays: 1,
      awayRestDays: 2,
      homeBackToBack: false,
      awayBackToBack: false,
    },
    actualHomeWin: false,
    actualAwayWin: true,
    actualWentToOvertime: true,
    actualHomeGoals: 2,
    actualAwayGoals: 3,
  },
];
