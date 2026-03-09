import { createClient } from '@supabase/supabase-js';
import App from '../PlayerCard';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function Home() {
  const { data: players } = await supabase
    .from('players')
    .select('*')
    .order('pts', { ascending: false })
    .limit(25);

  const safePlayers = (players || []).map(p => ({
    ...p,
    percentiles: p.percentiles || {},
    warTrend: p.warTrend || [],
    teamColor: p.teamColor || '#4a6a88',
    initials: `${(p.first_name||'?')[0]}${(p.last_name||'?')[0]}`,
    name: p.full_name,
    firstName: p.first_name,
    lastName: p.last_name,
  }));

  return <App players={safePlayers} />;
}
