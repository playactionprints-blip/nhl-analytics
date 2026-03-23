/**
 * Local-state and scoring helpers for the Fantasy Hub.
 * Depends on current-season player payloads from /api/fantasy/players and
 * schedule summaries from /api/fantasy/schedule to compute roster state,
 * fantasy-value rankings, and week-based utility views.
 */
import { DEFAULT_FANTASY_STATE, FANTASY_STORAGE_KEY } from "@/app/components/fantasy-hub/fantasyHubConfig";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

export function createDefaultFantasyState() {
  return deepClone(DEFAULT_FANTASY_STATE);
}

export function normalizeFantasyState(value) {
  const next = createDefaultFantasyState();
  if (!value || typeof value !== "object") return next;

  next.teamName =
    typeof value.teamName === "string" && value.teamName.trim()
      ? value.teamName.trim()
      : next.teamName;

  const sourceSettings = value.settings || {};
  next.settings.leagueType = sourceSettings.leagueType === "categories" ? "categories" : "points";

  for (const [groupKey, defaults] of Object.entries(next.settings)) {
    if (typeof defaults !== "object" || Array.isArray(defaults)) continue;
    const incoming = sourceSettings[groupKey] || {};
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (typeof defaultValue === "boolean") {
        defaults[key] = Boolean(incoming[key]);
      } else {
        defaults[key] = toNumber(incoming[key], defaultValue);
      }
    }
  }

  const roster = value.roster || {};
  for (const key of Object.keys(next.roster)) {
    const items = Array.isArray(roster[key]) ? roster[key] : [];
    next.roster[key] = items.map((item) => String(item));
  }

  return next;
}

export function loadFantasyState() {
  if (typeof window === "undefined") return createDefaultFantasyState();
  try {
    const raw = window.localStorage.getItem(FANTASY_STORAGE_KEY);
    return raw ? normalizeFantasyState(JSON.parse(raw)) : createDefaultFantasyState();
  } catch {
    return createDefaultFantasyState();
  }
}

export function saveFantasyState(state) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FANTASY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore localStorage write failures.
  }
}

export function getPlayerGroup(player) {
  const pos = String(player?.position || "").toUpperCase();
  if (pos === "D") return "defense";
  if (pos === "G") return "goalies";
  return "forwards";
}

export function isPlayerRostered(state, playerId) {
  const target = String(playerId);
  return Object.values(state?.roster || {}).some((group) => (group || []).includes(target));
}

export function getRosteredIds(state) {
  return new Set(
    Object.values(state?.roster || {})
      .flat()
      .filter(Boolean)
      .map((value) => String(value))
  );
}

export function addPlayerToRoster(state, player) {
  const next = deepClone(state);
  const playerId = String(player.player_id || player.id);
  if (!playerId || isPlayerRostered(next, playerId)) return next;

  const preferredGroup = getPlayerGroup(player);
  const preferredLimit = next.settings.rosterSlots[preferredGroup];
  if (next.roster[preferredGroup].length < preferredLimit) {
    next.roster[preferredGroup].push(playerId);
    return next;
  }

  if (next.roster.bench.length < next.settings.rosterSlots.bench) {
    next.roster.bench.push(playerId);
    return next;
  }

  if (next.roster.ir.length < next.settings.rosterSlots.ir) {
    next.roster.ir.push(playerId);
  }

  return next;
}

export function removePlayerFromRoster(state, playerId) {
  const target = String(playerId);
  const next = deepClone(state);
  for (const key of Object.keys(next.roster)) {
    next.roster[key] = next.roster[key].filter((value) => String(value) !== target);
  }
  return next;
}

export function buildRosterSections(state, playerMap) {
  return Object.fromEntries(
    Object.entries(state.roster).map(([key, ids]) => [
      key,
      ids
        .map((playerId) => playerMap[String(playerId)])
        .filter(Boolean),
    ])
  );
}

export function formatCapHit(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return `$${(Number(value) / 1_000_000).toFixed(1)}M`;
}

export function formatFantasyValue(value) {
  if (!Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(1);
}

export function startOfWeekIso(dateString = null) {
  const base = dateString ? new Date(`${dateString}T12:00:00Z`) : new Date();
  const day = base.getUTCDay();
  const distance = (day + 6) % 7;
  const monday = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - distance));
  return monday.toISOString().slice(0, 10);
}

