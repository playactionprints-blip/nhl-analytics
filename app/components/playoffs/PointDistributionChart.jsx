"use client";

export default function PointDistributionChart({ bins = [] }) {
  if (!bins.length) {
    return (
      <div style={{ borderRadius: 14, border: "1px solid var(--border-strong)", background: "rgba(8,16,24,0.6)", padding: "12px 14px", color: "var(--text-muted)", fontSize: 12 }}>
        Point distribution is still building.
      </div>
    );
  }

  const maxProbability = Math.max(...bins.map((bin) => bin.probability || 0), 0.001);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {bins.map((bin) => (
        <div key={bin.label} style={{ display: "grid", gridTemplateColumns: "68px minmax(0, 1fr) 46px", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'DM Mono',monospace" }}>{bin.label}</div>
          <div style={{ height: 10, borderRadius: 999, background: "rgba(13,24,37,0.9)", overflow: "hidden" }}>
            <div
              style={{
                width: `${(bin.probability / maxProbability) * 100}%`,
                height: "100%",
                borderRadius: 999,
                background: "linear-gradient(90deg,#2fb4ff,#35e3a0)",
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", textAlign: "right", fontFamily: "'DM Mono',monospace" }}>
            {(bin.probability * 100).toFixed(0)}%
          </div>
        </div>
      ))}
    </div>
  );
}
