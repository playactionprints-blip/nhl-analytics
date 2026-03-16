import { notFound } from 'next/navigation';
import { createServerClient } from '@/app/lib/supabase';
import TeamPage from '@/TeamPage';

export const revalidate = 3600;

const TEAM_FULL = {
  ANA:"Anaheim Ducks",BOS:"Boston Bruins",BUF:"Buffalo Sabres",
  CAR:"Carolina Hurricanes",CBJ:"Columbus Blue Jackets",CGY:"Calgary Flames",
  CHI:"Chicago Blackhawks",COL:"Colorado Avalanche",DAL:"Dallas Stars",
  DET:"Detroit Red Wings",EDM:"Edmonton Oilers",FLA:"Florida Panthers",
  LAK:"Los Angeles Kings",MIN:"Minnesota Wild",MTL:"Montréal Canadiens",
  NSH:"Nashville Predators",NJD:"New Jersey Devils",NYI:"New York Islanders",
  NYR:"New York Rangers",OTT:"Ottawa Senators",PHI:"Philadelphia Flyers",
  PIT:"Pittsburgh Penguins",SEA:"Seattle Kraken",SJS:"San Jose Sharks",
  STL:"St. Louis Blues",TBL:"Tampa Bay Lightning",TOR:"Toronto Maple Leafs",
  UTA:"Utah Hockey Club",VAN:"Vancouver Canucks",VGK:"Vegas Golden Knights",
  WPG:"Winnipeg Jets",WSH:"Washington Capitals",
};

const TEAM_COLOR = {
  ANA:"#F47A38",BOS:"#FFB81C",BUF:"#003087",CAR:"#CC0000",
  CBJ:"#002654",CGY:"#C8102E",CHI:"#CF0A2C",COL:"#6F263D",DAL:"#006847",
  DET:"#CE1126",EDM:"#FF4C00",FLA:"#C8102E",LAK:"#111111",MIN:"#154734",
  MTL:"#AF1E2D",NSH:"#FFB81C",NJD:"#CC0000",NYI:"#00539B",NYR:"#0038A8",
  OTT:"#C52032",PHI:"#F74902",PIT:"#CFC493",SEA:"#99D9D9",SJS:"#006D75",
  STL:"#002F87",TBL:"#002868",TOR:"#00205B",UTA:"#69B3E7",VAN:"#00843D",
  VGK:"#B4975A",WPG:"#041E42",WSH:"#C8102E",
};

// Pre-build all 32 team pages at build time
export function generateStaticParams() {
  return Object.keys(TEAM_FULL).map(teamCode => ({ teamCode }));
}

export async function generateMetadata({ params }) {
  const { teamCode } = await params;
  const code = teamCode?.toUpperCase();
  const name = TEAM_FULL[code] || code;
  return { title: `${name} — NHL Analytics` };
}

function parseToi(toi) {
  if (!toi) return null;
  const parts = String(toi).split(':');
  const mins = parseInt(parts[0]);
  const secs = parseInt(parts[1]) || 0;
  if (isNaN(mins)) return null;
  return mins + secs / 60;
}

// Invert TEAM_FULL so we can look up abbr by full team name
const TEAM_BY_FULLNAME = Object.fromEntries(
  Object.entries(TEAM_FULL).map(([abbr, name]) => [name, abbr])
);

async function fetchStandings() {
  try {
    const [standingsRes, ppRes] = await Promise.all([
      fetch('https://api-web.nhle.com/v1/standings/now', { next: { revalidate: 3600 } }),
      fetch(
        'https://api.nhle.com/stats/rest/en/team/powerplay?cayenneExp=seasonId=20252026',
        { next: { revalidate: 3600 } }
      ),
    ]);

    const map = {};

    // W/L/OTL/points from standings endpoint
    if (standingsRes.ok) {
      const data = await standingsRes.json();
      for (const t of (data.standings || [])) {
        const abbr = typeof t.teamAbbrev === 'object'
          ? t.teamAbbrev.default
          : t.teamAbbrev;
        if (!abbr) continue;
        map[abbr] = {
          wins:     t.wins     || 0,
          losses:   t.losses   || 0,
          otLosses: t.otLosses || 0,
          points:   t.points   || 0,
          ppPct:    null,
        };
      }
    }

    // PP% from the team powerplay stats endpoint.
    // powerPlayPct is a decimal (e.g. 0.331 = 33.1%). Teams identified by teamFullName.
    if (ppRes.ok) {
      const ppData = await ppRes.json();
      for (const t of (ppData.data || [])) {
        const abbr = TEAM_BY_FULLNAME[t.teamFullName];
        if (!abbr) continue;
        const raw = t.powerPlayPct;
        if (map[abbr]) {
          map[abbr].ppPct = raw != null ? +(raw * 100).toFixed(1) : null;
        }
      }
    }

    return map;
  } catch {
    return {};
  }
}

