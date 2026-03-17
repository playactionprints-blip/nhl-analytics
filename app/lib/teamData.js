/**
 * Shared team-data loader for the team API route.
 * Depends on Supabase players/player_seasons plus NHL standings endpoints
 * so API responses stay aligned with the existing team page data model.
 */
import { createServerClient } from "@/app/lib/supabase";
import { getLastUpdatedForDataType } from "@/app/lib/syncStatus";

const TEAM_FULL = {
  ANA: "Anaheim Ducks", BOS: "Boston Bruins", BUF: "Buffalo Sabres",
  CAR: "Carolina Hurricanes", CBJ: "Columbus Blue Jackets", CGY: "Calgary Flames",
  CHI: "Chicago Blackhawks", COL: "Colorado Avalanche", DAL: "Dallas Stars",
  DET: "Detroit Red Wings", EDM: "Edmonton Oilers", FLA: "Florida Panthers",
  LAK: "Los Angeles Kings", MIN: "Minnesota Wild", MTL: "Montréal Canadiens",
  NSH: "Nashville Predators", NJD: "New Jersey Devils", NYI: "New York Islanders",
  NYR: "New York Rangers", OTT: "Ottawa Senators", PHI: "Philadelphia Flyers",
  PIT: "Pittsburgh Penguins", SEA: "Seattle Kraken", SJS: "San Jose Sharks",
  STL: "St. Louis Blues", TBL: "Tampa Bay Lightning", TOR: "Toronto Maple Leafs",
  UTA: "Utah Hockey Club", VAN: "Vancouver Canucks", VGK: "Vegas Golden Knights",
  WPG: "Winnipeg Jets", WSH: "Washington Capitals",
};

function parseToi(toi) {
  if (!toi) return null;
  const parts = String(toi).split(":");
  const mins = Number.parseInt(parts[0], 10);
  const secs = Number.parseInt(parts[1] || "0", 10);
  if (Number.isNaN(mins)) return null;
  return mins + secs / 60;
}

const TEAM_BY_FULLNAME = Object.fromEntries(
  Object.entries(TEAM_FULL).map(([abbr, name]) => [name, abbr])
);

async function fetchStandings() {
  try {
    const [standingsRes, ppRes] = await Promise.all([
      fetch("https://api-web.nhle.com/v1/standings/now", { next: { revalidate: 3600 } }),
      fetch(
        "https://api.nhle.com/stats/rest/en/team/powerplay?cayenneExp=seasonId=20252026",
        { next: { revalidate: 3600 } }
      ),
    ]);

    const map = {};
    if (standingsRes.ok) {
      const data = await standingsRes.json();
      for (const team of data.standings || []) {
        const abbr = typeof team.teamAbbrev === "object"
          ? team.teamAbbrev.default
          : team.teamAbbrev;
        if (!abbr) continue;
        map[abbr] = {
          wins: team.wins || 0,
          losses: team.losses || 0,
          otLosses: team.otLosses || 0,
          points: team.points || 0,
          ppPct: null,
        };
      }
    }

    if (ppRes.ok) {
      const ppData = await ppRes.json();
      for (const team of ppData.data || []) {
        const abbr = TEAM_BY_FULLNAME[team.teamFullName];
        if (!abbr || !map[abbr]) continue;
        map[abbr].ppPct = team.powerPlayPct != null ? +(team.powerPlayPct * 100).toFixed(1) : null;
      }
    }

    return map;
  } catch {
    return {};
  }
}