export function addDaysIso(dateString, days) {
  const base = new Date(`${dateString}T12:00:00Z`);
  const shifted = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + days));
  return shifted.toISOString().slice(0, 10);
}

export function timeframeGamesForPlayer(player, timeframe, scheduleData) {
  if (timeframe === "ros") {
    if (!isFiniteNumber(player.gp) || Number(player.gp) <= 0) return null;
    return Math.max(82 - Number(player.gp), 0);
  }
  const map =
    timeframe === "today"
      ? scheduleData?.spanCounts?.today
      : timeframe === "this-week"
        ? scheduleData?.spanCounts?.thisWeek
        : timeframe === "14d"
          ? scheduleData?.spanCounts?.next14
          : scheduleData?.spanCounts?.next7;
  return toNumber(map?.[player.team], 0);
}

export function timeframeOffNightGamesForPlayer(player, timeframe, scheduleData) {
  if (timeframe === "ros") return 0;
  const map =
    timeframe === "today"
      ? scheduleData?.offNightCounts?.today
      : timeframe === "this-week"
        ? scheduleData?.offNightCounts?.thisWeek
        : timeframe === "14d"
          ? scheduleData?.offNightCounts?.next14
          : scheduleData?.offNightCounts?.next7;
  return toNumber(map?.[player.team], 0);
}

function hasStatSample(total, gp) {
  return total != null && Number.isFinite(Number(total)) && Number(gp) > 0;
}

function safeRate(total, gp) {
  const games = Math.max(toNumber(gp, 0), 1);
  return toNumber(total, 0) / games;
}

function statRate(total, gp) {
  if (!hasStatSample(total, gp)) return null;
  return safeRate(total, gp);
}

function categoryValuePerGame(player, settings, categoryContext) {
  if (String(player.position).toUpperCase() === "G") {
    const fields = [
      ["wins", false],
      ["saves", false],
      ["savePct", false],
      ["gaa", true],
    ].filter(([field]) => settings.categoryWeights[field]);
    if (!fields.length) return 0;
    const total = fields.reduce(
      (sum, [field, invert]) => sum + normalizeToRange(field === "savePct" || field === "gaa" ? player[field] : statRate(player[field], player.gp), categoryContext.goalies[field], invert),
      0
    );
    return total / fields.length;
  }

  const fields = ["goals", "assists", "shots", "hits", "blocks", "ppp"].filter(
    (field) => settings.categoryWeights[field]
  );
  if (!fields.length) return 0;
  const total = fields.reduce(
    (sum, field) => sum + normalizeToRange(statRate(player[field], player.gp), categoryContext.skaters[field]),
    0
  );
  return total / fields.length;
}

function buildCategoryContext(players) {
  const skaters = players.filter((player) => String(player.position).toUpperCase() !== "G");
  const goalies = players.filter((player) => String(player.position).toUpperCase() === "G");

  function ranges(pool, fields) {
    return Object.fromEntries(
      fields.map((field) => {
        const values = pool
          .map((item) => (field === "savePct" || field === "gaa" ? item[field] : statRate(item[field], item.gp)))
          .filter((value) => Number.isFinite(value));
        return [field, { min: Math.min(...values, 0), max: Math.max(...values, 1) }];
      })
    );
  }

  return {
    skaters: ranges(skaters, ["goals", "assists", "shots", "hits", "blocks", "ppp"]),
    goalies: ranges(goalies, ["wins", "saves", "savePct", "gaa"]),
  };
}

function normalizeToRange(value, range, invert = false) {
  const min = range?.min ?? 0;
  const max = range?.max ?? 1;
  if (max <= min) return 0.5;
  const normalized = (toNumber(value, 0) - min) / (max - min);
  return invert ? 1 - normalized : normalized;
}

function categoryScoreForPlayer(player, settings, gamesInSpan, categoryContext) {
  return categoryValuePerGame(player, settings, categoryContext) * Math.max(gamesInSpan, 1);
}

function projectedStat(total, gp, gamesInSpan, { nullable = true } = {}) {
  if (gamesInSpan == null || !Number.isFinite(Number(gamesInSpan))) return nullable ? null : 0;
  if (!hasStatSample(total, gp)) return nullable ? null : 0;
  return safeRate(total, gp) * gamesInSpan;
}

