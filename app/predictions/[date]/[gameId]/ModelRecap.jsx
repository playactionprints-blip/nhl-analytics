function signedOdds(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value > 0 ? `+${value}` : `${value}`;
}

function pct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export default function ModelRecap({ recap, awayColor, homeColor, awayAbbr, homeAbbr, compact = false }) {
  if (!recap) {
    return (
      <div
        style={{
          borderRadius: 24,
          border: "1px solid #16283a",
          background: "#0a121c",
          padding: "20px 22px",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Model
        </div>
        <div style={{ color: "var(--text-primary)", fontSize: 22, fontWeight: 900 }}>Pregame model recap not captured</div>
        <div style={{ color: "#88a3bb", lineHeight: 1.6, fontSize: 14 }}>
          This game doesn’t have a stored pregame snapshot in the model log, so market-vs-model review is unavailable here. The rest of the postgame report still reflects live gamecenter and play-by-play data.
        </div>
      </div>
    );
  }

  const accuracyTone = recap.wasCorrect == null
    ? { color: "#8eb9db", bg: "rgba(47,180,255,0.12)", label: "Pending" }
    : recap.wasCorrect
      ? { color: "#35e3a0", bg: "rgba(53,227,160,0.14)", label: "Model correct" }
      : { color: "#ff8d9b", bg: "rgba(255,111,123,0.14)", label: "Model missed" };

  return (
    <div
      style={{
        borderRadius: 24,
        border: "1px solid #16283a",
        background: "#0a121c",
        padding: compact ? "18px" : "22px",
        display: "grid",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Model
          </div>
          <div style={{ color: "var(--text-primary)", fontSize: compact ? 22 : 26, fontWeight: 900, marginTop: 4 }}>Pregame recap</div>
        </div>
        <div
          style={{
            borderRadius: 999,
            padding: "7px 11px",
            background: accuracyTone.bg,
            color: accuracyTone.color,
            fontSize: 11,
            fontFamily: "'DM Mono',monospace",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          {accuracyTone.label}
        </div>
      </div>

      <div className="model-recap-grid">
        {[
          {
            abbr: awayAbbr,
            color: awayColor,
            winPct: recap.awayWinProb,
            fairOdds: recap.fairAwayOdds,
            marketOdds: recap.marketAwayOdds,
            edge: recap.marketAwayEdge,
          },
          {
            abbr: homeAbbr,
            color: homeColor,
            winPct: recap.homeWinProb,
            fairOdds: recap.fairHomeOdds,
            marketOdds: recap.marketHomeOdds,
            edge: recap.marketHomeEdge,
          },
        ].map((side) => (
          <div key={side.abbr} style={{ borderRadius: 18, background: "var(--bg-card)", border: "1px solid var(--border-strong)", padding: "14px 16px", display: "grid", gap: 10 }}>
            <div style={{ color: side.color, fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
              {side.abbr}
            </div>
            <div style={{ color: "var(--text-primary)", fontSize: 30, fontWeight: 900 }}>{pct(side.winPct)}</div>
            <div className="model-mini-grid">
              {[
                ["Fair line", signedOdds(side.fairOdds)],
                ["Market line", signedOdds(side.marketOdds)],
                ["Edge", side.edge == null ? "—" : `${side.edge >= 0 ? "+" : ""}${(side.edge * 100).toFixed(1)} pts`],
              ].map(([label, value]) => (
                <div key={`${side.abbr}-${label}`} style={{ borderRadius: 14, background: "#101a25", border: "1px solid #1a3044", padding: "10px 12px" }}>
                  <div style={{ color: "#7189a1", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
                  <div style={{ color: label === "Edge" && side.edge != null ? (side.edge >= 0 ? "#35e3a0" : "#ff8d9b") : "var(--text-primary)", fontSize: 15, fontWeight: 800, marginTop: 6 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="model-mini-grid">
        {[
          ["Final result", recap.finalResult || "—"],
          ["Predicted winner", recap.predictedWinner || "—"],
          ["Confidence", recap.confidenceBand ? recap.confidenceBand.toUpperCase() : "—"],
          ["Simulations", recap.simulations != null ? recap.simulations.toLocaleString() : "Logged pregame"],
        ].map(([label, value]) => (
          <div key={label} style={{ borderRadius: 14, background: "var(--bg-card)", border: "1px solid var(--border-strong)", padding: "12px 14px" }}>
            <div style={{ color: "#7189a1", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
            <div style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800, marginTop: 6 }}>{value}</div>
          </div>
        ))}
      </div>

      <style>{`
        .model-recap-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .model-mini-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        @media (max-width: 980px) {
          .model-recap-grid,
          .model-mini-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
