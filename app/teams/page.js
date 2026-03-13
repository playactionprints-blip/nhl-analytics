import Link from 'next/link';
import { createServerClient } from '@/app/lib/supabase';

export const revalidate = 3600;

export const metadata = {
  title: 'All Teams — NHL Analytics',
};

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
  DET:"#CE1126",EDM:"#FF4C00",FLA:"#C8102E",LAK:"#555555",MIN:"#154734",
  MTL:"#AF1E2D",NSH:"#FFB81C",NJD:"#CC0000",NYI:"#00539B",NYR:"#0038A8",
  OTT:"#C52032",PHI:"#F74902",PIT:"#CFC493",SEA:"#99D9D9",SJS:"#006D75",
  STL:"#002F87",TBL:"#002868",TOR:"#00205B",UTA:"#69B3E7",VAN:"#00843D",
  VGK:"#B4975A",WPG:"#041E42",WSH:"#C8102E",
};

function logoUrl(abbr) {
  return `https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg`;
}

async function fetchStandings() {
  try {
    const res = await fetch('https://api-web.nhle.com/v1/standings/now', {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const t of (data.standings || [])) {
      const abbr = typeof t.teamAbbrev === 'object' ? t.teamAbbrev.default : t.teamAbbrev;
      if (!abbr) continue;
      map[abbr] = {
        wins:     t.wins     || 0,
        losses:   t.losses   || 0,
        otLosses: t.otLosses || 0,
        points:   t.points   || 0,
      };
    }
    return map;
  } catch {
    return {};
  }
}

function pctColor(v) {
  if (v >= 85) return "#00e5a0";
  if (v >= 70) return "#f0c040";
  if (v >= 50) return "#f08040";
  return "#e05050";
}

export default async function TeamsPage() {
  const supabase = createServerClient();

  const [{ data: allPlayers }, standings] = await Promise.all([
    supabase
      .from('players')
      .select('player_id,team,position,war_total,overall_rating'),
    fetchStandings(),
  ]);

  // Aggregate per-team stats
  const teamData = {};
  for (const abbr of Object.keys(TEAM_FULL)) {
    teamData[abbr] = { war: 0, ratingSum: 0, ratingCount: 0, playerCount: 0 };
  }
  for (const p of (allPlayers || [])) {
    const abbr = p.team;
    if (!abbr || !teamData[abbr]) continue;
    teamData[abbr].playerCount++;
    if (p.war_total != null) teamData[abbr].war += p.war_total;
    // Avg rating from skaters only (goalies don't have reliable overall_rating)
    if (p.overall_rating != null && p.position !== 'G') {
      teamData[abbr].ratingSum   += p.overall_rating;
      teamData[abbr].ratingCount += 1;
    }
  }

  // Build sorted team list
  const teams = Object.entries(TEAM_FULL)
    .map(([abbr, name]) => {
      const td = teamData[abbr] || { war: 0, ratingSum: 0, ratingCount: 0, playerCount: 0 };
      const record = standings[abbr];
      return {
        abbr,
        name,
        war:       +td.war.toFixed(1),
        avgRating: td.ratingCount > 0 ? +(td.ratingSum / td.ratingCount).toFixed(1) : null,
        playerCount: td.playerCount,
        record,
        color: TEAM_COLOR[abbr] || '#4a6a88',
      };
    })
    .sort((a, b) => b.war - a.war);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at 20% 20%,#0d1e30 0%,#05090f 60%)',
      padding: '32px 20px 60px',
      fontFamily: "'Barlow Condensed',sans-serif",
    }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        .team-card:hover { transform: translateY(-2px); box-shadow: var(--hover-shadow) !important; }
        .team-card { transition: transform 0.18s, box-shadow 0.18s; }
      `}</style>

      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Page header */}
        <div style={{ marginBottom: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#2a5070', letterSpacing: '0.2em',
            textTransform: 'uppercase', fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>
            NHL Analytics
          </div>
          <h1 style={{ fontSize: 42, fontWeight: 900, color: '#e8f4ff',
            letterSpacing: '-0.5px', lineHeight: 1, margin: 0 }}>
            All Teams
          </h1>
          <div style={{ fontSize: 12, color: '#2a4060', fontFamily: "'DM Mono',monospace", marginTop: 6 }}>
            Ranked by Total WAR · 2025–26 Season
          </div>
        </div>

        {/* Teams grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}>
          {teams.map((team, idx) => {
            const rec = team.record;
            const recordStr = rec ? `${rec.wins}-${rec.losses}-${rec.otLosses}` : '—';
            const pts = rec ? `${rec.points} pts` : null;
            const rankLabel = `#${idx + 1}`;
            const topTen = idx < 10;

            return (
              <Link
                key={team.abbr}
                href={`/team/${team.abbr}`}
                className="team-card"
                style={{
                  display: 'block',
                  textDecoration: 'none',
                  background: '#0a1218',
                  border: `1px solid ${team.color}22`,
                  borderRadius: 12,
                  padding: '16px',
                  '--hover-shadow': `0 8px 24px ${team.color}33`,
                  boxShadow: 'none',
                  animation: `fadeUp 0.3s ease ${idx * 0.02}s both`,
                }}>

                {/* Top row: rank + logo + name */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{
                    width: 24, fontSize: 11, color: topTen ? team.color : '#2a4060',
                    fontFamily: "'DM Mono',monospace", fontWeight: 700, textAlign: 'right',
                    flexShrink: 0,
                  }}>
                    {rankLabel}
                  </div>

                  {/* Logo */}
                  <div style={{
                    width: 44, height: 44, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl(team.abbr)}
                      alt={team.abbr}
                      width={44}
                      height={44}
                      style={{ objectFit: 'contain' }}
                    />
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#e8f4ff',
                      fontFamily: "'Barlow Condensed',sans-serif", lineHeight: 1.2 }}>
                      {team.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#4a6a88',
                      fontFamily: "'DM Mono',monospace", marginTop: 2 }}>
                      {recordStr}{pts ? ` · ${pts}` : ''}
                    </div>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #0d1825',
                  paddingTop: 10 }}>
                  {/* WAR */}
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      fontSize: 20, fontWeight: 900, lineHeight: 1,
                      color: team.war > 30 ? '#00e5a0' : team.war > 15 ? '#f0c040' : team.war > 0 ? '#f08040' : '#e05050',
                      fontFamily: "'Barlow Condensed',sans-serif",
                    }}>
                      {team.war > 0 ? `+${team.war}` : team.war}
                    </div>
                    <div style={{ fontSize: 9, color: '#3a5a78', marginTop: 2,
                      fontFamily: "'DM Mono',monospace", textTransform: 'uppercase',
                      letterSpacing: '0.06em' }}>
                      Total WAR
                    </div>
                  </div>

                  <div style={{ width: 1, background: '#0d1825' }} />

                  {/* Avg rating */}
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{
                      fontSize: 20, fontWeight: 900, lineHeight: 1,
                      color: team.avgRating != null ? pctColor(team.avgRating) : '#2a4060',
                      fontFamily: "'Barlow Condensed',sans-serif",
                    }}>
                      {team.avgRating ?? '—'}
                    </div>
                    <div style={{ fontSize: 9, color: '#3a5a78', marginTop: 2,
                      fontFamily: "'DM Mono',monospace", textTransform: 'uppercase',
                      letterSpacing: '0.06em' }}>
                      Avg Rating
                    </div>
                  </div>

                  <div style={{ width: 1, background: '#0d1825' }} />

                  {/* Player count */}
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 900, lineHeight: 1,
                      color: '#5a7a99', fontFamily: "'Barlow Condensed',sans-serif" }}>
                      {team.playerCount}
                    </div>
                    <div style={{ fontSize: 9, color: '#3a5a78', marginTop: 2,
                      fontFamily: "'DM Mono',monospace", textTransform: 'uppercase',
                      letterSpacing: '0.06em' }}>
                      Players
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        <div style={{ marginTop: 32, fontSize: 10, color: '#1e3348',
          fontFamily: "'DM Mono',monospace", textAlign: 'center' }}>
          Data: NHL API · Natural Stat Trick · Evolving-Hockey · TopDownHockey
        </div>
      </div>
    </div>
  );
}
