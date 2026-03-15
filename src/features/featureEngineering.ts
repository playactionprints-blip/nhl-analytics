import { DEFAULT_MODEL_CONFIG } from "../data/leagueConstants";
import type {
  EngineeredTeamFeatures,
  GameContext,
  ModelConfig,
  RecordSplit,
  TeamSeasonStats,
} from "../types/types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return 1;
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function regressRateToLeagueAverage(
  observedRate: number,
  gamesPlayed: number,
  leagueAverage: number,
  shrinkageGames: number
): number {
  // Simple empirical-Bayes style shrinkage keeps noisy finishing/save samples
  // from dominating early-season or small-sample projections.
  const weightedObserved = observedRate * gamesPlayed;
  const weightedLeague = leagueAverage * shrinkageGames;
  return (weightedObserved + weightedLeague) / Math.max(1, gamesPlayed + shrinkageGames);
}

function recordPointPct(record: RecordSplit): number {
  if (typeof record.pointPct === "number") {
    return record.pointPct;
  }
  const games = record.wins + record.losses + record.overtimeLosses;
  if (games === 0) return 0.5;
  return (record.wins * 2 + record.overtimeLosses) / (games * 2);
}

function recentFormAdjustment(team: TeamSeasonStats, config: ModelConfig): number {
  const form = team.recent10;
  const pointPctEdge = form.pointsPct - 0.5;
  const goalEdge =
    typeof form.goalsForPerGame === "number" && typeof form.goalsAgainstPerGame === "number"
      ? (form.goalsForPerGame - form.goalsAgainstPerGame) / 6
      : 0;
  const raw = 1 + pointPctEdge * 0.24 + goalEdge * 0.08;
  return clamp(raw, 0.92, 1.08);
}

function scheduleFatigueAdjustment(side: "home" | "away", context: GameContext, config: ModelConfig): number {
  const restDays = side === "home" ? context.homeRestDays : context.awayRestDays;
  const backToBack = side === "home" ? context.homeBackToBack : context.awayBackToBack;
  const travelDisadvantage = side === "home" ? context.homeTravelDisadvantage : context.awayTravelDisadvantage;

  let adjustment = 1;
  if (backToBack) {
    adjustment -= config.fatigueAdjustments.backToBackPenalty;
  }
  if (travelDisadvantage) {
    adjustment -= config.fatigueAdjustments.travelPenalty;
  }

  const extraRestBoost = clamp(restDays - 1, 0, 5) * config.fatigueAdjustments.extraRestBoostPerDay;
  adjustment += Math.min(config.fatigueAdjustments.maxRestBoost, extraRestBoost);

  return clamp(adjustment, 0.9, 1.05);
}

function homeIceAdjustment(side: "home" | "away"): number {
  return side === "home" ? 1.02 : 0.98;
}

function lineupAndInjuryAdjustment(side: "home" | "away", context: GameContext): {
  injuryAdjustment: number;
  lineupStrengthAdjustment: number;
} {
  const injury = side === "home" ? context.homeInjuryAdjustment ?? 0 : context.awayInjuryAdjustment ?? 0;
  const lineup = side === "home" ? context.homeLineupStrengthAdjustment ?? 0 : context.awayLineupStrengthAdjustment ?? 0;

  return {
    injuryAdjustment: clamp(1 + injury, 0.85, 1.1),
    lineupStrengthAdjustment: clamp(1 + lineup, 0.9, 1.1),
  };
}

function goalieAdjustment(side: "home" | "away", context: GameContext): number {
  const starter = side === "home" ? context.homeStartingGoalie : context.awayStartingGoalie;
  if (!starter) return 1;

  const savePctDelta =
    typeof starter.savePct === "number"
      ? (starter.savePct - DEFAULT_MODEL_CONFIG.leagueAverages.savePct) / DEFAULT_MODEL_CONFIG.leagueAverages.savePct
      : 0;
  const gsaxBoost = typeof starter.gsaxPer60 === "number" ? starter.gsaxPer60 * 0.04 : 0;
  const qualityAdjustment = starter.qualityAdjustment ?? 0;

  return clamp(1 + savePctDelta + gsaxBoost + qualityAdjustment, 0.9, 1.12);
}

