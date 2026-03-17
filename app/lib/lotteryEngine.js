import { NHL_LOTTERY_RULES } from "@/app/lib/lotteryConfig";

export function sortStandingsForLotteryOrder(standingsRows) {
  return [...standingsRows].sort((a, b) => {
    if (a.points !== b.points) return a.points - b.points;
    if (a.pointPct !== b.pointPct) return a.pointPct - b.pointPct;
    if (a.regulationWins !== b.regulationWins) return a.regulationWins - b.regulationWins;
    return a.goalDiff - b.goalDiff;
  });
}

export function createSeededRandom(seedInput) {
  let seed = Number(seedInput);
  if (!Number.isFinite(seed)) {
    seed = Date.now();
  }
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildLotteryEntriesFromStandings(standingsRows, config = NHL_LOTTERY_RULES) {
  const sorted = sortStandingsForLotteryOrder(standingsRows).slice(0, config.lotteryTeamCount);

  return sorted.map((team, index) => ({
    pickId: `pick-${team.abbr}-${index + 1}`,
    originalTeam: team.abbr,
    currentOwner: team.abbr,
    conditionalOwner: null,
    protectionRule: null,
    protectionStatus: null,
    notes: null,
    lotteryEligible: true,
    baseRank: index + 1,
    projectedPick: index + 1,
    odds: config.oddsByRank[index] ?? 0,
    standings: team,
  }));
}

export function resolvePickOwnership(entries) {
  // TODO: Plug traded-pick and protection resolution in here before simulation.
  // The engine already carries originalTeam/currentOwner/protection fields so
  // ownership overrides can be applied without rewriting the UI or draw logic.
  return entries.map((entry) => ({ ...entry }));
}

function weightedChoice(entries, getWeight, random) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, getWeight(entry)), 0);
  if (!total) return entries[0] || null;
  let roll = random() * total;
  for (const entry of entries) {
    roll -= Math.max(0, getWeight(entry));
    if (roll <= 0) {
      return entry;
    }
  }
  return entries[entries.length - 1] || null;
}

function canWinPick(entry, targetPick, config) {
  return entry.baseRank - targetPick <= config.maxJump;
}

export function simulateLottery(entries, options = {}) {
  const config = options.config || NHL_LOTTERY_RULES;
  const resolved = resolvePickOwnership(entries);
  const seed = options.seed ?? Date.now();
  const random = options.random || createSeededRandom(seed);

  const available = resolved.map((entry) => ({ ...entry }));
  const winners = [];

  for (let drawIndex = 0; drawIndex < config.drawCount; drawIndex += 1) {
    const pickNumber = drawIndex + 1;
    const eligible = available.filter((entry) => canWinPick(entry, pickNumber, config));
    const winner = weightedChoice(eligible, (entry) => entry.odds, random);
    if (!winner) break;
    winners.push({
      ...winner,
      wonPick: pickNumber,
      moved: winner.baseRank - pickNumber,
    });
    const removeIndex = available.findIndex((entry) => entry.pickId === winner.pickId);
    if (removeIndex >= 0) {
      available.splice(removeIndex, 1);
    }
  }

  const finalOrder = [];
  for (let pick = 1; pick <= config.lotteryTeamCount; pick += 1) {
    const winningEntry = winners.find((winner) => winner.wonPick === pick);
    if (winningEntry) {
      finalOrder.push({
        ...winningEntry,
        finalPick: pick,
        movement: winningEntry.baseRank - pick,
      });
      continue;
    }

    const nextEntry = available.shift();
    if (!nextEntry) break;
    finalOrder.push({
      ...nextEntry,
      finalPick: pick,
      movement: nextEntry.baseRank - pick,
    });
  }

  return {
    seed,
    winners,
    finalOrder,
    revealedAt: new Date().toISOString(),
  };
}

export function simulateManyLotteries(entries, count, options = {}) {
  const config = options.config || NHL_LOTTERY_RULES;
  const seedBase = options.seed ?? Date.now();
  const distribution = {};
  const teamIndex = {};

  for (const entry of entries) {
    distribution[entry.pickId] = Array.from({ length: config.lotteryTeamCount }, () => 0);
    teamIndex[entry.pickId] = entry;
  }

  for (let i = 0; i < count; i += 1) {
    const result = simulateLottery(entries, { config, seed: seedBase + i });
    for (const row of result.finalOrder) {
      distribution[row.pickId][row.finalPick - 1] += 1;
    }
  }

  return Object.values(teamIndex)
    .map((entry) => {
      const finishes = distribution[entry.pickId];
      const topPickRate = (finishes[0] / count) * 100;
      const topThreeRate = (finishes.slice(0, 3).reduce((sum, value) => sum + value, 0) / count) * 100;
      const averagePick = finishes.reduce((sum, value, index) => sum + value * (index + 1), 0) / count;
      return {
        ...entry,
        finishes,
        topPickRate,
        topThreeRate,
        averagePick,
      };
    })
    .sort((a, b) => a.averagePick - b.averagePick);
}
