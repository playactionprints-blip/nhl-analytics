import { BreadcrumbSetter } from "@/Breadcrumbs";
import App from "@/PlayerCard";
import { fetchPlayerCardPageData } from "@/app/lib/playerCardPageData";

export const revalidate = 0;

export const metadata = {
  title: "Players — NHL Analytics",
  description: "Search player cards, WAR leaders, percentile rankings, and deep player profiles.",
};

export default async function PlayersPage() {
  const { players, seasonStats, defaultSearchPlayers } = await fetchPlayerCardPageData();

  return (
    <>
      <BreadcrumbSetter items={[{ href: "/players", label: "Players" }]} />
      <App players={players} seasonStats={seasonStats} defaultSearchPlayers={defaultSearchPlayers} />
    </>
  );
}

