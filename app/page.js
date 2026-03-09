import { supabase } from './lib/supabase';
import PlayerCard from '../PlayerCard';

export default async function Home() {
  const { data: players } = await supabase
    .from('players')
    .select('*')
    .limit(3);

  return (
    <div>
      {players?.map(p => (
        <PlayerCard key={p.player_id} player={p} />
      ))}
    </div>
  );
}