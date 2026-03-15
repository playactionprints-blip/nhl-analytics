export function clampProbability(probability: number, epsilon = 1e-6): number {
  return Math.min(1 - epsilon, Math.max(epsilon, probability));
}

export function validateProbability(probability: number, label = "probability"): void {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error(`Invalid ${label}: ${probability}`);
  }
}

export function impliedProbabilityToAmericanOdds(probability: number): number {
  const p = clampProbability(probability);
  if (p >= 0.5) {
    return Math.round((-100 * p) / (1 - p));
  }
  return Math.round((100 * (1 - p)) / p);
}

export function americanOddsToImpliedProbability(odds: number): number {
  if (odds === 0) {
    throw new Error("American odds cannot be zero.");
  }
  if (odds > 0) {
    return 100 / (odds + 100);
  }
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

export function removeOverroundFromMoneylines(homeOdds: number, awayOdds: number): {
  homeProbability: number;
  awayProbability: number;
} {
  const homeRaw = americanOddsToImpliedProbability(homeOdds);
  const awayRaw = americanOddsToImpliedProbability(awayOdds);
  const total = homeRaw + awayRaw;

  return {
    homeProbability: homeRaw / total,
    awayProbability: awayRaw / total,
  };
}
