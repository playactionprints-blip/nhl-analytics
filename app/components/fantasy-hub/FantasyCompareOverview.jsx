/**
 * Player overview cards for the Fantasy Hub compare tab.
 * Depends on selected compare projections plus derived verdict tags.
 */
import { logoUrl } from "@/app/lib/nhlTeams";
import { formatFantasyValue } from "@/app/components/fantasy-hub/fantasyHubUtils";

function badgeStyle(color, bg) {
  return {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "4px 9px",
    border: `1px solid ${color}33`,
    background: bg,
    color,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontFamily: "'DM Mono',monospace",
  };
}

export default function FantasyCompareOverview({ players, timeframeLabel, verdicts, leagueType }) {
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div>
        <div style={{ color: "#6caede", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Compare Overview
        </div>
        <div style={{ color: "#eff8ff", fontSize: 26, fontWeight: 900, marginTop: 4 }}>
          {timeframeLabel} snapshot
        </div>
      </div>

      <div className="fantasy-compare-overview-grid" style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(Math.max(players.length, 1), 4)}, minmax(0, 1fr))`, gap: 12 }}>
        {players.map((player) => {
          const tags = verdicts[player.player_id] || [];
          return (
            <div
              key={player.player_id}
              style={{
                borderRadius: 20,
                border: "1px solid #17344a",
                background: "linear-gradient(180deg, rgba(12,19,29,0.97) 0%, rgba(8,13,19,0.98) 100%)",
                padding: "16px 16px 14px",
                display: "grid",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl(player.team)}
                  alt={player.team}
                  width={34}
                  height={34}
                  style={{ width: 34, height: 34, objectFit: "contain" }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#eff8ff", fontSize: 16, fontWeight: 900 }}>{player.player_name}</div>
                  <div style={{ color: "#7d95ab", fontSize: 12 }}>
                    {player.team} · {player.position}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ color: "#7d95ab", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {leagueType === "categories" ? "Category Value" : "Projected Fantasy Points"}
                </div>
                <div style={{ color: "#8fd6ff", fontSize: 28, fontWeight: 900, lineHeight: 1 }}>
                  {formatFantasyValue(player.fantasyValue)}
                </div>
              </div>

              <div className="fantasy-compare-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <div style={{ borderRadius: 14, background: "#0d1620", border: "1px solid #17283b", padding: "10px 12px" }}>
                  <div style={{ color: "#6f879f", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Games
                  </div>
                  <div style={{ color: "#eff8ff", fontSize: 18, fontWeight: 900, marginTop: 4 }}>{player.gamesInSpan}</div>
                </div>
                <div style={{ borderRadius: 14, background: "#0d1620", border: "1px solid #17283b", padding: "10px 12px" }}>
                  <div style={{ color: "#6f879f", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Off-Nights
                  </div>
                  <div style={{ color: "#eff8ff", fontSize: 18, fontWeight: 900, marginTop: 4 }}>{player.offNightGames}</div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {tags.length ? tags.map((tag) => (
                  <span key={tag.label} style={badgeStyle(tag.color, tag.bg)}>
                    {tag.label}
                  </span>
                )) : (
                  <span style={badgeStyle("#7d95ab", "rgba(125,149,171,0.1)")}>Steady Fit</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .fantasy-compare-overview-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 720px) {
          .fantasy-compare-overview-grid,
          .fantasy-compare-kpis {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