export default async function TeamPageRoute({ params }) {
  const { teamCode: rawCode } = await params;
  const teamCode = rawCode?.toUpperCase();

  if (!TEAM_FULL[teamCode]) notFound();

  const supabase = createServerClient();

  const [
    { data: teamPlayers },
    { data: allPlayers },
    { data: teamSeasonRows },
    standings,
  ] = await Promise.all([
    supabase
      .from('players')
      .select('*')
      .eq('team', teamCode)
      .order('overall_rating', { ascending: false, nullsFirst: false }),
    supabase
      .from('players')
      .select('player_id,team,war_total,cf_pct,xgf_pct,toi'),
    supabase
      .from('player_seasons')
      .select('season,cf_pct,war_total')
      .eq('team', teamCode),
    fetchStandings(),
  ]);

  // ── League-level aggregates for comparison ──────────────────────────────────
  let cfToi = 0, cfSum = 0, xgfToi = 0, xgfSum = 0;
  for (const p of (allPlayers || [])) {
    const t = parseToi(p.toi);
    if (!t) continue;
    if (p.cf_pct  != null) { cfSum  += p.cf_pct  * t; cfToi  += t; }
    if (p.xgf_pct != null) { xgfSum += p.xgf_pct * t; xgfToi += t; }
  }
  const leagueAvgCF  = cfToi  > 0 ? cfSum  / cfToi  : 50.0;
  const leagueAvgXGF = xgfToi > 0 ? xgfSum / xgfToi : 50.0;

  // ── Team WAR totals → ranking ───────────────────────────────────────────────
  const teamWAR = {};
  for (const p of (allPlayers || [])) {
    if (!p.team || p.war_total == null) continue;
    teamWAR[p.team] = (teamWAR[p.team] || 0) + p.war_total;
  }
  const warRanked = Object.entries(teamWAR)
    .sort((a, b) => b[1] - a[1])
    .map(([t], i) => [t, i + 1]);
  const warRankMap = Object.fromEntries(warRanked);

  // ── Team-level weighted on-ice stats ───────────────────────────────────────
  const tp = teamPlayers || [];
  let tCFToi = 0, tCF = 0, tXGFToi = 0, tXGF = 0;
  for (const p of tp) {
    const t = parseToi(p.toi);
    if (!t) continue;
    if (p.cf_pct  != null) { tCF  += p.cf_pct  * t; tCFToi  += t; }
    if (p.xgf_pct != null) { tXGF += p.xgf_pct * t; tXGFToi += t; }
  }

  const teamStats = {
    avgCF:      tCFToi  > 0 ? +(tCF  / tCFToi).toFixed(2)  : null,
    avgXGF:     tXGFToi > 0 ? +(tXGF / tXGFToi).toFixed(2) : null,
    totalWAR:   teamWAR[teamCode] != null ? +teamWAR[teamCode].toFixed(2) : null,
    warRank:    warRankMap[teamCode] || null,
    ppPct:      standings[teamCode]?.ppPct ?? null,
    leagueAvgCF,
    leagueAvgXGF,
  };

  const seasonSummaryMap = {};
  for (const row of (teamSeasonRows || [])) {
    if (!row?.season) continue;
    if (!seasonSummaryMap[row.season]) {
      seasonSummaryMap[row.season] = {
        season: row.season,
        cfSum: 0,
        cfCount: 0,
        totalWAR: 0,
      };
    }
    if (row.cf_pct != null && !Number.isNaN(Number(row.cf_pct))) {
      seasonSummaryMap[row.season].cfSum += Number(row.cf_pct);
      seasonSummaryMap[row.season].cfCount += 1;
    }
    if (row.war_total != null && !Number.isNaN(Number(row.war_total))) {
      seasonSummaryMap[row.season].totalWAR += Number(row.war_total);
    }
  }

  const seasonCharts = Object.values(seasonSummaryMap)
    .map((row) => ({
      season: row.season,
      avgCFPct: row.cfCount > 0 ? +((row.cfSum / row.cfCount).toFixed(1)) : null,
      totalWAR: +(row.totalWAR.toFixed(2)),
      isCurrent: row.season === '25-26',
    }))
    .sort((a, b) => String(a.season).localeCompare(String(b.season)));

  const record = standings[teamCode] || null;

  // ── Map player objects to the shape PlayerCard expects ─────────────────────
  const mappedPlayers = tp.map(p => ({
    ...p,
    percentiles: p.percentiles || {},
    warTrend:    p.warTrend    || [],
    teamColor:   TEAM_COLOR[p.team] || '#4a6a88',
    initials:    `${(p.first_name || '?')[0]}${(p.last_name || '?')[0]}`,
    name:        p.full_name,
    firstName:   p.first_name,
    lastName:    p.last_name,
  }));

  return (
    <TeamPage
      teamCode={teamCode}
      players={mappedPlayers}
      record={record}
      teamStats={teamStats}
      seasonCharts={seasonCharts}
    />
  );
}
