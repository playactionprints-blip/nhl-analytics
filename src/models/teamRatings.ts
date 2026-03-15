import { DEFAULT_MODEL_CONFIG } from "../data/leagueConstants";
import { buildEngineeredTeamFeatures } from "../features/featureEngineering";
import type { GameContext, ModelConfig, TeamRatings, TeamSeasonStats } from "../types/types";

function toIndex(multiplier: number): number {
  return Math.round(multiplier * 1000) / 10;
}

export function buildTeamRatings(
  team: TeamSeasonStats,
  side: "home" | "away",
  context: GameContext,
  config: ModelConfig = DEFAULT_MODEL_CONFIG
): TeamRatings {
  const features = buildEngineeredTeamFeatures(team, side, context, config);
  const contextMultiplier =
    features.scheduleFatigueAdjustment *
    features.homeIceAdjustment *
    features.injuryAdjustment *
    features.lineupStrengthAdjustment;

  return {
    teamId: team.teamId,
    teamName: team.teamName,
    side,
    offenseRating: toIndex(features.offenseStrengthScore),
    defenseRating: toIndex(features.defenseStrengthScore),
    shotRateRating: toIndex(features.shotGenerationScore),
    shotSuppressionRating: toIndex(features.shotSuppressionScore),
    finishingRating: toIndex(features.finishingScore),
    goaltendingRating: toIndex(features.goaltendingScore),
    specialTeamsRating: toIndex(features.specialTeamsAdjustment),
    formRating: toIndex(features.recentFormAdjustment),
    contextMultiplier,
    scheduleAdjustment: features.scheduleFatigueAdjustment,
    homeIceAdjustment: features.homeIceAdjustment,
    features,
  };
}
