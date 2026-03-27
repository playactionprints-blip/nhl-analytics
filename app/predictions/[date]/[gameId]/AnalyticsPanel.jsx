"use client";

import WinProbabilityChart from "./WinProbabilityChart";

function ratioPct(numerator, denominator) {
  if (!denominator) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export default function AnalyticsPanel({
  analytics,
  deserved,
  teamGameStats = [],
  homeAbbr,
  awayAbbr,
  homeColor,
  awayColor,
  loading,
  error,
}) {
  const statMap = Object.fromEntries((teamGameStats || []).map((row) => [row.category, row]));
  const awayShots = Number(statMap.sog?.awayValue) || 0;
  const homeShots = Number(statMap.sog?.homeValue) || 0;
  const totalXg = (analytics?.totalHomeXG || 0) + (analytics?.totalAwayXG || 0);
  const hasAnalytics = analytics && !error && !loading;

  return (
    <div
      style={{
        borderRadius: 28,
        border: "1px solid #16283a",
        background: "#0a121c",
        padding: "22px",
        display: "grid",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Game Analytics
          </div>
          <div style={{ color: "var(--text-primary)", fontSize: 30, fontWeight: 900, marginTop: 4 }}>Single-game flow and chance quality</div>
        </div>
        <div style={{ color: "#7c95ac", fontSize: 13, maxWidth: 360, lineHeight: 1.5 }}>
          Win probability, chance quality, and shot-driven flow are derived from gamecenter play-by-play and refreshed into a single postgame view.
        </div>
      </div>

      <div className="analytics-panel-grid">
        <div style={{ borderRadius: 22, border: "1px solid #142638", background: "#08111a", padding: "18px" }}>
          <WinProbabilityChart
            timeline={analytics?.winProbTimeline}
            homeAbbr={homeAbbr}
            awayAbbr={awayAbbr}
            homeColor={homeColor}
            awayColor={awayColor}
            loading={loading}
            error={error}
          />
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div className="analytics-mini-grid">
            {[
              {
                label: `${awayAbbr} xG share`,
                value: hasAnalytics && totalXg > 0 ? ratioPct(analytics.totalAwayXG, totalXg) : "—",
                tone: awayColor,
              },
              {
                label: `${homeAbbr} xG share`,
                value: hasAnalytics && totalXg > 0 ? ratioPct(analytics.totalHomeXG, totalXg) : "—",
                tone: homeColor,
              },
              {
                label: "Deserved to win",
                value: deserved ? `${deserved.home >= deserved.away ? homeAbbr : awayAbbr} ${(Math.max(deserved.home, deserved.away) * 100).toFixed(1)}%` : "—",
                tone: "#9fd8ff",
              },
              {
                label: "Shot volume",
                value: awayShots || homeShots ? `${awayShots}-${homeShots}` : "—",
                tone: "#d8e9f7",
              },
            ].map((card) => (
              <div key={card.label} style={{ borderRadius: 18, border: "1px solid #16283a", background: "#0d1620", padding: "14px 16px", display: "grid", gap: 8 }}>
                <div style={{ color: "#748ea6", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>{card.label}</div>
                <div style={{ color: card.tone, fontSize: 22, fontWeight: 900 }}>{card.value}</div>
              </div>
            ))}
          </div>

          <div
            style={{
              borderRadius: 18,
              border: "1px solid #16283a",
              background: "#0d1620",
              padding: "16px 18px",
              color: "#8ea7bf",
              lineHeight: 1.6,
              minHeight: 120,
            }}
          >
            {loading ? (
              <div style={{ color: "#8ea7bf", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>Loading postgame analytics…</div>
            ) : error ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 18 }}>Game analytics are temporarily unavailable</div>
                <div>
                  The play-by-play layer did not load for this game, so advanced flow visuals like win probability and shot-quality breakdowns are unavailable right now.
                </div>
              </div>
            ) : !hasAnalytics || totalXg < 0.01 ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 18 }}>Limited postgame event data</div>
                <div>
                  This game does not currently have enough shot-level data to render the full analytics suite, but the scoring summary and team comparison panels below are still available.
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 18 }}>What shaped this game</div>
                <div>
                  {homeAbbr} finished with {analytics.totalHomeXG.toFixed(2)} xG on {homeShots || "—"} shots, while {awayAbbr} generated {analytics.totalAwayXG.toFixed(2)} xG on {awayShots || "—"} shots.
                  {deserved ? ` Shot-quality replaying slightly favored ${deserved.home >= deserved.away ? homeAbbr : awayAbbr}.` : ""}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .analytics-panel-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.85fr);
          gap: 16px;
        }
        .analytics-mini-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 980px) {
          .analytics-panel-grid,
          .analytics-mini-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

