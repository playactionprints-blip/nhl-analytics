/**
 * Dynamic player Open Graph image generator.
 * Depends on the shared player data loader and produces a server-side OG card
 * with player identity, team, and percentile stats.
 */
import { ImageResponse } from "next/og";
import { fetchPlayerPayload } from "@/app/lib/playerData";
import { TEAM_COLOR, TEAM_FULL } from "@/app/lib/nhlTeams";

export const runtime = "edge";

function hexToRgb(hex) {
  if (!hex || hex[0] !== "#") return "47,127,165";
  const h = hex.slice(1);
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return `${r},${g},${b}`;
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `${r},${g},${b}`;
  }
  return "47,127,165";
}

function pctColor(val) {
  if (val >= 85) return "#35e3a0";
  if (val >= 60) return "#2fb4ff";
  if (val >= 35) return "#f0c040";
  if (val >= 15) return "#ff8d9b";
  return "#3a4a5a";
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

    const teamColor = TEAM_COLOR[player.team] || "#2fb4ff";
    const pts = player.currentSeason?.pts ?? 0;
    const war = player.war?.war3yr != null ? player.war.war3yr.toFixed(2) : "—";
    const ptsPer82 =
      player.currentSeason?.pts != null && (player.currentSeason?.gp ?? 0) > 0
        ? Math.round((player.currentSeason.pts / player.currentSeason.gp) * 82)
        : "—";

    const evOff = Math.round(player.percentiles?.evOff ?? 0);
    const evDef = Math.round(player.percentiles?.evDef ?? 0);
    const pp = Math.round(player.percentiles?.pp ?? 0);
    const pk = Math.round(player.percentiles?.pk ?? 0);
    const warPct = Math.round(player.percentiles?.war ?? 0);
    const finishing = Math.round(player.raw?.finishing_pct ?? 0);

    const headshotUrl =
      player.headshotUrl ??
      `https://assets.nhle.com/mugs/nhl/20252026/${player.playerId}.png`;

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            background: "#060d14",
            fontFamily: "sans-serif",
          }}
        >
          {/* Left section */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              background: `linear-gradient(135deg, rgba(${hexToRgb(teamColor)},0.15) 0%, #0d1f30 50%)`,
            }}
          >
            {/* Team color top bar */}
            <div style={{ height: 6, width: "100%", background: teamColor, display: "flex" }} />

            {/* Header area */}
            <div style={{ padding: "32px 40px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Team badge */}
              <div
                style={{
                  display: "flex",
                  background: teamColor,
                  color: "#fff",
                  fontSize: 16,
                  fontWeight: 900,
                  padding: "4px 14px",
                  borderRadius: 6,
                  letterSpacing: 2,
                  width: "auto",
                  alignSelf: "flex-start",
                  textTransform: "uppercase",
                }}
              >
                {player.team}
              </div>

              {/* Player name */}
              <div
                style={{
                  fontSize: 64,
                  fontWeight: 900,
                  color: "#eff8ff",
                  lineHeight: 1,
                  letterSpacing: -1,
                  marginTop: 8,
                }}
              >
                {player.name}
              </div>

              {/* Meta */}
              <div
                style={{
                  fontSize: 20,
                  color: "#4a7fa5",
                  letterSpacing: 3,
                  textTransform: "uppercase",
                }}
              >
                #{player.jersey ?? "—"} · {player.position ?? "—"} · Age {player.age ?? "—"}
              </div>
            </div>

            {/* Three key metrics */}
            <div style={{ display: "flex", gap: 12, padding: "0 40px", marginTop: 4 }}>
              {[
                { label: "3Y WAR", value: war, color: teamColor },
                { label: "PTS", value: pts, color: "#eff8ff" },
                { label: "PTS/82", value: ptsPer82, color: "#eff8ff" },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 12,
                    padding: "14px 20px",
                    flex: 1,
                  }}
                >
                  <div style={{ fontSize: 13, color: "#5e7b98", letterSpacing: 2, textTransform: "uppercase" }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 40, fontWeight: 900, color, lineHeight: 1, marginTop: 6 }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* Percentile grid — 2 columns x 3 rows */}
            <div style={{ display: "flex", gap: 12, padding: "16px 40px 0", flex: 1 }}>
              {/* Left column */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                {[
                  { label: "EV Offence", val: evOff },
                  { label: "EV Defence", val: evDef },
                  { label: "Power Play", val: pp },
                ].map(({ label, val }) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderBottom: "1px solid #0d1f30",
                      paddingBottom: 6,
                    }}
                  >
                    <div style={{ fontSize: 14, color: "#7b98b2", letterSpacing: 1, textTransform: "uppercase" }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: pctColor(val) }}>{val}</div>
                  </div>
                ))}
              </div>
              {/* Right column */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                {[
                  { label: "Penalty Kill", val: pk },
                  { label: "Finishing", val: finishing },
                  { label: "WAR Rank", val: warPct },
                ].map(({ label, val }) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderBottom: "1px solid #0d1f30",
                      paddingBottom: 6,
                    }}
                  >
                    <div style={{ fontSize: 14, color: "#7b98b2", letterSpacing: 1, textTransform: "uppercase" }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: pctColor(val) }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer watermark */}
            <div style={{ padding: "12px 40px", display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, color: "#1e3347", letterSpacing: 2, textTransform: "uppercase" }}>
                NHL Analytics · hockeystats.dev
              </div>
              <div style={{ fontSize: 13, color: "#1e3347" }}>2025-26 Season</div>
            </div>
          </div>

          {/* Right section — headshot */}
          <div
            style={{
              width: 260,
              display: "flex",
              alignItems: "flex-end",
              background: `linear-gradient(180deg, rgba(${hexToRgb(teamColor)},0.08) 0%, #060d14 100%)`,
              borderLeft: `1px solid rgba(${hexToRgb(teamColor)},0.2)`,
              overflow: "hidden",
              position: "relative",
            }}
          >
            <img
              src={headshotUrl}
              width={260}
              height={320}
              style={{ objectFit: "cover", objectPosition: "top center" }}
            />
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    );
  } catch (error) {
    return new Response(error.message || "Failed to generate image", { status: 500 });
  }
}
