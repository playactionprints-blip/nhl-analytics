/**
 * Fantasy Hub schedule API.
 * Depends on the public NHL schedule feed to build a weekly schedule view plus
 * next-7 and next-14 day team game counts for fantasy planning.
 */
import { jsonError, jsonWithCache } from "@/app/lib/apiCache";

export const revalidate = 300;

const OFF_NIGHT_THRESHOLD = 6;

function addDays(dateString, days) {
  const base = new Date(`${dateString}T12:00:00Z`);
  const shifted = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + days));
  return shifted.toISOString().slice(0, 10);
}

function startOfWeek(dateString = null) {
  const base = dateString ? new Date(`${dateString}T12:00:00Z`) : new Date();
  const day = base.getUTCDay();
  const distance = (day + 6) % 7;
  const monday = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - distance));
  return monday.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const SCHEDULE_FETCH_TIMEOUT_MS = 6000;

async function fetchScheduleDay(dateString) {
  // Abort the individual NHL API call after 6 s so a single slow date
  // cannot hang the entire Promise.all and leave the frontend on "Loading…"
  // forever. On any failure (timeout, non-2xx, parse error) we return an
  // empty day rather than throwing, so callers always get a resolved value.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCHEDULE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api-web.nhle.com/v1/schedule/${dateString}`, {
      signal: controller.signal,
      next: { revalidate: 300 },
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.warn(`[fantasy/schedule] NHL API ${response.status} for ${dateString}`);
      return { date: dateString, games: [], numberOfGames: 0 };
    }
    const payload = await response.json();
    const day = (payload.gameWeek || []).find((item) => item.date === dateString);
    return {
      date: dateString,
      games: day?.games || [],
      numberOfGames: day?.numberOfGames || 0,
    };
  } catch (fetchError) {
    clearTimeout(timer);
    const reason = fetchError?.name === "AbortError" ? "timeout" : (fetchError?.message || "unknown");
    console.warn(`[fantasy/schedule] failed to fetch ${dateString}: ${reason}`);
    return { date: dateString, games: [], numberOfGames: 0 };
  }
}

function buildTeamCounts(days) {
  const counts = {};
  days.forEach((day) => {
    day.games.forEach((game) => {
      const away = game.awayTeam?.abbrev;
      const home = game.homeTeam?.abbrev;
      if (away) counts[away] = (counts[away] || 0) + 1;
      if (home) counts[home] = (counts[home] || 0) + 1;
    });
  });
  return counts;
}

function buildOffNightCounts(days) {
  const counts = {};
  days.forEach((day) => {
    if (!day.numberOfGames || day.numberOfGames > OFF_NIGHT_THRESHOLD) return;
    day.games.forEach((game) => {
      const away = game.awayTeam?.abbrev;
      const home = game.homeTeam?.abbrev;
      if (away) counts[away] = (counts[away] || 0) + 1;
      if (home) counts[home] = (counts[home] || 0) + 1;
    });
  });
  return counts;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const selectedWeekStart = startOfWeek(searchParams.get("weekStart"));
    const today = todayIso();
    const currentWeekStart = startOfWeek(today);
    const next7Start = today;
    const next14Start = today;

    const dates = new Set();
    for (let index = 0; index < 7; index += 1) dates.add(addDays(selectedWeekStart, index));
    for (let index = 0; index < 7; index += 1) dates.add(addDays(currentWeekStart, index));
    for (let index = 0; index < 7; index += 1) dates.add(addDays(next7Start, index));
    for (let index = 0; index < 14; index += 1) dates.add(addDays(next14Start, index));

    const days = await Promise.all([...dates].sort().map((dateString) => fetchScheduleDay(dateString)));
    const dayMap = Object.fromEntries(days.map((day) => [day.date, day]));

    const weekDays = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(selectedWeekStart, index);
      const day = dayMap[date] || { games: [], numberOfGames: 0 };
      return {
        date,
        numberOfGames: day.numberOfGames,
        isOffNight: day.numberOfGames > 0 && day.numberOfGames <= OFF_NIGHT_THRESHOLD,
        games: day.games.map((game) => ({
          id: String(game.id),
          startTimeUTC: game.startTimeUTC,
          gameState: game.gameState,
          awayTeam: game.awayTeam?.abbrev,
          homeTeam: game.homeTeam?.abbrev,
        })),
      };
    });

    const todayDay = dayMap[today] || { games: [], numberOfGames: 0 };
    const thisWeekDays = Array.from({ length: 7 }, (_, index) => dayMap[addDays(currentWeekStart, index)]).filter(Boolean);
    const next7Days = Array.from({ length: 7 }, (_, index) => dayMap[addDays(next7Start, index)]).filter(Boolean);
    const next14Days = Array.from({ length: 14 }, (_, index) => dayMap[addDays(next14Start, index)]).filter(Boolean);

    return jsonWithCache(
      {
        generatedAt: new Date().toISOString(),
        selectedWeekStart,
        offNightThreshold: OFF_NIGHT_THRESHOLD,
        weekDays,
        spanCounts: {
          today: buildTeamCounts([todayDay]),
          thisWeek: buildTeamCounts(thisWeekDays),
          next7: buildTeamCounts(next7Days),
          next14: buildTeamCounts(next14Days),
        },
        offNightCounts: {
          today: buildOffNightCounts([todayDay]),
          thisWeek: buildOffNightCounts(thisWeekDays),
          next7: buildOffNightCounts(next7Days),
          next14: buildOffNightCounts(next14Days),
        },
      },
      300
    );
  } catch (error) {
    return jsonError(error.message || "Failed to load fantasy schedule", 500);
  }
}
