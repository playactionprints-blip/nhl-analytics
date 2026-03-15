import { createServerClient } from "@/app/lib/supabase";
import { TEAM_FULL } from "@/app/lib/nhlTeams";
import { unstable_cache } from "next/cache";
import { buildGameContextFromTeams, buildPlayerAggregates, buildTeamSeasonStatsFromLiveData, normalizeScheduleGame, normalizeStandingsSnapshot } from "@/src/data/livePredictionData";
import { estimateExpectedScoring } from "@/src/models/expectedGoalsModel";
import { predictGame } from "@/src/models/predictGame";
import { buildTeamRatings } from "@/src/models/teamRatings";
import { americanOddsToImpliedProbability, removeOverroundFromMoneylines } from "@/src/utils/odds";

const MAX_ODDS_CALLS_PER_DAY = 15;
const ODDS_CACHE_WINDOW_SECONDS = Math.floor((24 * 60 * 60) / MAX_ODDS_CALLS_PER_DAY);

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

function getTorontoClockParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function getOddsCacheSlotKey(date = new Date()) {
  const parts = getTorontoClockParts(date);
  const minutesIntoDay = parts.hour * 60 + parts.minute;
  const slotIndex = Math.floor((minutesIntoDay * 60) / ODDS_CACHE_WINDOW_SECONDS);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}-slot-${slotIndex}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtmlToLines(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<(br|\/p|\/div|\/section|\/article|\/li|\/h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const TEAM_NAME_VARIANTS = Object.values(TEAM_FULL).reduce((acc, name) => {
  acc.add(normalizeText(name));
  acc.add(normalizeText(name.replace("St.", "St")));
  acc.add(normalizeText(name.replace("Montréal", "Montreal")));
  return acc;
}, new Set());

function isDailyFaceoffMatchupLine(line) {
  if (!line.includes(" at ")) return false;
  const [away, home] = line.split(" at ");
  return TEAM_NAME_VARIANTS.has(normalizeText(away)) && TEAM_NAME_VARIANTS.has(normalizeText(home));
}

function parseDailyFaceoffSource(line) {
  const sourceIndex = line.indexOf("Source:");
  if (sourceIndex === -1) return null;
  return line.slice(sourceIndex + "Source:".length).trim();
}

function parseDailyFaceoffGoalie(lines, startIndex) {
  let index = startIndex;
  const name = lines[index] || null;
  if (!name) return null;
  index += 1;

  const statusPattern = /^(Confirmed|Likely|Unconfirmed|Expected)$/i;
  const status = statusPattern.test(lines[index] || "") ? lines[index] : null;
  if (status) index += 1;

  let updatedAt = null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(lines[index] || "")) {
    updatedAt = lines[index];
    index += 1;
  }

  while (index < lines.length && lines[index] === "Show More") {
    index += 1;
  }

  let savePct = null;
  let gaa = null;
  let record = null;
  let note = null;
  let source = null;

  while (index < lines.length) {
    const line = lines[index];
    if (isDailyFaceoffMatchupLine(line)) break;
    if (statusPattern.test(line)) break;
    if (/^[A-Z][a-z]+ [A-Z]/.test(line) && !line.includes(":") && !line.includes(" at ")) break;

    if (line.startsWith("W-L-OTL:")) {
      record = line.replace("W-L-OTL:", "").trim();
    } else if (line.startsWith("GAA:")) {
      const value = Number(line.replace("GAA:", "").trim());
      gaa = Number.isFinite(value) ? value : null;
    } else if (line.startsWith("SV%:")) {
      const value = Number(line.replace("SV%:", "").trim());
      savePct = Number.isFinite(value) ? value : null;
    } else if (line.includes("Source:")) {
      note = line;
      source = parseDailyFaceoffSource(line);
      index += 1;
      break;
    }
    index += 1;
  }

  return {
    nextIndex: index,
    goalie: {
      starterName: name,
      status: status || "Unconfirmed",
      updatedAt,
      savePct,
      gaa,
      record,
      source,
      note,
    },
  };
}

async function fetchDailyFaceoffGoalies(dateString) {
  try {
    const res = await fetch(`https://www.dailyfaceoff.com/starting-goalies/${dateString}`, {
      next: { revalidate: 900 },
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; NHLAnalyticsBot/1.0)",
      },
    });
    if (!res.ok) return {};

    const html = await res.text();
    const lines = stripHtmlToLines(html);
    const results = {};

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!isDailyFaceoffMatchupLine(line)) continue;

      const [awayTeamName, homeTeamName] = line.split(" at ");
      let cursor = index + 1;
      let gameTime = null;

      if (/^\d{4}-\d{2}-\d{2}T/.test(lines[cursor] || "")) {
        gameTime = lines[cursor];
        cursor += 1;
      }

      const awayParsed = parseDailyFaceoffGoalie(lines, cursor);
      if (!awayParsed) continue;
      cursor = awayParsed.nextIndex;
      const homeParsed = parseDailyFaceoffGoalie(lines, cursor);
      if (!homeParsed) continue;

      results[`${normalizeText(awayTeamName)}__${normalizeText(homeTeamName)}`] = {
        gameTime,
        away: awayParsed.goalie,
        home: homeParsed.goalie,
      };
    }

    return results;
  } catch {
    return {};
  }
}

