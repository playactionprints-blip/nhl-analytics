/**
 * Canonical player page used primarily for SEO metadata and share previews.
 * Depends on the shared player data loader and does not change existing
 * player-card UI flows elsewhere in the application.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchPlayerPayload } from "@/app/lib/playerData";
import { getSiteUrl } from "@/app/lib/siteUrl";
import ShareButton from "./ShareButton";

function currentSeasonLabel() {
  return "25-26";
}

export async function generateMetadata({ params }) {
  const { playerId } = await params;
  const player = await fetchPlayerPayload(playerId);
  if (!player) return {};

  const siteUrl = getSiteUrl();
  const pageUrl = `${siteUrl}/players/${playerId}`;
  const pts = player.currentSeason?.pts ?? 0;
  const war3yr = player.war?.war3yr != null ? player.war.war3yr.toFixed(2) : "—";
  const overall = player.ratings?.overall != null ? Math.round(player.ratings.overall) : "—";
  const description = `#${player.jersey ?? "—"} · ${player.position ?? "—"} · ${player.team} | ${currentSeasonLabel()} ${pts} PTS · ${war3yr} 3Y WAR · ${overall} OVR`;

  return {
    title: `${player.name} · NHL Analytics`,
    description,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title: `${player.name} · NHL Analytics`,
      description,
      url: pageUrl,
      images: [`${siteUrl}/api/og/player?id=${player.id}`],
    },
  };
}

export default async function PlayerPage({ params }) {
  const { playerId } = await params;
  const player = await fetchPlayerPayload(playerId);
  if (!player) notFound();

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>{player.name}</h1>
      <p>
        {player.team} · #{player.jersey ?? "—"} · {player.position ?? "—"}
      </p>
      <p>Current season points: {player.currentSeason?.pts ?? 0}</p>
      <p>3Y WAR: {player.war?.war3yr != null ? player.war.war3yr.toFixed(2) : "—"}</p>
      <p>Overall rating: {player.ratings?.overall != null ? Math.round(player.ratings.overall) : "—"}</p>
      <p style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link href="/">Back to player cards</Link>
        <ShareButton playerId={playerId} />
      </p>
    </main>
  );
}
