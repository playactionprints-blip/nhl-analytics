import { B2B_BOTH_TEAMS, B2B_PENALTY, DEFAULT_MARKET_CALIBRATION_WEIGHT, DEFAULT_MODEL_CONFIG } from "../data/leagueConstants";
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

function goalieConfidenceFromContext(context: GameContext): GamePrediction["goalieConfidence"] {
  const homeConfidence = context.homeStartingGoalie?.confidence || "unknown";
  const awayConfidence = context.awayStartingGoalie?.confidence || "unknown";
  if (homeConfidence === "confirmed" && awayConfidence === "confirmed") {
    return "confirmed";
  }
  if (homeConfidence === "projected" || awayConfidence === "projected" || homeConfidence === "confirmed" || awayConfidence === "confirmed") {
    return "projected";
  }
  return "unknown";
}

function resolveBackToBackAdjustment(context: GameContext): GamePrediction["b2b"] {
  const home = Boolean(context.homeBackToBack);
  const away = Boolean(context.awayBackToBack);

  if (home && away) {
    return {
      away,
      home,
      penaltyApplied: "both",
      adjustment: B2B_BOTH_TEAMS,
    };
  }

  if (away) {
    return {
      away,
      home,
      penaltyApplied: "road",
      adjustment: B2B_PENALTY.road,
    };
  }

  if (home) {
    return {
      away,
      home,
      penaltyApplied: "home",
      adjustment: B2B_PENALTY.home,
    };
  }

  return {
    away,
    home,
    penaltyApplied: "none",
    adjustment: 0,
  };
}

function applyBackToBackPenalty(
  prediction: GamePrediction,
  context: GameContext
): GamePrediction {
  const b2b = resolveBackToBackAdjustment(context);
  let awayWinPct = prediction.awayWinPct + b2b.adjustment;
  awayWinPct = clampProbability(awayWinPct);
  const homeWinPct = clampProbability(1 - awayWinPct);

  return {
    ...prediction,
    b2b,
    homeWinPct,
    awayWinPct,
    fairOdds: {
      homeMoneyline: impliedProbabilityToAmericanOdds(homeWinPct),
      awayMoneyline: impliedProbabilityToAmericanOdds(awayWinPct),
    },
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
  const penaltyAdjustedPrediction = applyBackToBackPenalty(basePrediction, context);

  const { probability: blendedHomeWinPct, marketBlendApplied } = blendMarketProbability(
    penaltyAdjustedPrediction.homeWinPct,
    marketInputs
  );

  if (!marketBlendApplied) {
    return {
      ...penaltyAdjustedPrediction,
      goalieConfidence: goalieConfidenceFromContext(context),
    };
  }

  const blendedAwayWinPct = clampProbability(1 - blendedHomeWinPct);

  return {
    ...penaltyAdjustedPrediction,
    homeWinPct: blendedHomeWinPct,
    awayWinPct: blendedAwayWinPct,
    goalieConfidence: goalieConfidenceFromContext(context),
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