async function fetchMarketOddsMap() {
  const apiKey = process.env.THE_ODDS_API_KEY || process.env.ODDS_API_KEY;
  if (!apiKey) return {};

  const slotKey = getOddsCacheSlotKey();
  const fetchForSlot = unstable_cache(
    async () => {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds/?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
        const res = await fetch(url, { cache: "no-store" });
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
            cacheWindowSeconds: ODDS_CACHE_WINDOW_SECONDS,
          };
        }

        return oddsMap;
      } catch {
        return {};
      }
    },
    ["the-odds-api-market", slotKey],
    { revalidate: ODDS_CACHE_WINDOW_SECONDS }
  );

  return fetchForSlot();
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
    dailyFaceoffGoalies,
    { data: players },
  ] = await Promise.all([
    fetchScheduleForDate(dateString),
    fetchScheduleForDate(yesterdayString),
    fetchStandingsMap(),
    fetchSpecialTeamsMap(),
    fetchMarketOddsMap(),
    fetchDailyFaceoffGoalies(dateString),
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
      const goalieKey = `${normalizeText(game.awayTeam.name)}__${normalizeText(game.homeTeam.name)}`;
      const dailyFaceoffGame = dailyFaceoffGoalies[goalieKey] || null;
      const projectedHomeGoalie = dailyFaceoffGame?.home
        ? {
            sideLabel: "home",
            confidence: dailyFaceoffGame.home.status === "Confirmed" ? "high" : dailyFaceoffGame.home.status === "Likely" ? "medium" : "low",
            projectionLabel: dailyFaceoffGame.home.status,
            starterName: dailyFaceoffGame.home.starterName,
            alternateName: homeLeaders.goalies?.[1]?.full_name || null,
            savePct: dailyFaceoffGame.home.savePct,
            gsax: homeLeaders.goalies?.find((goalie) => goalie.full_name === dailyFaceoffGame.home.starterName)?.gsax ?? null,
            source: dailyFaceoffGame.home.source,
            updatedAt: dailyFaceoffGame.home.updatedAt,
            notes: [
              dailyFaceoffGame.home.note || null,
              context.homeBackToBack ? "Back-to-back spot may affect late changes" : null,
            ].filter(Boolean),
          }
        : buildProjectedGoalie(homeLeaders, homeTeam, "home", context.homeBackToBack);
      const projectedAwayGoalie = dailyFaceoffGame?.away
        ? {
            sideLabel: "away",
            confidence: dailyFaceoffGame.away.status === "Confirmed" ? "high" : dailyFaceoffGame.away.status === "Likely" ? "medium" : "low",
            projectionLabel: dailyFaceoffGame.away.status,
            starterName: dailyFaceoffGame.away.starterName,
            alternateName: awayLeaders.goalies?.[1]?.full_name || null,
            savePct: dailyFaceoffGame.away.savePct,
            gsax: awayLeaders.goalies?.find((goalie) => goalie.full_name === dailyFaceoffGame.away.starterName)?.gsax ?? null,
            source: dailyFaceoffGame.away.source,
            updatedAt: dailyFaceoffGame.away.updatedAt,
            notes: [
              dailyFaceoffGame.away.note || null,
              context.awayBackToBack ? "Back-to-back spot may affect late changes" : null,
            ].filter(Boolean),
          }
        : buildProjectedGoalie(awayLeaders, awayTeam, "away", context.awayBackToBack);

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
