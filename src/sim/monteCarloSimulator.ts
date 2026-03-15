import { DEFAULT_MODEL_CONFIG } from "../data/leagueConstants";
import type {
  GamePrediction,
  ModelConfig,
  ModelDiagnostics,
  ScoreOutcome,
  ScoringModelResult,
  TeamRatings,
} from "../types/types";
import { clampProbability, impliedProbabilityToAmericanOdds } from "../utils/odds";

function poissonSample(lambda: number, random: () => number): number {
  const l = Math.exp(-lambda);
  let p = 1;
  let k = 0;
  do {
    k += 1;
    p *= random();
  } while (p > l);
  return k - 1;
}

function topScoreOutcomes(scoreCounts: Map<string, number>, simulationCount: number, limit: number): ScoreOutcome[] {
  return [...scoreCounts.entries()]
    .map(([key, count]) => {
      const [home, away] = key.split("-").map(Number);
      return {
        home,
        away,
        probability: count / simulationCount,
      };
    })
    .sort((a, b) => b.probability - a.probability)
    .slice(0, limit);
}

function buildConfidenceBand(homeWinPct: number, expectedGoalEdge: number): ModelDiagnostics["confidenceBand"] {
  const edge = Math.abs(homeWinPct - 0.5);
  if (edge >= 0.12 && Math.abs(expectedGoalEdge) >= 0.55) {
    return "high";
  }
  if (edge >= 0.07 && Math.abs(expectedGoalEdge) >= 0.25) {
    return "medium";
  }
  return "low";
}

function overtimeHomeWinProbability(homeRatings: TeamRatings, awayRatings: TeamRatings, config: ModelConfig): number {
  const weights = config.weights.overtime;
  const homeScore =
    (homeRatings.offenseRating / 100) * weights.offense +
    (homeRatings.finishingRating / 100) * weights.finishing +
    (homeRatings.goaltendingRating / 100) * weights.goaltending +
    (1 + config.homeIceAdvantage.overtimeWinPct) * weights.homeIce;

  const awayScore =
    (awayRatings.offenseRating / 100) * weights.offense +
    (awayRatings.finishingRating / 100) * weights.finishing +
    (awayRatings.goaltendingRating / 100) * weights.goaltending +
    1 * weights.homeIce;

  const relativeEdge = (homeScore - awayScore) * 0.42;
  return clampProbability(0.5 + relativeEdge);
}

export function simulateGameOutcomes(
  homeTeamName: string,
  awayTeamName: string,
  scoring: ScoringModelResult,
  homeRatings: TeamRatings,
  awayRatings: TeamRatings,
  config: ModelConfig = DEFAULT_MODEL_CONFIG,
  random: () => number = Math.random
): GamePrediction {
  let homeWins = 0;
  let awayWins = 0;
  let regulationHomeWins = 0;
  let regulationAwayWins = 0;
  let overtimeGames = 0;
  let overtimeHomeWins = 0;
  let overtimeAwayWins = 0;
  let shootoutHomeWins = 0;
  let shootoutAwayWins = 0;
  const scoreCounts = new Map<string, number>();

  const overtimeHomeWinPct = overtimeHomeWinProbability(homeRatings, awayRatings, config);
  const shootoutHomeWinPct = clampProbability(overtimeHomeWinPct + config.simulation.shootoutHomeEdge);

  for (let i = 0; i < config.simulationCount; i += 1) {
    // Regulation scoring is modeled with Poisson draws as a practical first
    // version. A future shot-by-shot simulator can plug in here.
    const homeGoals = poissonSample(scoring.homeRegulationLambda, random);
    const awayGoals = poissonSample(scoring.awayRegulationLambda, random);
    const scoreKey = `${homeGoals}-${awayGoals}`;
    scoreCounts.set(scoreKey, (scoreCounts.get(scoreKey) || 0) + 1);

    if (homeGoals > awayGoals) {
      homeWins += 1;
      regulationHomeWins += 1;
      continue;
    }

    if (awayGoals > homeGoals) {
      awayWins += 1;
      regulationAwayWins += 1;
      continue;
    }

    overtimeGames += 1;
    // Once tied after regulation, resolve overtime first, then a shootout-like
    // fallback for the remaining tied cases.
    const resolvedInOvertime = random() < config.simulation.overtimeResolutionRate;
    if (resolvedInOvertime) {
      if (random() < overtimeHomeWinPct) {
        homeWins += 1;
        overtimeHomeWins += 1;
      } else {
        awayWins += 1;
        overtimeAwayWins += 1;
      }
    } else if (random() < shootoutHomeWinPct) {
      homeWins += 1;
      shootoutHomeWins += 1;
    } else {
      awayWins += 1;
      shootoutAwayWins += 1;
    }
  }

  const homeWinPct = homeWins / config.simulationCount;
  const awayWinPct = awayWins / config.simulationCount;
  const regulationTiePct = overtimeGames / config.simulationCount;
  const expectedGoalEdge = scoring.expectedHomeGoals - scoring.expectedAwayGoals;

  const fairOdds = {
    homeMoneyline: impliedProbabilityToAmericanOdds(homeWinPct),
    awayMoneyline: impliedProbabilityToAmericanOdds(awayWinPct),
  };

  const diagnostics: ModelDiagnostics = {
    simulationCount: config.simulationCount,
    modelVersion: config.modelVersion,
    confidenceBand: buildConfidenceBand(homeWinPct, expectedGoalEdge),
    regulationHomeWinPct: regulationHomeWins / config.simulationCount,
    regulationAwayWinPct: regulationAwayWins / config.simulationCount,
    overtimeHomeWinPct: overtimeHomeWins / config.simulationCount,
    overtimeAwayWinPct: overtimeAwayWins / config.simulationCount,
    shootoutHomeWinPct: shootoutHomeWins / config.simulationCount,
    shootoutAwayWinPct: shootoutAwayWins / config.simulationCount,
    marketBlendApplied: false,
  };

  return {
    homeTeam: homeTeamName,
    awayTeam: awayTeamName,
    homeWinPct,
    awayWinPct,
    regulationTiePct,
    overtimePct: regulationTiePct,
    expectedHomeGoals: scoring.expectedHomeGoals,
    expectedAwayGoals: scoring.expectedAwayGoals,
    expectedHomeShots: scoring.expectedHomeShots,
    expectedAwayShots: scoring.expectedAwayShots,
    mostLikelyScores: topScoreOutcomes(scoreCounts, config.simulationCount, 3),
    fairOdds,
    modelDiagnostics: diagnostics,
  };
}
