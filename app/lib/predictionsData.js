import { createServerClient } from "@/app/lib/supabase";
import { TEAM_FULL } from "@/app/lib/nhlTeams";
import { buildGameContextFromTeams, buildPlayerAggregates, buildTeamSeasonStatsFromLiveData, normalizeScheduleGame, normalizeStandingsSnapshot } from "@/src/data/livePredictionData";
import { estimateExpectedScoring } from "@/src/models/expectedGoalsModel";
import { predictGame } from "@/src/models/predictGame";
import { buildTeamRatings } from "@/src/models/teamRatings";

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

export async function buildPredictionsForDate(dateString) {
  const dateParts = parseDateString(dateString);
  const yesterdayString = formatDateString(shiftDateParts(dateParts, -1));
  const supabase = createServerClient();

  const [
    todayGamesRaw,
    yesterdayGamesRaw,
    standingsByTeam,
    specialTeamsByTeam,
    { data: players },
  ] = await Promise.all([
    fetchScheduleForDate(dateString),
    fetchScheduleForDate(yesterdayString),
    fetchStandingsMap(),
    fetchSpecialTeamsMap(),
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

      return {
        game,
        context,
        prediction,
        scoring,
        homeTeam,
        awayTeam,
        homeRatings,
        awayRatings,
        homeLeaders: buildTeamLeaders(safePlayers, homeTeam.teamId, homeTeam.teamName),
        awayLeaders: buildTeamLeaders(safePlayers, awayTeam.teamId, awayTeam.teamName),
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
