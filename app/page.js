import { createClient } from '@supabase/supabase-js';
import App from '../PlayerCard';

export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function Home() {
  // Fetch all players in batches (Supabase limits to 1000 per request)
  const { data: players, error } = await supabase
    .from('players')
    .select('*')
    .order('pts', { ascending: false, nullsFirst: false })
    .limit(1000);

  const safePlayers = (players || []).map(p => ({
    ...p,
    percentiles: p.percentiles || {},
    warTrend: p.warTrend || [],
    teamColor: TEAM_COLOR[p.team] || '#4a6a88',
    initials: `${(p.first_name||'?')[0]}${(p.last_name||'?')[0]}`,
    name: p.full_name,
    firstName: p.first_name,
    lastName: p.last_name,
  }));

  return <App players={safePlayers} />;
}

const TEAM_COLOR = {
  ANA:"#F47A38",ARI:"#8C2633",BOS:"#FFB81C",BUF:"#003087",CAR:"#CC0000",
  CBJ:"#002654",CGY:"#C8102E",CHI:"#CF0A2C",COL:"#6F263D",DAL:"#006847",
  DET:"#CE1126",EDM:"#FF4C00",FLA:"#C8102E",LAK:"#111111",MIN:"#154734",
  MTL:"#AF1E2D",NSH:"#FFB81C",NJD:"#CC0000",NYI:"#00539B",NYR:"#0038A8",
  OTT:"#C52032",PHI:"#F74902",PIT:"#CFC493",SEA:"#99D9D9",SJS:"#006D75",
  STL:"#002F87",TBL:"#002868",TOR:"#00205B",UTA:"#69B3E7",VAN:"#00843D",
  VGK:"#B4975A",WPG:"#041E42",WSH:"#C8102E",
};