export function buildEngineeredTeamFeatures(
  team: TeamSeasonStats,
  side: "home" | "away",
  context: GameContext,
  config: ModelConfig = DEFAULT_MODEL_CONFIG
): EngineeredTeamFeatures {
  const league = config.leagueAverages;
  const splitRecord = side === "home" ? team.homeRecord : team.awayRecord;
  const overallPointPct = (team.goalsForPerGame + team.goalsAgainstPerGame) > 0
    ? (team.homeRecord.wins + team.awayRecord.wins) * 2 /
      Math.max(
        1,
        (team.homeRecord.wins + team.homeRecord.losses + team.homeRecord.overtimeLosses +
          team.awayRecord.wins + team.awayRecord.losses + team.awayRecord.overtimeLosses) * 2
      )
    : 0.5;
  const splitRecordAdjustment = clamp(recordPointPct(splitRecord) / Math.max(0.35, overallPointPct), 0.92, 1.08);

  const regressedShootingPct = regressRateToLeagueAverage(
    team.shootingPct,
    team.gamesPlayed,
    league.shootingPct,
    config.shrinkageGames.shootingPct
  );

  const baseSavePct = regressRateToLeagueAverage(
    team.savePct,
    team.gamesPlayed,
    league.savePct,
    config.shrinkageGames.savePct
  );

  // Goalie context is layered on top of the regressed team save environment so
  // later goalie models can improve this component without changing the rest.
  const goalieMultiplier = goalieAdjustment(side, context);
  const regressedSavePct = clamp(baseSavePct * goalieMultiplier, 0.875, 0.93);

  const offenseStrengthScore = weightedAverage([
    { value: team.goalsForPerGame / league.goalsPerTeamGame, weight: config.weights.offense.goalsFor },
    { value: team.xgfPer60 / league.xgfPer60, weight: config.weights.offense.xgfPer60 },
    { value: team.fiveOnFiveXgfPct / league.fiveOnFiveXgfPct, weight: config.weights.offense.fiveOnFiveXgfPct },
    { value: team.shotsForPerGame / league.shotsPerTeamGame, weight: config.weights.offense.shotsFor },
    { value: splitRecordAdjustment, weight: config.weights.offense.splitRecord },
  ]);

  const defenseStrengthScore = weightedAverage([
    { value: league.goalsPerTeamGame / Math.max(1.8, team.goalsAgainstPerGame), weight: config.weights.defense.goalsAgainst },
    { value: league.xgaPer60 / Math.max(1.8, team.xgaPer60), weight: config.weights.defense.xgaPer60 },
    { value: league.shotsPerTeamGame / Math.max(20, team.shotsAgainstPerGame), weight: config.weights.defense.shotsAgainst },
    { value: team.fiveOnFiveXgfPct / league.fiveOnFiveXgfPct, weight: config.weights.defense.fiveOnFiveXgfPct },
    { value: splitRecordAdjustment, weight: config.weights.defense.splitRecord },
  ]);

  const shotGenerationScore = clamp(
    weightedAverage([
      { value: team.shotsForPerGame / league.shotsPerTeamGame, weight: 0.65 },
      { value: team.xgfPer60 / league.xgfPer60, weight: 0.35 },
    ]),
    0.8,
    1.2
  );

  const shotSuppressionScore = clamp(
    weightedAverage([
      { value: league.shotsPerTeamGame / Math.max(20, team.shotsAgainstPerGame), weight: 0.6 },
      { value: league.xgaPer60 / Math.max(1.8, team.xgaPer60), weight: 0.4 },
    ]),
    0.8,
    1.2
  );

  const finishingScore = clamp(regressedShootingPct / league.shootingPct, 0.9, 1.1);
  const goaltendingScore = clamp(regressedSavePct / league.savePct, 0.94, 1.08);
  const specialTeamsAdjustment = clamp(
    weightedAverage([
      { value: team.powerPlayPct / league.powerPlayPct, weight: 0.55 },
      { value: team.penaltyKillPct / league.penaltyKillPct, weight: 0.45 },
    ]),
    0.9,
    1.1
  );

  const formAdjustment = recentFormAdjustment(team, config);
  const fatigueAdjustment = scheduleFatigueAdjustment(side, context, config);
  const homeIce = homeIceAdjustment(side);
  const { injuryAdjustment, lineupStrengthAdjustment } = lineupAndInjuryAdjustment(side, context);

  return {
    teamId: team.teamId,
    teamName: team.teamName,
    side,
    offenseStrengthScore,
    defenseStrengthScore,
    shotGenerationScore,
    shotSuppressionScore,
    finishingScore,
    goaltendingScore,
    recentFormAdjustment: formAdjustment,
    specialTeamsAdjustment,
    scheduleFatigueAdjustment: fatigueAdjustment,
    homeIceAdjustment: homeIce,
    splitRecordAdjustment,
    injuryAdjustment,
    lineupStrengthAdjustment,
    regressedShootingPct,
    regressedSavePct,
  };
}
