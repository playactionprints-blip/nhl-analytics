import { unstable_cache } from "next/cache";
import { createServerClient } from "@/app/lib/supabase";
import { jsonWithCache } from "@/app/lib/apiCache";
import { TEAM_COLOR, TEAM_FULL } from "@/app/lib/nhlTeams";
import {
  buildGameContextFromTeams,
  buildPlayerAggregates,
  buildTeamSeasonStatsFromLiveData,
  buildTeamSplitAggregates,
  normalizeScheduleGame,
  normalizeStandingsSnapshot,
} from "@/src/data/livePredictionData";
import { predictGame } from "@/src/models/predictGame";
import {
  PLAYOFF_CACHE_SECONDS,
  PLAYOFF_CONDITIONAL_SIM_COUNT,
  PLAYOFF_CURRENT_SEASON_ID,
  PLAYOFF_CURRENT_SEASON_KEY,
  PLAYOFF_DEFAULT_GAME_DATE_WINDOW,
  PLAYOFF_OVERVIEW_SIM_COUNT,
  PLAYOFF_REGULAR_SEASON_END_DATE,
} from "@/app/lib/playoffs/playoffConfig";
import {
  calculateDailyMovers,
  calculateGameImpacts,
  simulatePlayoffRace,
} from "@/app/lib/playoffs/playoffEngine";
import {
  dateStringFromUtcInToronto,
  daysBetween,
  getTorontoDateString,
  shiftDateString,
  safeNumber,
} from "@/app/lib/playoffs/playoffUtils";

function isFinalState(state) {
  return ["FINAL", "OFF"].includes(String(state || "").toUpperCase());
}

function buildTeamStrengthIndex(teamStats, aggregate, standingsRow) {
  const pointPct = safeNumber(standingsRow?.pointPct, 0.5);
  const war = safeNumber(aggregate?.totalWAR, 0);
  const rating = safeNumber(aggregate?.avgOverallRating, 75);
  const xgf = safeNumber(teamStats?.fiveOnFiveXgfPct, 50);
  const goalie = safeNumber(aggregate?.topGoalieGsaxPct, 50);
  return pointPct * 100 + war * 0.9 + rating * 0.4 + (xgf - 50) * 2.2 + (goalie - 50) * 0.2;
}

function cloneTeams(teams) {
  return Object.fromEntries(
    Object.entries(teams).map(([abbr, team]) => [abbr, { ...team }])
  );
}

function reverseBranch(teamStates, awayAbbr, homeAbbr, branchKey) {
  const away = teamStates[awayAbbr];
  const home = teamStates[homeAbbr];
  if (!away || !home) return;

  away.gamesPlayed = Math.max(0, away.gamesPlayed - 1);
  home.gamesPlayed = Math.max(0, home.gamesPlayed - 1);

  switch (branchKey) {
    case "away_reg":
      away.points = Math.max(0, away.points - 2);
      away.wins = Math.max(0, away.wins - 1);
      away.regulationWins = Math.max(0, away.regulationWins - 1);
      home.losses = Math.max(0, home.losses - 1);
      break;
    case "away_ot":
      away.points = Math.max(0, away.points - 2);
      away.wins = Math.max(0, away.wins - 1);
      home.points = Math.max(0, home.points - 1);
      home.otLosses = Math.max(0, home.otLosses - 1);
      break;
    case "home_ot":
      home.points = Math.max(0, home.points - 2);
      home.wins = Math.max(0, home.wins - 1);
      away.points = Math.max(0, away.points - 1);
      away.otLosses = Math.max(0, away.otLosses - 1);
      break;
    case "home_reg":
    default:
      home.points = Math.max(0, home.points - 2);
      home.wins = Math.max(0, home.wins - 1);
      home.regulationWins = Math.max(0, home.regulationWins - 1);
      away.losses = Math.max(0, away.losses - 1);
      break;
  }

  away.pointPct = away.gamesPlayed > 0 ? away.points / (away.gamesPlayed * 2) : 0.5;
  home.pointPct = home.gamesPlayed > 0 ? home.points / (home.gamesPlayed * 2) : 0.5;
}

