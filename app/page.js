import fs from 'fs';
import path from 'path';
import App from '../PlayerCard';

// ── Team metadata ────────────────────────────────────────────────────────────
const TEAM_FULL = {
  ANA: 'Anaheim Ducks',      ARI: 'Arizona Coyotes',    BOS: 'Boston Bruins',
  BUF: 'Buffalo Sabres',     CAR: 'Carolina Hurricanes', CBJ: 'Columbus Blue Jackets',
  CGY: 'Calgary Flames',     CHI: 'Chicago Blackhawks',  COL: 'Colorado Avalanche',
  DAL: 'Dallas Stars',       DET: 'Detroit Red Wings',   EDM: 'Edmonton Oilers',
  FLA: 'Florida Panthers',   LAK: 'Los Angeles Kings',   MIN: 'Minnesota Wild',
  MTL: 'Montreal Canadiens', NSH: 'Nashville Predators', NJD: 'New Jersey Devils',
  NYI: 'New York Islanders', NYR: 'New York Rangers',    OTT: 'Ottawa Senators',
  PHI: 'Philadelphia Flyers',PIT: 'Pittsburgh Penguins', SEA: 'Seattle Kraken',
  SJS: 'San Jose Sharks',    STL: 'St. Louis Blues',     TBL: 'Tampa Bay Lightning',
  TOR: 'Toronto Maple Leafs',UTA: 'Utah Hockey Club',    VAN: 'Vancouver Canucks',
  VGK: 'Vegas Golden Knights',WPG: 'Winnipeg Jets',      WSH: 'Washington Capitals',
};

const TEAM_COLOR = {
  ANA: '#F47A38', ARI: '#8C2633', BOS: '#FFB81C', BUF: '#003087',
  CAR: '#CC0000', CBJ: '#002654', CGY: '#C8102E', CHI: '#CF0A2C',
  COL: '#6F263D', DAL: '#006847', DET: '#CE1126', EDM: '#FF4C00',
  FLA: '#C8102E', LAK: '#111111', MIN: '#154734', MTL: '#AF1E2D',
  NSH: '#FFB81C', NJD: '#CC0000', NYI: '#00539B', NYR: '#0038A8',
  OTT: '#C52032', PHI: '#F74902', PIT: '#CFC493', SEA: '#99D9D9',
  SJS: '#006D75', STL: '#002F87', TBL: '#002868', TOR: '#00205B',
  UTA: '#69B3E7', VAN: '#00843D', VGK: '#B4975A', WPG: '#041E42',
  WSH: '#C8102E',
};

// ── CSV helpers ──────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let inQuotes = false;
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(content) {
  const lines = content.replace(/^\uFEFF/, '').trim().split('\n').filter(l => l.trim());
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
    return obj;
  });
}

function formatAvgTOI(totalMinutes, gp) {
  if (!gp || gp === 0) return '0:00';
  const avg = parseFloat(totalMinutes) / parseInt(gp);
  const mins = Math.floor(avg);
  const secs = Math.round((avg - mins) * 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ── Data loading ─────────────────────────────────────────────────────────────
export default async function Home() {
  const dataDir = path.join(process.cwd(), 'data-pipeline', 'data');

  const baseCsv    = fs.readFileSync(path.join(dataDir, 'players_merged.csv'),    'utf-8');
  const nstCsv     = fs.readFileSync(path.join(dataDir, 'nst_skaters.csv'),       'utf-8');
  const nstOniceCsv = fs.readFileSync(path.join(dataDir, 'nst_skaters_onice.csv'), 'utf-8');

  const baseRows     = parseCSV(baseCsv);
  const nstRows      = parseCSV(nstCsv);
  const nstOniceRows = parseCSV(nstOniceCsv);

  // Build NST lookups by lowercase player name
  const nstByName = {};
  nstRows.forEach(row => {
    const name = (row['Player'] || '').trim().toLowerCase();
    if (name) nstByName[name] = row;
  });

  const nstOniceByName = {};
  nstOniceRows.forEach(row => {
    const name = (row['Player'] || '').trim().toLowerCase();
    if (name) nstOniceByName[name] = row;
  });

  const players = baseRows.map(row => {
    const fullName  = (row['full_name'] || '').trim();
    const nst       = nstByName[fullName.toLowerCase()]      || {};
    const nstOnice  = nstOniceByName[fullName.toLowerCase()] || {};
    const gp        = parseInt(nst['GP']) || 0;
    const teamAbbr  = (row['team'] || '').trim();
    const firstName = (row['first_name'] || '').trim();
    const lastName  = (row['last_name']  || '').trim();

    return {
      id:         parseInt(row['player_id']),
      name:       fullName,
      firstName,
      lastName,
      number:     parseInt(row['jersey']) || 0,
      position:   row['position'] || '',
      team:       teamAbbr,
      teamFull:   TEAM_FULL[teamAbbr] || teamAbbr,
      teamColor:  TEAM_COLOR[teamAbbr] || '#4a6a88',
      teamColor2: TEAM_COLOR[teamAbbr] || '#4a6a88',
      nationality: null,
      headshotBg:  TEAM_COLOR[teamAbbr] || '#4a6a88',
      initials:    `${firstName[0] || ''}${lastName[0] || ''}`,
      // Core stats from NST
      gp,
      g:          parseInt(nst['Goals'])          || 0,
      a:          parseInt(nst['Total Assists'])   || 0,
      pts:        parseInt(nst['Total Points'])    || 0,
      plusMinus:  null,
      toi:        formatAvgTOI(nst['TOI'], gp),
      ppp:        null,
      shp:        null,
      // On-ice 5v5 rates from NST on-ice report
      cf_pct:   parseFloat(nstOnice['CF%'])    || null,
      xgf_pct:  parseFloat(nstOnice['xGF%'])   || null,
      hdcf_pct: parseFloat(nstOnice['HDCF%'])  || null,
      scf_pct:  parseFloat(nstOnice['SCF%'])   || null,
      war:       null,
      war_off:   null,
      war_def:   null,
      rapm_off:  null,
      rapm_def:  null,
      percentiles: {},
      warTrend:    [],
    };
  }).filter(p => p.gp > 0);

  // Sort by points descending, take top 25 for the selector
  players.sort((a, b) => b.pts - a.pts);

  return <App players={players.slice(0, 25)} />;
}
