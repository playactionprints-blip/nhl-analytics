/**
 * Side-by-side metric breakdown for compared fantasy players.
 * Depends on selected projections and supports an optional delta-focused view.
 */
"use client";

import { useMemo, useState } from "react";
import { formatFantasyValue } from "@/app/components/fantasy-hub/fantasyHubUtils";

function numberFormat(value, digits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return numeric.toFixed(digits);
}

function rowValue(metric, player) {
  if (metric.key === "fantasyValue") return formatFantasyValue(player.fantasyValue);
  if (metric.key === "savePct") return player.savePct != null ? `${(player.savePct * 100).toFixed(1)}%` : "—";
  if (metric.key === "gaa") return numberFormat(player.gaa, 2);
  return numberFormat(player[metric.key], metric.digits ?? 1);
}

export default function FantasyCompareBreakdown({ players }) {
  const [showDeltas, setShowDeltas] = useState(false);

  const metrics = useMemo(
    () => [
      { label: "Fantasy Value", key: "fantasyValue", digits: 1 },
      { label: "Games in Span", key: "gamesInSpan", digits: 0 },
      { label: "Off-Night Games", key: "offNightGames", digits: 0 },
      { label: "Projected Goals", key: "goalsProjection", digits: 1 },
      { label: "Projected Assists", key: "assistsProjection", digits: 1 },
      { label: "Projected Shots", key: "shotsProjection", digits: 1 },
      { label: "Projected Hits", key: "hitsProjection", digits: 1 },
      { label: "Projected Blocks", key: "blocksProjection", digits: 1 },
      { label: "Power-Play Production", key: "pppProjection", digits: 1 },
      { label: "Projected Wins", key: "winsProjection", digits: 1 },
      { label: "Projected Saves", key: "savesProjection", digits: 1 },
      { label: "Save %", key: "savePct", digits: 1 },
      { label: "GAA", key: "gaa", digits: 2 },
      { label: "Schedule Score", key: "scheduleScore", digits: 1 },
    ],
    []
  );

  function metricDelta(metric) {
    const values = players
      .map((player) => Number(player[metric.key] ?? (metric.key === "fantasyValue" ? player.fantasyValue : NaN)))
      .filter(Number.isFinite)
      .sort((a, b) => b - a);

    if (values.length < 2) return "—";
    const diff = values[0] - values[1];
    return `+${diff.toFixed(metric.digits ?? 1)}`;
  }

  function metricWinner(metric) {
    const candidates = [...players].sort((left, right) => {
      const a = Number(left[metric.key] ?? (metric.key === "fantasyValue" ? left.fantasyValue : NaN));
      const b = Number(right[metric.key] ?? (metric.key === "fantasyValue" ? right.fantasyValue : NaN));
      return (Number.isFinite(b) ? b : -Infinity) - (Number.isFinite(a) ? a : -Infinity);
    });
    return candidates[0]?.player_id;
  }

  return (
    <section
      style={{
        borderRadius: 22,
        border: "1px solid #17283b",
        background: "#091017",
        padding: "16px 16px 14px",
        display: "grid",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#6caede", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Side-by-Side Breakdown
          </div>
          <div style={{ color: "#eff8ff", fontSize: 22, fontWeight: 900, marginTop: 4 }}>
            Production, schedule, and category edges
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowDeltas((current) => !current)}
          style={{
            borderRadius: 999,
            border: `1px solid ${showDeltas ? "#2fb4ff" : "#213547"}`,
            background: showDeltas ? "rgba(47,180,255,0.14)" : "#0d1620",
            color: showDeltas ? "#d6f0ff" : "#8ca8c1",
            padding: "9px 12px",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: "'DM Mono',monospace",
            cursor: "pointer",
          }}
        >
          {showDeltas ? "Hide Deltas" : "Show Deltas"}
        </button>
      </div>

      <div className="fantasy-compare-breakdown-shell" style={{ overflowX: "auto" }}>
        <div style={{ minWidth: Math.max(520, 220 + players.length * 180) }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `220px repeat(${players.length}, minmax(0, 1fr))${showDeltas ? " 110px" : ""}`,
              gap: 10,
              padding: "0 0 8px",
              color: "#6f879f",
              fontSize: 10,
              fontFamily: "'DM Mono',monospace",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            <div>Metric</div>
            {players.map((player) => (
              <div key={player.player_id} style={{ textAlign: "right" }}>{player.player_name}</div>
            ))}
            {showDeltas ? <div style={{ textAlign: "right" }}>Delta</div> : null}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {metrics.map((metric) => {
              const winnerId = metricWinner(metric);
              return (
                <div
                  key={metric.key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: `220px repeat(${players.length}, minmax(0, 1fr))${showDeltas ? " 110px" : ""}`,
                    gap: 10,
                    alignItems: "center",
                    borderRadius: 14,
                    border: "1px solid #17283b",
                    background: "#0d1620",
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ color: "#dcecf9", fontSize: 13, fontWeight: 700 }}>{metric.label}</div>
                  {players.map((player) => {
                    const winner = String(winnerId) === String(player.player_id);
                    return (
                      <div
                        key={`${metric.key}-${player.player_id}`}
                        style={{
                          textAlign: "right",
                          color: winner ? "#8fd6ff" : "#e0edf8",
                          fontSize: 13,
                          fontWeight: winner ? 900 : 700,
                        }}
                      >
                        {rowValue(metric, player)}
                      </div>
                    );
                  })}
                  {showDeltas ? (
                    <div style={{ textAlign: "right", color: "#47e8aa", fontSize: 12, fontWeight: 800 }}>
                      {metricDelta(metric)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