async function fetchStandingsRows() {
  const res = await fetch("https://api-web.nhle.com/v1/standings/now", {
    next: { revalidate: PLAYOFF_CACHE_SECONDS },
  });
  if (!res.ok) throw new Error("Could not load standings");
  const payload = await res.json();

  const standingsByTeam = {};
  const teamMeta = {};
  for (const raw of payload.standings || []) {
    const normalized = normalizeStandingsSnapshot(raw, TEAM_FULL);
    if (!normalized) continue;
    standingsByTeam[normalized.abbr] = normalized;
    teamMeta[normalized.abbr] = {
      abbr: normalized.abbr,
      name: normalized.name,
      conference: raw.conferenceName || "",
      division: raw.divisionName || "",
      points: normalized.points,
      gamesPlayed: normalized.gamesPlayed,
      wins: normalized.wins,
      losses: normalized.losses,
      otLosses: normalized.otLosses,
      pointPct: normalized.pointPct,
      goalDiff: normalized.goalDiff,
      regulationWins: safeNumber(raw.regulationWins, 0),
      record: normalized,
      color: TEAM_COLOR[normalized.abbr] || "#6d89a3",
      clinchIndicator: raw.clinchIndicator || null,
    };
  }

  return { standingsByTeam, teamMeta };
}

async function fetchSpecialTeamsMap() {
  const seasonExpr = `seasonId=${PLAYOFF_CURRENT_SEASON_ID}`;
  const [ppRes, pkRes] = await Promise.all([
    fetch(`https://api.nhle.com/stats/rest/en/team/powerplay?cayenneExp=${seasonExpr}`, {
      next: { revalidate: PLAYOFF_CACHE_SECONDS },
    }),
    fetch(`https://api.nhle.com/stats/rest/en/team/penaltykill?cayenneExp=${seasonExpr}`, {
      next: { revalidate: PLAYOFF_CACHE_SECONDS },
    }),
  ]);

  const map = {};
  if (ppRes.ok) {
    const data = await ppRes.json();
    for (const row of data.data || []) {
      const abbr = Object.entries(TEAM_FULL).find(([, name]) => name === row.teamFullName)?.[0];
      if (!abbr) continue;
      map[abbr] = { ...(map[abbr] || {}), ppPct: row.powerPlayPct ?? null };
    }
  }
  if (pkRes.ok) {
    const data = await pkRes.json();
    for (const row of data.data || []) {
      const abbr = Object.entries(TEAM_FULL).find(([, name]) => name === row.teamFullName)?.[0];
      if (!abbr) continue;
      map[abbr] = { ...(map[abbr] || {}), pkPct: row.penaltyKillPct ?? null };
    }
  }

  return map;
}

async function fetchPlayerModelInputs() {
  const supabase = createServerClient();
  const [{ data: players }, { data: playerSeasonSplits }] = await Promise.all([
    supabase
      .from("players")
      .select("team,position,off_rating,def_rating,overall_rating,xgf_pct,cf_pct,war_shooting,war_total,gp,save_pct,gsax,gsax_pct,full_name"),
    supabase
      .from("player_seasons")
      .select("team,gp,cf_pct,home_cf_pct,away_cf_pct")
      .eq("season", PLAYOFF_CURRENT_SEASON_KEY),
  ]);

  return {
    players: players || [],
    playerSeasonSplits: playerSeasonSplits || [],
  };
}

async function fetchScheduleForDate(dateString) {
  const res = await fetch(`https://api-web.nhle.com/v1/schedule/${dateString}`, {
    next: { revalidate: PLAYOFF_CACHE_SECONDS },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const gameWeekGames = (data.gameWeek || []).flatMap((day) => day.games || []);
  return data.games || gameWeekGames || [];
}

async function fetchScheduleRange(startDate, endDate) {
  const dates = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = shiftDateString(cursor, 1);
  }

  const results = await Promise.all(dates.map(async (date) => ({
    date,
    games: await fetchScheduleForDate(date),
  })));

  const deduped = new Map();

  for (const entry of results) {
    for (const game of entry.games || []) {
      const normalized = normalizeScheduleGame(game, TEAM_FULL);
      if (!normalized?.id) continue;
      const actualDate = dateStringFromUtcInToronto(normalized.startTimeUTC) || entry.date;
      if (actualDate < startDate || actualDate > endDate) continue;
      const existing = deduped.get(normalized.id);
      if (existing) continue;
      deduped.set(normalized.id, {
        raw: game,
        date: actualDate,
      });
    }
  }

  return [...deduped.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const aId = String(a.raw?.id ?? a.raw?.gameId ?? "");
    const bId = String(b.raw?.id ?? b.raw?.gameId ?? "");
    return aId.localeCompare(bId);
  });
}

