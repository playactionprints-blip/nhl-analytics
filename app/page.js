import { createClient } from '@supabase/supabase-js';
import PlayerCard from '../PlayerCard';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function Home() {
  const { data: players, error } = await supabase
    .from('players')
    .select('*')
    .limit(3);

  console.log('players:', players, 'error:', error);

  return <PlayerCard />;
}
