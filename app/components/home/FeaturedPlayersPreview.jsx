import Link from "next/link";
import { logoUrl } from "@/app/lib/nhlTeams";

export default function FeaturedPlayersPreview({ players = [] }) {
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ color: "#86a9c6", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Featured players
          </div>
          <h2 style={{ margin: 0, color: "#eef8ff", fontSize: 34, lineHeight: 1, fontWeight: 900 }}>
            Current WAR leaders
          </h2>
        </div>
        <Link
          href="/players"
          style={{
            color: "#dff3ff",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 800,
            borderRadius: 999,
            border: "1px solid #274663",
            padding: "10px 14px",
            background: "#0e1722",
          }}
        >
          View all players
        </Link>
      </div>

      <div
        style={{
          borderRadius: 26,
          border: "1px solid #18314a",
          background: "linear-gradient(180deg, rgba(13,20,30,0.98) 0%, rgba(8,13,21,0.98) 100%)",
          overflow: "hidden",
          boxShadow: "0 18px 40px rgba(0,0,0,0.18)",
        }}
      >
        {players.length ? players.map((player, index) => (
          <Link
            key={player.player_id}
            href={`/players/${player.player_id}`}
            className="featured-player-row"
            style={{
              textDecoration: "none",
              display: "grid",
              gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
              gap: 14,
              alignItems: "center",
              padding: "16px 18px",
              borderTop: index === 0 ? "none" : "1px solid #142637",
            }}
          >
            <div style={{ color: "#6a8aa7", fontSize: 12, fontFamily: "'DM Mono',monospace" }}>
              #{index + 1}
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
              <img src={logoUrl(player.team)} alt={player.team} style={{ width: 28, height: 28, objectFit: "contain", flexShrink: 0 }} />
              <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
                <div style={{ color: "#f0f8ff", fontSize: 18, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {player.full_name}
                </div>
                <div style={{ color: "#84a4be", fontSize: 13 }}>
                  {player.team} · {player.position || "—"} · {player.gp ?? "—"} GP
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#7baad2", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                WAR
              </div>
              <div style={{ color: "#eaf7ff", fontSize: 20, fontWeight: 900 }}>
                {player.war_total != null ? Number(player.war_total).toFixed(2) : "—"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#7baad2", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                OVR
              </div>
              <div style={{ color: "#2fb4ff", fontSize: 20, fontWeight: 900 }}>
                {player.overall_rating != null ? Math.round(player.overall_rating) : "—"}
              </div>
            </div>
          </Link>
        )) : (
          <div style={{ padding: 20, color: "#8ba7bf" }}>
            Player previews will appear here when current-season leaderboard data is available.
          </div>
        )}
      </div>
      <style>{`
        @media (max-width: 640px) {
          .featured-player-row {
            grid-template-columns: 1fr !important;
            gap: 10px !important;
          }
        }
      `}</style>
    </section>
  );
}
