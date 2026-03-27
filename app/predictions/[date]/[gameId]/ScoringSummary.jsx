import { TEAM_COLOR } from "@/app/lib/nhlTeams";

function periodLabel(desc) {
  if (!desc) return "Period";
  if (desc.periodType === "OT") return "Overtime";
  if (desc.periodType === "SO") return "Shootout";
  const n = desc.number;
  return ["1st Period", "2nd Period", "3rd Period"][n - 1] ?? `Period ${n}`;
}

export default function ScoringSummary({ periods = [], compact = false }) {
  const rows = (periods || []).filter((period) => (period.goals?.length ?? 0) > 0);

  if (!rows.length) {
    return (
      <div
        style={{
          borderRadius: 24,
          border: "1px solid #16283a",
          background: "#0a121c",
          padding: "22px",
          color: "#6f879f",
          fontFamily: "'DM Mono',monospace",
          fontSize: 12,
        }}
      >
        No goals to summarize for this game.
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: 24,
        border: "1px solid #16283a",
        background: "#0a121c",
        padding: compact ? "18px" : "22px",
        display: "grid",
        gap: 14,
      }}
    >
      <div>
        <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Scoring
        </div>
        <div style={{ color: "var(--text-primary)", fontSize: compact ? 22 : 26, fontWeight: 900, marginTop: 4 }}>Scoring summary</div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {rows.map((period) => (
          <div key={period.periodDescriptor?.number ?? period.period} style={{ borderRadius: 18, background: "var(--bg-card)", border: "1px solid var(--border-strong)", padding: "14px 16px", display: "grid", gap: 10 }}>
            <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
              {periodLabel(period.periodDescriptor)}
            </div>
            {period.goals.map((goal, index) => {
              const teamColor = TEAM_COLOR[goal.teamAbbrev?.default] || "#4d82af";
              const assists = goal.assists || [];
              return (
                <div key={`${goal.eventId || index}-${goal.playerId || goal.name?.default}`} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ color: "#617e97", fontSize: 11, fontFamily: "'DM Mono',monospace", minWidth: 42, paddingTop: 3 }}>{goal.timeInPeriod}</div>
                  <div style={{ width: 3, borderRadius: 2, alignSelf: "stretch", minHeight: 26, background: teamColor }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <span style={{ color: teamColor, fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>{goal.teamAbbrev?.default}</span>
                      <span style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800 }}>{goal.name?.default}</span>
                      {goal.goalNumber != null ? (
                        <span style={{ color: "#6f879f", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>({goal.goalNumber})</span>
                      ) : null}
                      {goal.strength && goal.strength !== "EV" ? (
                        <span style={{ color: goal.strength === "PP" ? "#f0c040" : "#35e3a0", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                          {goal.strength}
                        </span>
                      ) : null}
                    </div>
                    {assists.length > 0 ? (
                      <div style={{ color: "#89a6be", fontSize: 12, marginTop: 4 }}>
                        Assists: {assists.map((assist) => assist.name?.default).filter(Boolean).join(", ")}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

