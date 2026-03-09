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

  return <App players={players || []} />;
}
