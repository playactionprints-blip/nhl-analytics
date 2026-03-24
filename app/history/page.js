import { createServerClient } from "@/app/lib/supabase";
import HistoryPageClient from "./HistoryPageClient";

export const revalidate = 300;

export const metadata = {
  title: "Historical Player Cards — NHL Analytics",
  description: "Explore career trajectories and season-by-season stats for NHL players.",
};

export default async function HistoryPage() {
  const supabase = createServerClient();

  const { data: players } = await supabase
    .from("players")
    .select("player_id, full_name, position, team")
    .neq("position", "G")
    .order("full_name");

  return <HistoryPageClient players={players || []} />;
}
