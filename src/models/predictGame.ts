import { DEFAULT_MARKET_CALIBRATION_WEIGHT, DEFAULT_MODEL_CONFIG } from "../data/leagueConstants";
import { estimateExpectedScoring } from "./expectedGoalsModel";
import { buildTeamRatings } from "./teamRatings";
import { simulateGameOutcomes } from "../sim/monteCarloSimulator";
import type { GameContext, GamePrediction, MarketInputs, ModelConfig } from "../types/types";
import { clampProbability, impliedProbabilityToAmericanOdds, removeOverroundFromMoneylines } from "../utils/odds";

function blendMarketProbability(
  modelProbability: number,
  marketInputs: MarketInputs | undefined
): { probability: number; marketBlendApplied: boolean } {
  if (
    !marketInputs ||
    typeof marketInputs.homeMoneyline !== "number" ||
    typeof marketInputs.awayMoneyline !== "number"
  ) {
    return { probability: modelProbability, marketBlendApplied: false };
  }

  const devigged = removeOverroundFromMoneylines(marketInputs.homeMoneyline, marketInputs.awayMoneyline);
  const blendWeight = marketInputs.marketCalibrationWeight ?? DEFAULT_MARKET_CALIBRATION_WEIGHT;
  const probability = modelProbability * (1 - blendWeight) + devigged.homeProbability * blendWeight;

  return {
    probability: clampProbability(probability),
    marketBlendApplied: blendWeight > 0,
  };
}

export function predictGame(
  context: GameContext,
  marketInputs?: MarketInputs,
  config: ModelConfig = DEFAULT_MODEL_CONFIG
): GamePrediction {
  // Deterministic ratings/xG first, then Monte Carlo on top so model tuning and
  // debugging stay manageable.
  const homeRatings = buildTeamRatings(context.homeTeam, "home", context, config);
  const awayRatings = buildTeamRatings(context.awayTeam, "away", context, config);
  const scoring = estimateExpectedScoring(homeRatings, awayRatings, context, config);
  const basePrediction = simulateGameOutcomes(
    context.homeTeam.teamName,
    context.awayTeam.teamName,
    scoring,
    homeRatings,
    awayRatings,
    config
  );

  const { probability: blendedHomeWinPct, marketBlendApplied } = blendMarketProbability(
    basePrediction.homeWinPct,
    marketInputs
  );

  if (!marketBlendApplied) {
    return basePrediction;
  }

  const blendedAwayWinPct = clampProbability(1 - blendedHomeWinPct);

  return {
    ...basePrediction,
    homeWinPct: blendedHomeWinPct,
    awayWinPct: blendedAwayWinPct,
    fairOdds: {
      homeMoneyline: impliedProbabilityToAmericanOdds(blendedHomeWinPct),
      awayMoneyline: impliedProbabilityToAmericanOdds(blendedAwayWinPct),
    },
    modelDiagnostics: {
      ...basePrediction.modelDiagnostics,
      marketBlendApplied: true,
    },
  };
}
