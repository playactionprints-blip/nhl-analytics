"use client";

import { logoUrl } from "@/app/lib/nhlTeams";

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

export default function LeagueImpactMiniTable({ rows = [] }) {
  if (!rows.length) return null;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Most affected other teams
        </div>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((row) => (
          <div
            key={row.team}
            style={{
              display: "grid",
              gridTemplateColumns: "24px minmax(0,1fr) 58px 58px 56px",
              gap: 8,
              alignItems: "center",
              borderRadius: 12,
              padding: "8px 10px",
              border: "1px solid var(--border-strong)",
              background: "rgba(8,16,24,0.65)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl(row.team)} alt={row.team} width={20} height={20} style={{ width: 20, height: 20, objectFit: "contain" }} />
            <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.teamName}
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: 11, textAlign: "right", fontFamily: "'DM Mono',monospace" }}>{pct(row.awayWinPlayoffProbability)}</div>
            <div style={{ color: "var(--text-secondary)", fontSize: 11, textAlign: "right", fontFamily: "'DM Mono',monospace" }}>{pct(row.homeWinPlayoffProbability)}</div>
            <div style={{ color: row.maxSwing >= 0 ? "#35e3a0" : "#ff8d9b", fontSize: 11, textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>
              {row.maxSwing >= 0 ? "+" : ""}{(row.maxSwing * 100).toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