export async function fetchTeamPayload(teamCode, options = {}) {
  const code = String(teamCode || "").toUpperCase();
  if (!TEAM_FULL[code]) return null;

  const supabase = options.supabase || createServerClient();
  const [
    { data: teamPlayers, error: teamPlayersError },
    { data: allPlayers, error: allPlayersError },
    { data: teamSeasonRows, error: teamSeasonsError },
    standings,
  ] = await Promise.all([
    supabase.from("players").select("*").eq("team", code).order("overall_rating", { ascending: false, nullsFirst: false }),
    supabase.from("players").select("player_id,team,war_total,cf_pct,xgf_pct,toi"),
    supabase.from("player_seasons").select("season,cf_pct,war_total").eq("team", code),
    fetchStandings(),
  ]);

  if (teamPlayersError) throw teamPlayersError;
  if (allPlayersError) throw allPlayersError;
  if (teamSeasonsError) throw teamSeasonsError;
  const lastUpdated = await getLastUpdatedForDataType(supabase, "teams").catch(() => null);

  let cfToi = 0;
  let cfSum = 0;
  let xgfToi = 0;
  let xgfSum = 0;
  for (const player of allPlayers || []) {
    const toi = parseToi(player.toi);
    if (!toi) continue;
    if (player.cf_pct != null) {
      cfSum += Number(player.cf_pct) * toi;
      cfToi += toi;
    }
    if (player.xgf_pct != null) {
      xgfSum += Number(player.xgf_pct) * toi;
      xgfToi += toi;
    }
  }

  const teamWar = {};
  for (const player of allPlayers || []) {
    if (!player.team || player.war_total == null) continue;
    teamWar[player.team] = (teamWar[player.team] || 0) + Number(player.war_total);
  }

  const warRankMap = Object.fromEntries(
    Object.entries(teamWar)
      .sort((a, b) => b[1] - a[1])
      .map(([team, _value], index) => [team, index + 1])
  );

  let teamCfToi = 0;
  let teamCfSum = 0;
  let teamXgfToi = 0;
  let teamXgfSum = 0;
  for (const player of teamPlayers || []) {
    const toi = parseToi(player.toi);
    if (!toi) continue;
    if (player.cf_pct != null) {
      teamCfSum += Number(player.cf_pct) * toi;
      teamCfToi += toi;
    }
    if (player.xgf_pct != null) {
      teamXgfSum += Number(player.xgf_pct) * toi;
      teamXgfToi += toi;
    }
  }

  const seasonSummaryMap = {};
  for (const row of teamSeasonRows || []) {
    if (!row?.season) continue;
    if (!seasonSummaryMap[row.season]) {
      seasonSummaryMap[row.season] = { season: row.season, cfSum: 0, cfCount: 0, totalWAR: 0 };
    }
    if (row.cf_pct != null && Number.isFinite(Number(row.cf_pct))) {
      seasonSummaryMap[row.season].cfSum += Number(row.cf_pct);
      seasonSummaryMap[row.season].cfCount += 1;
    }
    if (row.war_total != null && Number.isFinite(Number(row.war_total))) {
      seasonSummaryMap[row.season].totalWAR += Number(row.war_total);
    }
  }

  const seasonCharts = Object.values(seasonSummaryMap)
    .map((row) => ({
      season: row.season,
      avgCFPct: row.cfCount > 0 ? +((row.cfSum / row.cfCount).toFixed(1)) : null,
      totalWAR: +(row.totalWAR.toFixed(2)),
      isCurrent: row.season === "25-26",
    }))
    .sort((a, b) => String(a.season).localeCompare(String(b.season)));

  return {
    teamCode: code,
    teamName: TEAM_FULL[code],
    players: teamPlayers || [],
    record: standings[code] || null,
    teamStats: {
      avgCF: teamCfToi > 0 ? +(teamCfSum / teamCfToi).toFixed(2) : null,
      avgXGF: teamXgfToi > 0 ? +(teamXgfSum / teamXgfToi).toFixed(2) : null,
      totalWAR: teamWar[code] != null ? +teamWar[code].toFixed(2) : null,
      warRank: warRankMap[code] || null,
      ppPct: standings[code]?.ppPct ?? null,
      leagueAvgCF: cfToi > 0 ? cfSum / cfToi : 50.0,
      leagueAvgXGF: xgfToi > 0 ? xgfSum / xgfToi : 50.0,
    },
    seasonCharts,
    last_updated: lastUpdated,
  };
}
