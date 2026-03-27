/**
 * Compact context header for the Fantasy Hub.
 * Depends on the persisted fantasy league state and derived roster summary.
 */
import { formatFantasyValue } from "@/app/components/fantasy-hub/fantasyHubUtils";

export default function FantasyTeamContextBar({ state, summary }) {
  const leagueLabel = state.settings.leagueType === "categories" ? "Categories League" : "Points League";

  const stats = [
    { label: "League", value: leagueLabel },
    { label: "Rostered", value: `${summary.filledSpots}/${summary.totalSpots}` },
    { label: "Teams", value: summary.rosteredTeamCount || "—" },
    {
      label: state.settings.leagueType === "categories" ? "Team Value" : "Proj Value",
      value: formatFantasyValue(summary.projectedValue),
    },
  ];

  return (
    <section
      style={{
        borderRadius: 24,
        border: "1px solid var(--border-strong)",
        background: "linear-gradient(180deg, rgba(10,20,32,0.98) 0%, rgba(7,11,18,0.98) 100%)",
        padding: "18px 18px 16px",
        display: "grid",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Fantasy Hub
          </div>
          <div style={{ color: "var(--text-primary)", fontSize: 28, fontWeight: 900 }}>{state.teamName}</div>
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: 14, maxWidth: 620 }}>
          Customize league scoring, track your roster, and build rankings that reflect your format instead of one-size-fits-all stats.
        </div>
      </div>

      <div className="fantasy-context-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {stats.map((item) => (
          <div
            key={item.label}
            style={{
              borderRadius: 16,
              border: "1px solid var(--border-strong)",
              background: "var(--bg-card)",
              padding: "12px 12px 10px",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {item.label}
            </div>
            <div style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 900 }}>{item.value}</div>
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 860px) {
          .fantasy-context-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
        }
        @media (max-width: 520px) {
          .fantasy-context-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