function weightedProjection(entries) {
  let hasAny = false;
  let total = 0;
  entries.forEach(([value, weight]) => {
    if (!weight) return;
    if (value == null || !Number.isFinite(Number(value))) return;
    hasAny = true;
    total += Number(value) * Number(weight);
  });
  return hasAny ? total : null;
}

function scoringUpsideForPlayer(player, gamesInSpan) {
  if (String(player.position).toUpperCase() === "G") {
    return (projectedStat(player.wins, player.gp, gamesInSpan, { nullable: false }) * 2.5) +
      (projectedStat(player.savePct, 1, gamesInSpan, { nullable: false }) * 5);
  }

  return (projectedStat(player.goals, player.gp, gamesInSpan, { nullable: false }) * 3) +
    (projectedStat(player.assists, player.gp, gamesInSpan, { nullable: false }) * 2) +
    (projectedStat(player.ppp, player.gp, gamesInSpan, { nullable: false }) * 1.5);
}

function peripheralsForPlayer(player, gamesInSpan) {
  if (String(player.position).toUpperCase() === "G") {
    return projectedStat(player.saves, player.gp, gamesInSpan, { nullable: false }) +
      (projectedStat(player.shutouts, player.gp, gamesInSpan, { nullable: false }) * 25);
  }

  return projectedStat(player.shots, player.gp, gamesInSpan, { nullable: false }) +
    projectedStat(player.hits, player.gp, gamesInSpan, { nullable: false }) +
    projectedStat(player.blocks, player.gp, gamesInSpan, { nullable: false });
}

export function buildFantasyProjection(player, state, timeframe, scheduleData, categoryContext = null) {
  const gamesInSpan = timeframeGamesForPlayer(player, timeframe, scheduleData);
  const offNightGames = timeframeOffNightGamesForPlayer(player, timeframe, scheduleData);
  const categoryRanges = categoryContext || buildCategoryContext([player]);
  const isGoalie = String(player.position).toUpperCase() === "G";
  const projectionWarnings = [];

  if (gamesInSpan == null) {
    projectionWarnings.push("missing-games-window");
  } else if (
    (timeframe === "today" && gamesInSpan > 1) ||
    ((timeframe === "this-week" || timeframe === "7d") && gamesInSpan > 7) ||
    (timeframe === "14d" && gamesInSpan > 14) ||
    (timeframe === "ros" && gamesInSpan > 82)
  ) {
    projectionWarnings.push("unreasonable-games-window");
  }

  if (!isFiniteNumber(player.gp) || Number(player.gp) <= 0) {
    projectionWarnings.push("missing-gp");
  }

  const projectedGoals = isGoalie ? null : projectedStat(player.goals, player.gp, gamesInSpan);
  const projectedAssists = isGoalie ? null : projectedStat(player.assists, player.gp, gamesInSpan);
  const projectedShots = isGoalie ? null : projectedStat(player.shots, player.gp, gamesInSpan);
  const projectedHits = isGoalie ? null : projectedStat(player.hits, player.gp, gamesInSpan);
  const projectedBlocks = isGoalie ? null : projectedStat(player.blocks, player.gp, gamesInSpan);
  const projectedPPP = isGoalie ? null : projectedStat(player.ppp, player.gp, gamesInSpan);
  const projectedPoints = isGoalie ? null : projectedStat(player.points, player.gp, gamesInSpan);
  const projectedSaves = isGoalie ? projectedStat(player.saves, player.gp, gamesInSpan) : null;
  const projectedWins = isGoalie ? projectedStat(player.wins, player.gp, gamesInSpan) : null;
  const projectedGoalsAgainst = isGoalie ? projectedStat(player.goalsAgainst, player.gp, gamesInSpan) : null;
  const projectedShutouts = isGoalie ? projectedStat(player.shutouts, player.gp, gamesInSpan) : null;

  let projectedFantasyPoints =
    state.settings.leagueType === "categories"
      ? categoryScoreForPlayer(player, state.settings, gamesInSpan, categoryRanges)
      : weightedProjection(
          isGoalie
            ? [
                [projectedWins, state.settings.goalieWeights.wins],
                [projectedSaves, state.settings.goalieWeights.saves],
                [projectedGoalsAgainst, state.settings.goalieWeights.goalsAgainst],
                [projectedShutouts, state.settings.goalieWeights.shutouts],
              ]
            : [
                [projectedGoals, state.settings.skaterWeights.goals],
                [projectedAssists, state.settings.skaterWeights.assists],
                [projectedShots, state.settings.skaterWeights.shots],
                [projectedHits, state.settings.skaterWeights.hits],
                [projectedBlocks, state.settings.skaterWeights.blocks],
                [projectedPPP, state.settings.skaterWeights.ppp],
              ]
        );

  const allProjectedFields = isGoalie
    ? [projectedSaves, projectedWins, projectedGoalsAgainst, projectedShutouts]
    : [projectedGoals, projectedAssists, projectedShots, projectedHits, projectedBlocks, projectedPPP];

  if (projectedFantasyPoints != null && allProjectedFields.every((value) => value == null)) {
    projectionWarnings.push("fantasy-points-without-components");
  }

  const projectionValid =
    gamesInSpan != null &&
    !projectionWarnings.includes("missing-gp") &&
    !projectionWarnings.includes("fantasy-points-without-components") &&
    projectedFantasyPoints != null;

  if (!projectionValid) {
    projectedFantasyPoints = null;
  }

  return {
    ...player,
    projectionTimeframe: timeframe,
    projectedFantasyPoints,
    projectedGames: gamesInSpan,
    projectedOffNightGames: offNightGames,
    projectedGoals,
    projectedAssists,
    projectedShots,
    projectedHits,
    projectedBlocks,
    projectedPowerPlayPoints: projectedPPP,
    projectedPoints,
    projectedSaves,
    projectedWins,
    projectedGoalsAgainst,
    projectedShutouts,
    projectionValid,
    projectionWarnings,
    usedFallbackLogic: projectionWarnings.length > 0,
    gamesInSpan,
    offNightGames,
    fantasyValue: projectedFantasyPoints,
    pointsProjection: projectedPoints,
    goalsProjection: projectedGoals,
    assistsProjection: projectedAssists,
    shotsProjection: projectedShots,
    hitsProjection: projectedHits,
    blocksProjection: projectedBlocks,
    pppProjection: projectedPPP,
    savesProjection: projectedSaves,
    winsProjection: projectedWins,
    scheduleScore: (gamesInSpan ?? 0) + (offNightGames ?? 0) * 0.45,
    peripheralsValue: peripheralsForPlayer(player, gamesInSpan),
    scoringUpside: scoringUpsideForPlayer(player, gamesInSpan),
  };
}

