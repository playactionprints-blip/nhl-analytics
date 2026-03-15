import { DEFAULT_MODEL_CONFIG } from "../data/leagueConstants";
import type { GameContext, ModelConfig, ScoringModelResult, TeamRatings } from "../types/types";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fromIndex(indexValue: number): number {
  return indexValue / 100;
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / Math.max(1, totalWeight);
}

function estimateShotsForSide(
  attacking: TeamRatings,
  defending: TeamRatings,
  side: "home" | "away",
  config: ModelConfig
): number {
  // Shots are driven mostly by shot creation plus opponent suppression, with
  // lighter schedule/form/home effects to keep the environment realistic.
  const weights = config.weights.expectedShots;
  const offense = fromIndex(attacking.offenseRating);
  const shotRate = fromIndex(attacking.shotRateRating);
  const opponentSuppression = 1 / fromIndex(defending.shotSuppressionRating);
  const form = fromIndex(attacking.formRating);
  const schedule = attacking.scheduleAdjustment;
  const homeIceBoost = side === "home"
    ? 1 + config.homeIceAdvantage.shots / config.leagueAverages.shotsPerTeamGame
    : 1 - config.homeIceAdvantage.shots / config.leagueAverages.shotsPerTeamGame / 2;

  const shotMultiplier = weightedAverage([
    { value: offense, weight: weights.offense },
    { value: shotRate, weight: weights.shotRate },
    { value: opponentSuppression, weight: weights.opponentShotSuppression },
    { value: form, weight: weights.form },
    { value: schedule, weight: weights.schedule },
    { value: homeIceBoost, weight: weights.homeIce },
  ]) * attacking.features.injuryAdjustment * attacking.features.lineupStrengthAdjustment;

  return clamp(
    config.leagueAverages.shotsPerTeamGame * shotMultiplier,
    config.shotAndGoalBounds.minShots,
    config.shotAndGoalBounds.maxShots
  );
}

function estimateGoalsForSide(
  expectedShots: number,
  attacking: TeamRatings,
  defending: TeamRatings,
  side: "home" | "away",
  config: ModelConfig
): number {
  // Goals are estimated off expected shot volume, then adjusted by team scoring
  // talent, opponent defense, goaltending, and a small special-teams signal.
  const weights = config.weights.expectedGoals;
  const attackStrength = fromIndex(attacking.offenseRating);
  const opponentDefense = 1 / fromIndex(defending.defenseRating);
  const finishing = fromIndex(attacking.finishingRating);
  const opponentGoaltending = 1 / fromIndex(defending.goaltendingRating);
  const specialTeams = fromIndex(attacking.specialTeamsRating);
  const homeIceGoalFactor = side === "home"
    ? 1 + config.homeIceAdvantage.goals / config.leagueAverages.goalsPerTeamGame
    : 1 - config.homeIceAdvantage.goals / config.leagueAverages.goalsPerTeamGame / 2;

  const scoringMultiplier = weightedAverage([
    { value: attackStrength, weight: weights.offense },
    { value: opponentDefense, weight: weights.opponentDefense },
    { value: finishing, weight: weights.finishing },
    { value: opponentGoaltending, weight: weights.opponentGoaltending },
    { value: specialTeams, weight: weights.specialTeams },
    { value: homeIceGoalFactor, weight: weights.homeIce },
  ]) * attacking.contextMultiplier;

  const expectedGoals = expectedShots * config.leagueAverages.xgPerShot * scoringMultiplier;
  return clamp(expectedGoals, config.shotAndGoalBounds.minGoals, config.shotAndGoalBounds.maxGoals);
}

export function estimateExpectedScoring(
  homeRatings: TeamRatings,
  awayRatings: TeamRatings,
  _context: GameContext,
  config: ModelConfig = DEFAULT_MODEL_CONFIG
): ScoringModelResult {
  const expectedHomeShots = estimateShotsForSide(homeRatings, awayRatings, "home", config);
  const expectedAwayShots = estimateShotsForSide(awayRatings, homeRatings, "away", config);

  const expectedHomeGoals = estimateGoalsForSide(expectedHomeShots, homeRatings, awayRatings, "home", config);
  const expectedAwayGoals = estimateGoalsForSide(expectedAwayShots, awayRatings, homeRatings, "away", config);

  return {
    expectedHomeGoals,
    expectedAwayGoals,
    expectedHomeShots,
    expectedAwayShots,
    homeRegulationLambda: expectedHomeGoals,
    awayRegulationLambda: expectedAwayGoals,
  };
}