function dedupeAndSortTeamDates(scheduleRows) {
  const teamDates = {};
  for (const row of scheduleRows) {
    const normalized = normalizeScheduleGame(row.raw, TEAM_FULL);
    if (!normalized) continue;
    const date = row.date || dateStringFromUtcInToronto(normalized.startTimeUTC);
    for (const abbr of [normalized.homeTeam.abbr, normalized.awayTeam.abbr]) {
      if (!teamDates[abbr]) teamDates[abbr] = new Set();
      teamDates[abbr].add(date);
    }
  }
  return Object.fromEntries(
    Object.entries(teamDates).map(([abbr, dateSet]) => [abbr, [...dateSet].sort((a, b) => a.localeCompare(b))])
  );
}

function buildContextForGame(game, teamStatsByTeam, aggregatesByTeam, teamDatesByAbbr) {
  const homeTeam = teamStatsByTeam[game.homeTeam.abbr];
  const awayTeam = teamStatsByTeam[game.awayTeam.abbr];
  if (!homeTeam || !awayTeam) return null;

  const context = buildGameContextFromTeams(homeTeam, awayTeam, aggregatesByTeam);
  const homeDates = teamDatesByAbbr[game.homeTeam.abbr] || [];
  const awayDates = teamDatesByAbbr[game.awayTeam.abbr] || [];
  const homeIndex = homeDates.indexOf(game.date);
  const awayIndex = awayDates.indexOf(game.date);
  const homePrev = homeIndex > 0 ? homeDates[homeIndex - 1] : null;
  const awayPrev = awayIndex > 0 ? awayDates[awayIndex - 1] : null;
  const homeRestGap = homePrev ? Math.max(0, daysBetween(homePrev, game.date) - 1) : 1;
  const awayRestGap = awayPrev ? Math.max(0, daysBetween(awayPrev, game.date) - 1) : 1;

  return {
    ...context,
    homeRestDays: homeRestGap,
    awayRestDays: awayRestGap,
    homeBackToBack: homePrev ? daysBetween(homePrev, game.date) === 1 : false,
    awayBackToBack: awayPrev ? daysBetween(awayPrev, game.date) === 1 : false,
  };
}

function buildGameProbabilities(scheduleRows, teamStatsByTeam, aggregatesByTeam, teamMeta) {
  const teamDatesByAbbr = dedupeAndSortTeamDates(scheduleRows);

  return scheduleRows
    .map((row) => {
      const normalized = normalizeScheduleGame(row.raw, TEAM_FULL);
      if (!normalized) return null;

      const date = row.date || dateStringFromUtcInToronto(normalized.startTimeUTC);
      const context = buildContextForGame(
        { ...normalized, date },
        teamStatsByTeam,
        aggregatesByTeam,
        teamDatesByAbbr
      );
      if (!context) return null;

      const prediction = predictGame(context);
      const homeOtProb = safeNumber(prediction.modelDiagnostics.overtimeHomeWinPct, 0) + safeNumber(prediction.modelDiagnostics.shootoutHomeWinPct, 0);
      const awayOtProb = safeNumber(prediction.modelDiagnostics.overtimeAwayWinPct, 0) + safeNumber(prediction.modelDiagnostics.shootoutAwayWinPct, 0);

      return {
        id: normalized.id,
        date,
        state: normalized.gameState,
        startTimeUTC: normalized.startTimeUTC,
        homeTeam: {
          abbr: normalized.homeTeam.abbr,
          name: normalized.homeTeam.name,
          record: teamMeta[normalized.homeTeam.abbr]?.record || null,
        },
        awayTeam: {
          abbr: normalized.awayTeam.abbr,
          name: normalized.awayTeam.name,
          record: teamMeta[normalized.awayTeam.abbr]?.record || null,
        },
        homeWinProbability: prediction.homeWinPct,
        awayWinProbability: prediction.awayWinPct,
        regulationTieProbability: prediction.regulationTiePct,
        regulationHomeWinProb: prediction.modelDiagnostics.regulationHomeWinPct,
        regulationAwayWinProb: prediction.modelDiagnostics.regulationAwayWinPct,
        overtimeHomeWinProb: homeOtProb,
        overtimeAwayWinProb: awayOtProb,
        expectedHomeGoals: prediction.expectedHomeGoals,
        expectedAwayGoals: prediction.expectedAwayGoals,
      };
    })
    .filter(Boolean);
}

