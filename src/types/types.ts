export type TeamId = string;

export interface RecordSplit {
  wins: number;
  losses: number;
  overtimeLosses: number;
  pointPct?: number;
}

export interface RecentFormStats {
  pointsPct: number;
  goalsForPerGame?: number;
  goalsAgainstPerGame?: number;
  shotsForPerGame?: number;
  shotsAgainstPerGame?: number;
}

export interface StartingGoalieContext {
  goalieId?: string;
  goalieName?: string;
  savePct?: number;
  gsaxPer60?: number;
  gsaxPct?: number;
  qualityAdjustment?: number;
  confidence?: "confirmed" | "projected" | "unknown";
}

export interface TeamSeasonStats {
  teamId: TeamId;
  teamName: string;
  gamesPlayed: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  shotsForPerGame: number;
  shotsAgainstPerGame: number;
  xgfPer60: number;
  xgaPer60: number;
  fiveOnFiveXgfPct: number;
  homeCfPct?: number | null;
  awayCfPct?: number | null;
  shootingPct: number;
  savePct: number;
  powerPlayPct: number;
  penaltyKillPct: number;
  recent10: RecentFormStats;
  homeRecord: RecordSplit;
  awayRecord: RecordSplit;
}

export interface GameContext {
  homeTeam: TeamSeasonStats;
  awayTeam: TeamSeasonStats;
  homeRestDays: number;
  awayRestDays: number;
  homeBackToBack: boolean;
  awayBackToBack: boolean;
  homeTravelDisadvantage?: boolean;
  awayTravelDisadvantage?: boolean;
  homeStartingGoalie?: StartingGoalieContext;
  awayStartingGoalie?: StartingGoalieContext;
  homeInjuryAdjustment?: number;
  awayInjuryAdjustment?: number;
  homeLineupStrengthAdjustment?: number;
  awayLineupStrengthAdjustment?: number;
  homeWarTotal?: number;
  awayWarTotal?: number;
}

export interface MarketInputs {
  homeMoneyline?: number;
  awayMoneyline?: number;
  marketCalibrationWeight?: number;
}

export interface ModelWeights {
  offense: {
    goalsFor: number;
    xgfPer60: number;
    fiveOnFiveXgfPct: number;
    shotsFor: number;
    splitRecord: number;
  };
  defense: {
    goalsAgainst: number;
    xgaPer60: number;
    shotsAgainst: number;
    fiveOnFiveXgfPct: number;
    splitRecord: number;
  };
  expectedShots: {
    offense: number;
    shotRate: number;
    opponentShotSuppression: number;
    form: number;
    schedule: number;
    homeIce: number;
  };
  expectedGoals: {
    offense: number;
    opponentDefense: number;
    finishing: number;
    opponentGoaltending: number;
    specialTeams: number;
    homeIce: number;
  };
  overtime: {
    offense: number;
    finishing: number;
    goaltending: number;
    homeIce: number;
  };
}

export interface ModelConfig {
  modelVersion: string;
  simulationCount: number;
  leagueAverages: {
    goalsPerTeamGame: number;
    shotsPerTeamGame: number;
    xgfPer60: number;
    xgaPer60: number;
    fiveOnFiveXgfPct: number;
    shootingPct: number;
    savePct: number;
    powerPlayPct: number;
    penaltyKillPct: number;
    xgPerShot: number;
  };
  shrinkageGames: {
    shootingPct: number;
    savePct: number;
    recentForm: number;
  };
  homeIceAdvantage: {
    goals: number;
    shots: number;
    overtimeWinPct: number;
  };
  fatigueAdjustments: {
    backToBackPenalty: number;
    travelPenalty: number;
    extraRestBoostPerDay: number;
    maxRestBoost: number;
  };
  simulation: {
    overtimeResolutionRate: number;
    shootoutHomeEdge: number;
    maxGoalsTracked: number;
  };
  shotAndGoalBounds: {
    minShots: number;
    maxShots: number;
    minGoals: number;
    maxGoals: number;
  };
  weights: ModelWeights;
}

export interface EngineeredTeamFeatures {
  teamId: TeamId;
  teamName: string;
  side: "home" | "away";
  offenseStrengthScore: number;
  defenseStrengthScore: number;
  shotGenerationScore: number;
  shotSuppressionScore: number;
  finishingScore: number;
  goaltendingScore: number;
  recentFormAdjustment: number;
  specialTeamsAdjustment: number;
  scheduleFatigueAdjustment: number;
  homeIceAdjustment: number;
  splitRecordAdjustment: number;
  injuryAdjustment: number;
  lineupStrengthAdjustment: number;
  regressedShootingPct: number;
  regressedSavePct: number;
}

export interface TeamRatings {
  teamId: TeamId;
  teamName: string;
  side: "home" | "away";
  offenseRating: number;
  defenseRating: number;
  shotRateRating: number;
  shotSuppressionRating: number;
  finishingRating: number;
  goaltendingRating: number;
  specialTeamsRating: number;
  formRating: number;
  contextMultiplier: number;
  scheduleAdjustment: number;
  homeIceAdjustment: number;
  features: EngineeredTeamFeatures;
}

export interface ScoringModelResult {
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  expectedHomeShots: number;
  expectedAwayShots: number;
  homeRegulationLambda: number;
  awayRegulationLambda: number;
}

export interface ScoreOutcome {
  home: number;
  away: number;
  probability: number;
}

export interface FairOdds {
  homeMoneyline: number;
  awayMoneyline: number;
}

export interface BackToBackAdjustment {
  away: boolean;
  home: boolean;
  penaltyApplied: "road" | "home" | "both" | "none";
  adjustment: number;
}

export interface ModelDiagnostics {
  simulationCount: number;
  modelVersion: string;
  confidenceBand: "low" | "medium" | "high";
  confidenceReason?: string;
  regulationHomeWinPct: number;
  regulationAwayWinPct: number;
  overtimeHomeWinPct: number;
  overtimeAwayWinPct: number;
  shootoutHomeWinPct: number;
  shootoutAwayWinPct: number;
  marketBlendApplied: boolean;
}

export interface GamePrediction {
  homeTeam: string;
  awayTeam: string;
  homeWinPct: number;
  awayWinPct: number;
  regulationTiePct: number;
  overtimePct: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  expectedHomeShots: number;
  expectedAwayShots: number;
  mostLikelyScores: ScoreOutcome[];
  fairOdds: FairOdds;
  b2b: BackToBackAdjustment;
  goalieConfidence: "confirmed" | "projected" | "unknown";
  modelDiagnostics: ModelDiagnostics;
}

export interface HistoricalGameRecord {
  id: string;
  context: GameContext;
  actualHomeWin: boolean;
  actualAwayWin: boolean;
  actualWentToOvertime?: boolean;
  actualHomeGoals?: number;
  actualAwayGoals?: number;
  marketInputs?: MarketInputs;
}

export interface HistoricalPredictionRecord {
  id: string;
  predictedHomeWinProbability: number;
  actualHomeWin: boolean;
}

export interface CalibrationBucket {
  bucketStart: number;
  bucketEnd: number;
  sampleCount: number;
  averagePredicted: number;
  actualWinRate: number;
}

export interface BacktestSummary {
  sampleCount: number;
  averageLogLoss: number;
  averageBrierScore: number;
  calibration: CalibrationBucket[];
}
