import { createServerClient } from "@/app/lib/supabase";
import { TEAM_FULL } from "@/app/lib/nhlTeams";
import { buildGameContextFromTeams, buildPlayerAggregates, buildTeamSeasonStatsFromLiveData, normalizeScheduleGame, normalizeStandingsSnapshot } from "@/src/data/livePredictionData";
import { estimateExpectedScoring } from "@/src/models/expectedGoalsModel";
import { predictGame } from "@/src/models/predictGame";
import { buildTeamRatings } from "@/src/models/teamRatings";
import { americanOddsToImpliedProbability, removeOverroundFromMoneylines } from "@/src/utils/odds";

export function getTorontoDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
  };
}

export function formatDateString({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDateString(dateString) {
  const [year, month, day] = (dateString || "").split("-").map(Number);
  return { year, month, day };
}

export function shiftDateParts(parts, deltaDays) {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + deltaDays));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function formatStartTime(utcString) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(utcString));
  } catch {
    return utcString || "TBD";
  }
}

export function formatHeadlineDate(dateString) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(`${dateString}T12:00:00Z`));
  } catch {
    return dateString;
  }
}

export function formatRecord(record) {
  if (!record) return "—";
  return `${record.wins}-${record.losses}-${record.overtimeLosses}`;
}

export function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

export function signedOdds(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

export function confidenceMeta(band) {
  if (band === "high") return { color: "#35e3a0", bg: "rgba(53,227,160,0.14)" };
  if (band === "medium") return { color: "#f0c040", bg: "rgba(240,192,64,0.14)" };
  return { color: "#ff8d9b", bg: "rgba(255,111,123,0.14)" };
}

export function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(255,255,255,${alpha})`;
  const normalized = hex.replace("#", "");
  const safe = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const value = Number.parseInt(safe, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function predictionHref(dateString, gameId) {
  return `/predictions/${dateString}/${gameId}`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function normalizeTeamNameForOdds(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[.']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function fetchMarketOddsMap() {
  const apiKey = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY;
  if (!apiKey) return {};

  try {
    const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds/?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) return {};

    const data = await res.json();
    const oddsMap = {};

    for (const event of data || []) {
      const homeName = normalizeTeamNameForOdds(event.home_team);
      const awayName = normalizeTeamNameForOdds(event.away_team);
      const homePrices = [];
      const awayPrices = [];
      const books = [];

      for (const bookmaker of event.bookmakers || []) {
        const market = (bookmaker.markets || []).find((item) => item.key === "h2h");
        if (!market) continue;
        const homeOutcome = (market.outcomes || []).find(
          (item) => normalizeTeamNameForOdds(item.name) === homeName
        );
        const awayOutcome = (market.outcomes || []).find(
          (item) => normalizeTeamNameForOdds(item.name) === awayName
        );
        if (
          typeof homeOutcome?.price === "number" &&
          typeof awayOutcome?.price === "number"
        ) {
          homePrices.push(homeOutcome.price);
          awayPrices.push(awayOutcome.price);
          books.push(bookmaker.title);
        }
      }

      const homeMoneyline = median(homePrices);
      const awayMoneyline = median(awayPrices);
      if (homeMoneyline == null || awayMoneyline == null) continue;

      const devigged = removeOverroundFromMoneylines(homeMoneyline, awayMoneyline);
      oddsMap[`${awayName}__${homeName}`] = {
        homeMoneyline: Math.round(homeMoneyline),
        awayMoneyline: Math.round(awayMoneyline),
        homeProbability: devigged.homeProbability,
        awayProbability: devigged.awayProbability,
        sourceCount: books.length,
        sourceLabel: books.length > 0 ? `Median of ${books.length} books` : "Market median",
      };
    }

    return oddsMap;
  } catch {
    return {};
  }
}

async function fetchScheduleForDate(dateString) {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/schedule/${dateString}`, {
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const gameWeekGames = (data.gameWeek || []).flatMap((day) => day.games || []);
    return data.games || gameWeekGames || [];
  } catch {
    return [];
  }
}