function buildPreviousSnapshot(teams, allGamesToday) {
  const priorTeams = cloneTeams(teams);

  for (const row of allGamesToday) {
    const normalized = normalizeScheduleGame(row.raw, TEAM_FULL);
    if (!normalized) continue;
    if (!isFinalState(normalized.gameState)) continue;

    const homeScore = safeNumber(row.raw?.homeTeam?.score, null);
    const awayScore = safeNumber(row.raw?.awayTeam?.score, null);
    if (homeScore == null || awayScore == null) continue;

    const lastPeriodType = String(row.raw?.gameOutcome?.lastPeriodType || row.raw?.periodDescriptor?.periodType || "REG").toUpperCase();
    let branch = "home_reg";
    if (awayScore > homeScore) {
      branch = lastPeriodType === "REG" ? "away_reg" : "away_ot";
    } else if (homeScore > awayScore) {
      branch = lastPeriodType === "REG" ? "home_reg" : "home_ot";
    }

    reverseBranch(priorTeams, normalized.awayTeam.abbr, normalized.homeTeam.abbr, branch);
  }

  return priorTeams;
}

async function loadBasePlayoffData(asOfDate) {
  const [{ standingsByTeam, teamMeta }, specialTeamsByTeam, { players, playerSeasonSplits }] = await Promise.all([
    fetchStandingsRows(),
    fetchSpecialTeamsMap(),
    fetchPlayerModelInputs(),
  ]);

  const aggregatesByTeam = buildPlayerAggregates(players, TEAM_FULL);
  const splitAggregatesByTeam = buildTeamSplitAggregates(playerSeasonSplits);
  const teamStatsByTeam = {};

  for (const abbr of Object.keys(teamMeta)) {
    const stats = buildTeamSeasonStatsFromLiveData(
      abbr,
      standingsByTeam,
      specialTeamsByTeam,
      aggregatesByTeam,
      splitAggregatesByTeam
    );
    if (!stats) continue;
    teamStatsByTeam[abbr] = stats;
    teamMeta[abbr].strengthIndex = buildTeamStrengthIndex(stats, aggregatesByTeam[abbr], standingsByTeam[abbr]);
  }

  const scheduleRows = await fetchScheduleRange(asOfDate, PLAYOFF_REGULAR_SEASON_END_DATE);
  const allGamesToday = scheduleRows.filter((row) => row.date === asOfDate);
  const gameProbabilities = buildGameProbabilities(scheduleRows, teamStatsByTeam, aggregatesByTeam, teamMeta);

  const remainingGames = gameProbabilities.filter((game) => !isFinalState(game.state));
  const currentDayRemainingGames = remainingGames.filter((game) => game.date === asOfDate);
  const previousSnapshotTeams = buildPreviousSnapshot(teamMeta, allGamesToday);
  const previousRemainingGames = gameProbabilities.filter((game) => game.date > asOfDate || game.date === asOfDate);
  const availableDates = [...new Set(remainingGames.map((game) => game.date))].sort((a, b) => a.localeCompare(b));

  return {
    asOfDate,
    teamMeta,
    previousSnapshotTeams,
    remainingGames,
    previousRemainingGames,
    availableDates,
    currentDayRemainingGames,
  };
}

function getCachedBasePlayoffData(asOfDate) {
  return unstable_cache(
    async () => loadBasePlayoffData(asOfDate),
    ["playoffs-base-data", asOfDate],
    { revalidate: PLAYOFF_CACHE_SECONDS }
  )();
}