export function buildRankedPlayers(players, state, timeframe, filters, scheduleData) {
  const rosteredIds = getRosteredIds(state);
  const categoryContext = buildCategoryContext(players);

  const projected = players.map((player) => ({
    ...buildFantasyProjection(player, state, timeframe, scheduleData, categoryContext),
    isRostered: rosteredIds.has(String(player.player_id)),
  }));

  return projected.filter((player) => {
    if (!player.projectionValid) return false;
    if (filters.position !== "ALL") {
      const group = getPlayerGroup(player);
      if (filters.position === "F" && group !== "forwards") return false;
      if (filters.position === "D" && group !== "defense") return false;
      if (filters.position === "G" && group !== "goalies") return false;
    }
    if (filters.team !== "ALL" && player.team !== filters.team) return false;
    if (filters.rosterState === "rostered" && !player.isRostered) return false;
    if (filters.rosterState === "available" && player.isRostered) return false;
    return true;
  });
}

export function buildRosterContextSummary(state, playerMap, timeframe, scheduleData) {
  const sections = buildRosterSections(state, playerMap);
  const allPlayers = Object.values(sections).flat();
  const totalFantasyValue = allPlayers.reduce(
    (sum, player) => {
      const projection = buildRankedPlayers(
        [player],
        state,
        timeframe,
        { position: "ALL", team: "ALL", rosterState: "all" },
        scheduleData
      )[0];
      return sum + (projection?.fantasyValue || 0);
    },
    0
  );

  return {
    filledSpots: allPlayers.length,
    totalSpots:
      state.settings.rosterSlots.forwards +
      state.settings.rosterSlots.defense +
      state.settings.rosterSlots.goalies +
      state.settings.rosterSlots.bench +
      state.settings.rosterSlots.ir,
    rosteredTeamCount: new Set(allPlayers.map((player) => player.team).filter(Boolean)).size,
    projectedValue: totalFantasyValue,
  };
}