async function fetchStandingsMap() {
  try {
    const res = await fetch("https://api-web.nhle.com/v1/standings/now", {
      next: { revalidate: 1800 },
    });
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const raw of data.standings || []) {
      const row = normalizeStandingsSnapshot(raw, TEAM_FULL);
      if (!row) continue;
      map[row.abbr] = row;
    }
    return map;
  } catch {
    return {};
  }
}

async function fetchSpecialTeamsMap() {
  try {
    const seasonExpr = "seasonId=20252026";
    const [ppRes, pkRes] = await Promise.all([
      fetch(`https://api.nhle.com/stats/rest/en/team/powerplay?cayenneExp=${seasonExpr}`, {
        next: { revalidate: 1800 },
      }),
      fetch(`https://api.nhle.com/stats/rest/en/team/penaltykill?cayenneExp=${seasonExpr}`, {
        next: { revalidate: 1800 },
      }),
    ]);

    const map = {};
    if (ppRes.ok) {
      const data = await ppRes.json();
      for (const row of data.data || []) {
        const abbr = Object.entries(TEAM_FULL).find(([, name]) => name === row.teamFullName)?.[0];
        if (!abbr) continue;
        map[abbr] = {
          ...(map[abbr] || {}),
          ppPct: row.powerPlayPct != null ? row.powerPlayPct : null,
        };
      }
    }
    if (pkRes.ok) {
      const data = await pkRes.json();
      for (const row of data.data || []) {
        const abbr = Object.entries(TEAM_FULL).find(([, name]) => name === row.teamFullName)?.[0];
        if (!abbr) continue;
        map[abbr] = {
          ...(map[abbr] || {}),
          pkPct: row.penaltyKillPct != null ? row.penaltyKillPct : null,
        };
      }
    }
    return map;
  } catch {
    return {};
  }
}

function buildFallbackTeamLeaders(teamId, teamName) {
  return {
    teamId,
    teamName,
    topSkaters: [],
    topOffense: [],
    topDefense: [],
    goalies: [],
  };
}

export function buildTeamLeaders(players, teamId, teamName) {
  const teamPlayers = (players || []).filter((player) => player.team === teamId);
  if (!teamPlayers.length) return buildFallbackTeamLeaders(teamId, teamName);

  const skaters = teamPlayers
    .filter((player) => player.position !== "G")
    .sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0));

  const goalies = teamPlayers
    .filter((player) => player.position === "G")
    .sort((a, b) => (b.gp || 0) - (a.gp || 0) || (b.save_pct || 0) - (a.save_pct || 0));

  return {
    teamId,
    teamName,
    topSkaters: skaters.slice(0, 6),
    topOffense: [...skaters].sort((a, b) => (b.off_rating || 0) - (a.off_rating || 0)).slice(0, 3),
    topDefense: [...skaters].sort((a, b) => (b.def_rating || 0) - (a.def_rating || 0)).slice(0, 3),
    goalies: goalies.slice(0, 2),
  };
}

function buildProjectedGoalie(teamLeaders, teamStats, sideLabel, isBackToBack) {
  const [starter, backup] = teamLeaders.goalies || [];
  const projected = starter || backup || null;
  if (!projected) {
    return {
      sideLabel,
      confidence: "low",
      projectionLabel: "No goalie projection available",
      starterName: `${teamStats.teamName} starter`,
      alternateName: null,
      savePct: null,
      gsax: null,
      notes: ["Based on team aggregate only"],
    };
  }

  const gpGap = (starter?.gp || 0) - (backup?.gp || 0);
  const confidence = backup
    ? gpGap >= 10
      ? "high"
      : gpGap >= 4
        ? "medium"
        : "low"
    : "medium";

  const notes = [];
  if (isBackToBack) notes.push("Back-to-back spot may affect starter choice");
  if (backup?.full_name) notes.push(`Alternate: ${backup.full_name}`);

  return {
    sideLabel,
    confidence,
    projectionLabel: confidence === "high" ? "Projected starter" : "Likely starter",
    starterName: projected.full_name || `${teamStats.teamName} starter`,
    alternateName: backup?.full_name || null,
    savePct: typeof projected.save_pct === "number" ? projected.save_pct : null,
    gsax: typeof projected.gsax === "number" ? projected.gsax : null,
    notes,
  };
}