async function computeOverviewPayload(asOfDate) {
  const base = await getCachedBasePlayoffData(asOfDate);

  const currentResults = simulatePlayoffRace({
    teams: base.teamMeta,
    games: base.remainingGames,
    numSims: PLAYOFF_OVERVIEW_SIM_COUNT,
    includeCup: true,
  });

  const previousResults = simulatePlayoffRace({
    teams: base.previousSnapshotTeams,
    games: base.previousRemainingGames,
    numSims: Math.max(2000, Math.round(PLAYOFF_OVERVIEW_SIM_COUNT * 0.75)),
    includeCup: true,
  });

  const movers = calculateDailyMovers(currentResults, previousResults);

  return {
    asOf: asOfDate,
    availableDates: base.availableDates,
    biggestRiser: movers.biggestRiser,
    biggestFaller: movers.biggestFaller,
    teams: movers.teams.map((team) => ({
      ...team,
      record: base.teamMeta[team.team]?.record || null,
      color: base.teamMeta[team.team]?.color || "#6d89a3",
      strengthIndex: base.teamMeta[team.team]?.strengthIndex ?? null,
    })),
  };
}

function getCachedOverviewPayload(asOfDate) {
  return unstable_cache(
    async () => computeOverviewPayload(asOfDate),
    ["playoffs-overview", asOfDate],
    { revalidate: PLAYOFF_CACHE_SECONDS }
  )();
}

async function computeGameImpactsPayload(dateString, asOfDate) {
  const [base, overview] = await Promise.all([
    getCachedBasePlayoffData(asOfDate),
    getCachedOverviewPayload(asOfDate),
  ]);

  const dateGames = base.remainingGames.filter((game) => game.date === dateString);
  const limitedGames = dateGames.slice(0, PLAYOFF_DEFAULT_GAME_DATE_WINDOW);

  const conditionalResultsByGame = limitedGames.map((game) => ({
    game,
    branches: {
      away_reg: simulatePlayoffRace({
        teams: base.teamMeta,
        games: base.remainingGames,
        numSims: PLAYOFF_CONDITIONAL_SIM_COUNT,
        forcedOutcome: { gameId: game.id, branch: "away_reg" },
        includeCup: false,
      }),
      away_ot: simulatePlayoffRace({
        teams: base.teamMeta,
        games: base.remainingGames,
        numSims: PLAYOFF_CONDITIONAL_SIM_COUNT,
        forcedOutcome: { gameId: game.id, branch: "away_ot" },
        includeCup: false,
      }),
      home_ot: simulatePlayoffRace({
        teams: base.teamMeta,
        games: base.remainingGames,
        numSims: PLAYOFF_CONDITIONAL_SIM_COUNT,
        forcedOutcome: { gameId: game.id, branch: "home_ot" },
        includeCup: false,
      }),
      home_reg: simulatePlayoffRace({
        teams: base.teamMeta,
        games: base.remainingGames,
        numSims: PLAYOFF_CONDITIONAL_SIM_COUNT,
        forcedOutcome: { gameId: game.id, branch: "home_reg" },
        includeCup: false,
      }),
    },
  }));

  return calculateGameImpacts({
    baselineResults: {
      teamMap: Object.fromEntries((overview.teams || []).map((team) => [team.team, team])),
    },
    conditionalResultsByGame,
    selectedDate: dateString,
  });
}

function getCachedGameImpactsPayload(dateString, asOfDate) {
  return unstable_cache(
    async () => computeGameImpactsPayload(dateString, asOfDate),
    ["playoffs-game-impacts", asOfDate, dateString],
    { revalidate: PLAYOFF_CACHE_SECONDS }
  )();
}

export async function getPlayoffOverviewPayload(asOfDate = getTorontoDateString()) {
  return getCachedOverviewPayload(asOfDate);
}

export async function getPlayoffGameImpactsPayload(dateString, asOfDate = getTorontoDateString()) {
  const overview = await getPlayoffOverviewPayload(asOfDate);
  const targetDate = dateString && overview.availableDates.includes(dateString)
    ? dateString
    : overview.availableDates[0] || asOfDate;
  return getCachedGameImpactsPayload(targetDate, asOfDate);
}

export async function getTeamProjectionPayload(asOfDate = getTorontoDateString()) {
  const overview = await getPlayoffOverviewPayload(asOfDate);
  return { asOf: overview.asOf, teams: overview.teams };
}

export function playoffJson(payload, seconds = PLAYOFF_CACHE_SECONDS) {
  return jsonWithCache(payload, seconds);
}
