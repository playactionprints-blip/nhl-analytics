import { createServerClient } from "@/app/lib/supabase";
import HistoryPageClient from "./HistoryPageClient";

export const revalidate = 86400;

export const metadata = {
  title: "Historical Player Cards — NHL Analytics",
  description: "Explore career trajectories and season-by-season stats for NHL players.",
};

export default async function HistoryPage() {
  const supabase = createServerClient();

  const { data: allPlayers } = await supabase
    .from("player_names")
    .select("player_id, full_name, position, is_active")
    .order("full_name");

  return <HistoryPageClient players={allPlayers || []} />;
}