export async function buildPredictionsForDate(dateString) {
  const dateParts = parseDateString(dateString);
  const yesterdayString = formatDateString(shiftDateParts(dateParts, -1));
  const supabase = createServerClient();

  const [
    todayGamesRaw,
    yesterdayGamesRaw,
    standingsByTeam,
    specialTeamsByTeam,
    marketOddsByGame,
    { data: players },
  ] = await Promise.all([
    fetchScheduleForDate(dateString),
    fetchScheduleForDate(yesterdayString),
    fetchStandingsMap(),
    fetchSpecialTeamsMap(),
    fetchMarketOddsMap(),
    supabase
      .from("players")
      .select("team,position,off_rating,def_rating,overall_rating,xgf_pct,war_shooting,gp,save_pct,gsax,full_name"),
  ]);

  const safePlayers = players || [];
  const playerAggregates = buildPlayerAggregates(safePlayers, TEAM_FULL);
  const yesterdayTeams = new Set(
    (yesterdayGamesRaw || [])
      .flatMap((game) => {
        const normalized = normalizeScheduleGame(game, TEAM_FULL);
        return normalized ? [normalized.homeTeam.abbr, normalized.awayTeam.abbr] : [];
      })
  );

  const normalizedGames = (todayGamesRaw || [])
    .map((game) => normalizeScheduleGame(game, TEAM_FULL))
    .filter(Boolean)
    .filter((game) => !["FINAL", "OFF"].includes(game.gameState));

  const predictions = normalizedGames
    .map((game) => {
      const homeTeam = buildTeamSeasonStatsFromLiveData(
        game.homeTeam.abbr,
        standingsByTeam,
        specialTeamsByTeam,
        playerAggregates
      );
      const awayTeam = buildTeamSeasonStatsFromLiveData(
        game.awayTeam.abbr,
        standingsByTeam,
        specialTeamsByTeam,
        playerAggregates
      );

      if (!homeTeam || !awayTeam) return null;

      const context = buildGameContextFromTeams(homeTeam, awayTeam, playerAggregates);
      context.homeBackToBack = yesterdayTeams.has(homeTeam.teamId);
      context.awayBackToBack = yesterdayTeams.has(awayTeam.teamId);
      context.homeRestDays = context.homeBackToBack ? 0 : 1;
      context.awayRestDays = context.awayBackToBack ? 0 : 1;
      context.homeTravelDisadvantage = false;
      context.awayTravelDisadvantage = context.awayBackToBack;

      const homeRatings = buildTeamRatings(homeTeam, "home", context);
      const awayRatings = buildTeamRatings(awayTeam, "away", context);
      const scoring = estimateExpectedScoring(homeRatings, awayRatings, context);
      const prediction = predictGame(context);
      const homeLeaders = buildTeamLeaders(safePlayers, homeTeam.teamId, homeTeam.teamName);
      const awayLeaders = buildTeamLeaders(safePlayers, awayTeam.teamId, awayTeam.teamName);
      const oddsKey = `${normalizeTeamNameForOdds(game.awayTeam.name)}__${normalizeTeamNameForOdds(game.homeTeam.name)}`;
      const market = marketOddsByGame[oddsKey] || null;
      const projectedHomeGoalie = buildProjectedGoalie(homeLeaders, homeTeam, "home", context.homeBackToBack);
      const projectedAwayGoalie = buildProjectedGoalie(awayLeaders, awayTeam, "away", context.awayBackToBack);

      return {
        game,
        context,
        prediction,
        scoring,
        homeTeam,
        awayTeam,
        homeRatings,
        awayRatings,
        homeLeaders,
        awayLeaders,
        projectedHomeGoalie,
        projectedAwayGoalie,
        market: market
          ? {
              ...market,
              homeEdge: prediction.homeWinPct - market.homeProbability,
              awayEdge: prediction.awayWinPct - market.awayProbability,
              homeRawProbability: americanOddsToImpliedProbability(market.homeMoneyline),
              awayRawProbability: americanOddsToImpliedProbability(market.awayMoneyline),
            }
          : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.game.startTimeUTC).getTime() - new Date(b.game.startTimeUTC).getTime());

  return {
    dateString,
    predictions,
    standingsByTeam,
    specialTeamsByTeam,
    players: safePlayers,
  };
}
