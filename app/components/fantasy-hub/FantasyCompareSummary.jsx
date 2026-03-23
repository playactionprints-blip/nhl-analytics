/**
 * High-level verdict summary for the Fantasy Hub compare tab.
 * Depends on already-computed compare projections across multiple timeframes.
 */
import { logoUrl } from "@/app/lib/nhlTeams";

function SummaryCard({ label, player, value, accent = "#2fb4ff" }) {
  if (!player) return null;
  return (
    <div
      style={{
        borderRadius: 18,
        border: `1px solid ${accent}33`,
        background: "linear-gradient(180deg, rgba(13,22,32,0.96) 0%, rgba(8,14,21,0.98) 100%)",
        padding: "14px 14px 12px",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ color: "#7d95ab", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl(player.team)}
          alt={player.team}
          width={26}
          height={26}
          style={{ width: 26, height: 26, objectFit: "contain" }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "#eff8ff", fontSize: 14, fontWeight: 900 }}>{player.player_name}</div>
          <div style={{ color: "#89d4ff", fontSize: 12, fontWeight: 700 }}>{value}</div>
        </div>
      </div>
    </div>
  );
}

export default function FantasyCompareSummary({ summary }) {
  return (
    <section style={{ display: "grid", gap: 12 }}>
      <div>
        <div style={{ color: "#6caede", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Edge Summary
        </div>
        <div style={{ color: "#eff8ff", fontSize: 26, fontWeight: 900, marginTop: 4 }}>
          Who wins in your format?
        </div>
      </div>

      <div className="fantasy-compare-summary-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <SummaryCard label="Best Next 7 Days" player={summary.best7d?.player} value={summary.best7d?.value} accent="#2fb4ff" />
        <SummaryCard label="Best Next 14 Days" player={summary.best14d?.player} value={summary.best14d?.value} accent="#42d7a1" />
        <SummaryCard label="Best Rest of Season" player={summary.bestRos?.player} value={summary.bestRos?.value} accent="#f7b733" />
        <SummaryCard label="Best Schedule" player={summary.bestSchedule?.player} value={summary.bestSchedule?.value} accent="#ff6c7c" />
      </div>

      <div
        style={{
          borderRadius: 18,
          border: "1px solid #17344a",
          background: "#091017",
          padding: "14px 16px",
          display: "grid",
          gap: 6,
        }}
      >
        <div style={{ color: "#eff8ff", fontSize: 16, fontWeight: 900 }}>
          Best fit for your settings: {summary.bestFit?.player?.player_name || "—"}
        </div>
        <div style={{ color: "#86a5c0", fontSize: 13, lineHeight: 1.5 }}>
          {summary.bestFit?.note || "Adjust the timeframe or add more players to compare short-term versus long-term value."}
        </div>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .fantasy-compare-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 640px) {
          .fantasy-compare-summary-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
