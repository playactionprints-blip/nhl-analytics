import { createServerClient } from "@/app/lib/supabase";
import HistoryPageClient from "./HistoryPageClient";

export const revalidate = 3600;

export const metadata = {
  title: "Historical Player Cards — NHL Analytics",
  description: "Explore career trajectories and season-by-season stats for NHL players.",
};

async function fetchPlayerName(playerId) {
  try {
    const r = await fetch(
      `https://api-web.nhle.com/v1/player/${playerId}/landing`,
      { next: { revalidate: 86400 } }
    );
    if (!r.ok) return null;
    const d = await r.json();
    const first = d.firstName?.default || "";
    const last = d.lastName?.default || "";
    const name = `${first} ${last}`.trim();
    if (!name) return null;
    return {
      player_id: playerId,
      full_name: name,
      position: d.position || "?",
      team: "Retired",
    };
  } catch {
    return null;
  }
}

export default async function HistoryPage() {
  const supabase = createServerClient();

  // Step 1: Active players from players table
  const { data: activePlayers } = await supabase
    .from("players")
    .select("player_id, full_name, position, team")
    .neq("position", "G")
    .order("full_name");

  // Step 2: All player_ids in career_stats
  const { data: careerIds } = await supabase
    .from("career_stats")
    .select("player_id");

  const activeIds = new Set((activePlayers || []).map((p) => p.player_id));
  const retiredIds = [
    ...new Set((careerIds || []).map((r) => r.player_id)),
  ].filter((id) => !activeIds.has(id));

  // Step 3: Fetch names for retired players from NHL API (10 at a time)
  const retiredPlayers = [];
  for (let i = 0; i < retiredIds.length; i += 10) {
    const batch = retiredIds.slice(i, i + 10);
    const results = await Promise.all(batch.map(fetchPlayerName));
    retiredPlayers.push(...results.filter(Boolean));
  }

  // Step 4: Combine and sort
  const allPlayers = [...(activePlayers || []), ...retiredPlayers].sort((a, b) =>
    a.full_name.localeCompare(b.full_name)
  );

  return <HistoryPageClient players={allPlayers} />;
}
