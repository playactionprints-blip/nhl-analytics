import { Suspense } from "react";
import { createServerClient } from "@/app/lib/supabase";
import TeamsClient from "@/app/teams/TeamsClient";

export const revalidate = 3600;

export const metadata = {
  title: "All Teams — NHL Analytics",
};

const CURRENT_SEASON = "25-26";

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

const TEAM_ALIAS_MAP = {
  "L.A": "LAK",
  "N.J": "NJD",
  "S.J": "SJS",
  "T.B": "TBL",
};

const TEAM_BY_FULLNAME = Object.fromEntries(
  Object.entries(TEAM_FULL).map(([abbr, name]) => [name, abbr])
);

function normalizeTeamCode(teamCode) {
  const raw = typeof teamCode === "object" ? teamCode?.default : teamCode;
  return TEAM_ALIAS_MAP[raw] || raw || null;
}

function seasonToId(season) {
  const start = `20${String(season).slice(0, 2)}`;
  const end = `20${String(season).slice(3, 5)}`;
  return `${start}${end}`;
}

async function fetchStandingsForSeason(season) {
  if (season === CURRENT_SEASON) {
    try {
      const res = await fetch("https://api-web.nhle.com/v1/standings/now", {
        next: { revalidate: 3600 },
      });
      if (!res.ok) return {};
      const data = await res.json();
      const map = {};
      for (const t of data.standings || []) {
        const abbr = normalizeTeamCode(t.teamAbbrev);
        if (!abbr) continue;
        map[abbr] = {
          wins: t.wins || 0,
          losses: t.losses || 0,
          otLosses: t.otLosses || 0,
          points: t.points || 0,
        };
      }
      return map;
    } catch {
      return {};
    }
  }

  try {
    const seasonExpr = encodeURIComponent(`seasonId=${seasonToId(season)} and gameTypeId=2`);
    const res = await fetch(`https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=${seasonExpr}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return {};
    const data = await res.json();
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const map = {};
    for (const row of rows) {
      const abbr =
        normalizeTeamCode(row.teamAbbrevDefault) ||
        normalizeTeamCode(row.teamAbbrev) ||
        TEAM_BY_FULLNAME[row.teamFullName];
      if (!abbr) continue;
      map[abbr] = {
        wins: row.wins ?? row.w ?? null,
        losses: row.losses ?? row.l ?? null,
        otLosses: row.otLosses ?? row.otl ?? row.overtimeLosses ?? null,
        points: row.points ?? row.pts ?? null,
      };
    }
    return map;
  } catch {
    return {};
  }
}

function TeamsClientFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 20% 20%,#0d1e30 0%,var(--bg-primary) 60%)",
        padding: "32px 20px 60px",
        fontFamily: "'Barlow Condensed',sans-serif",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto", color: "#9ab7d0", fontSize: 16 }}>
        Loading teams...
      </div>
    </div>
  );
}

export default async function TeamsPage() {
  const supabase = createServerClient();
  const { data: availableSeasonRows } = await supabase
    .from("player_seasons")
    .select("season")
    .not("season", "is", null)
    .limit(5000);

  const availableSeasons = [...new Set((availableSeasonRows || []).map((row) => row.season).filter(Boolean))]
    .sort((a, b) => String(b).localeCompare(String(a)));

  const [{ data: seasonPlayers }, { data: currentPlayers }, standingsEntries] = await Promise.all([
    supabase
      .from("player_seasons")
      .select("player_id,team,season,war_total,war_ev_off,war_ev_def,war_pp,war_pk,war_shooting,war_penalties"),
    supabase.from("players").select("player_id,team,position,overall_rating"),
    Promise.all(
      availableSeasons.map(async (season) => [season, await fetchStandingsForSeason(season)])
    ),
  ]);

  const standingsBySeason = Object.fromEntries(standingsEntries || []);

  return (
    <Suspense fallback={<TeamsClientFallback />}>
      <TeamsClient
        availableSeasons={availableSeasons}
        seasonPlayers={seasonPlayers || []}
        currentPlayers={currentPlayers || []}
        standingsBySeason={standingsBySeason}
      />
    </Suspense>
  );
}
