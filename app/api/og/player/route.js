/**
 * Dynamic player Open Graph image generator.
 * Depends on the shared player data loader and produces a server-side OG card
 * with player identity, team, and three key stats.
 */
import { ImageResponse } from "next/og";
import { fetchPlayerPayload } from "@/app/lib/playerData";
import { TEAM_COLOR, TEAM_FULL } from "@/app/lib/nhlTeams";

export const runtime = "edge";

function statPill(label, value, accent) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "18px 22px",
        borderRadius: 24,
        background: "rgba(255,255,255,0.06)",
        border: `1px solid ${accent}`,
        minWidth: 180,
      }}
    >
      <div style={{ color: "#8aa6bf", fontSize: 20, letterSpacing: 2, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: "#f5fbff", fontSize: 50, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get("id");
    if (!playerId) {
      return new Response("Missing id", { status: 400 });
    }

    const player = await fetchPlayerPayload(playerId);
    if (!player) {
      return new Response("Player not found", { status: 404 });
    }

    const accent = TEAM_COLOR[player.team] || "#2a6ca8";
    const currentSeasonPts = player.currentSeason?.pts ?? 0;
    const warValue = player.war?.war3yr != null ? player.war.war3yr.toFixed(2) : "—";
    const ovrValue = player.ratings?.overall != null ? Math.round(player.ratings.overall) : "—";

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            background: "#0a0f1a",
            color: "#f5fbff",
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ width: 28, height: "100%", background: accent }} />
          <div
            style={{
              flex: 1,
              display: "flex",
              justifyContent: "space-between",
              padding: "56px 60px",
              gap: 48,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, flex: 1 }}>
              <div style={{ color: accent, fontSize: 22, letterSpacing: 4, textTransform: "uppercase" }}>
                {TEAM_FULL[player.team] || player.team}
              </div>
              <div style={{ fontSize: 72, fontWeight: 900, lineHeight: 0.95 }}>{player.name}</div>
              <div style={{ color: "#91a8be", fontSize: 30 }}>
                #{player.jersey ?? "—"} · {player.position || "—"} · {player.team}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
              {statPill("PTS", currentSeasonPts, accent)}
              {statPill("3Y WAR", warValue, "#28c3ff")}
              {statPill("OVR", ovrValue, "#52d89b")}
            </div>
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  } catch (error) {
    return new Response(error.message || "Failed to generate image", { status: 500 });
  }
}
