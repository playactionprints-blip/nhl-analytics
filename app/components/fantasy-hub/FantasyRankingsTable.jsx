/**
 * Scoring-aware fantasy rankings table.
 * Depends on fantasy settings, current player pool, and schedule-derived games
 * in span to produce sortable rankings tailored to the user's league.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { logoUrl } from "@/app/lib/nhlTeams";
import { buildRankedPlayers, formatFantasyValue } from "@/app/components/fantasy-hub/fantasyHubUtils";

const SORTABLE_COLUMNS = [
  { key: "projectedFantasyPoints", label: "Fantasy Value" },
  { key: "projectedGoals", label: "Proj Goals" },
  { key: "projectedAssists", label: "Proj Assists" },
  { key: "projectedShots", label: "Proj Shots" },
  { key: "projectedHits", label: "Proj Hits" },
  { key: "projectedBlocks", label: "Proj Blocks" },
  { key: "projectedSaves", label: "Proj Saves" },
  { key: "projectedWins", label: "Proj Wins" },
  { key: "projectedGames", label: "Proj Games" },
];

function formatProjectedCell(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(digits);
}

function recomputeDisplayedFantasyPoints(projection, state) {
  if (state.settings.leagueType === "categories") return null;
  if (String(projection.position).toUpperCase() === "G") {
    const total =
      (Number(projection.projectedWins) || 0) * Number(state.settings.goalieWeights.wins || 0) +
      (Number(projection.projectedSaves) || 0) * Number(state.settings.goalieWeights.saves || 0);
    return total || null;
  }

  const total =
    (Number(projection.projectedGoals) || 0) * Number(state.settings.skaterWeights.goals || 0) +
    (Number(projection.projectedAssists) || 0) * Number(state.settings.skaterWeights.assists || 0) +
    (Number(projection.projectedShots) || 0) * Number(state.settings.skaterWeights.shots || 0) +
    (Number(projection.projectedHits) || 0) * Number(state.settings.skaterWeights.hits || 0) +
    (Number(projection.projectedBlocks) || 0) * Number(state.settings.skaterWeights.blocks || 0);
  return total || null;
}

export default function FantasyRankingsTable({ players, state, timeframe, filters, scheduleData }) {
  const [sortKey, setSortKey] = useState("projectedFantasyPoints");
  const [sortDir, setSortDir] = useState("desc");

  const ranked = useMemo(() => {
    const base = buildRankedPlayers(players, state, timeframe, filters, scheduleData);
    const direction = sortDir === "asc" ? 1 : -1;
    return [...base].sort((left, right) => {
      const a = Number(left[sortKey] ?? left.projectedFantasyPoints ?? 0);
      const b = Number(right[sortKey] ?? right.projectedFantasyPoints ?? 0);
      if (a === b) return String(left.player_name).localeCompare(String(right.player_name));
      return (a - b) * direction;
    });
  }, [filters, players, scheduleData, sortDir, sortKey, state, timeframe]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !ranked.length) return;
    const samples = ranked.slice(0, 20).map((projection) => {
      const source = players.find((player) => String(player.player_id) === String(projection.player_id));
      const recomputedDisplayed = recomputeDisplayedFantasyPoints(projection, state);
      return {
        player: projection.player_name,
        timeframe,
        rawSource: source,
        normalizedProjection: {
          projectedFantasyPoints: projection.projectedFantasyPoints,
          projectedGames: projection.projectedGames,
          projectedGoals: projection.projectedGoals,
          projectedAssists: projection.projectedAssists,
          projectedShots: projection.projectedShots,
          projectedHits: projection.projectedHits,
          projectedBlocks: projection.projectedBlocks,
          projectedSaves: projection.projectedSaves,
          projectedWins: projection.projectedWins,
          projectionValid: projection.projectionValid,
          projectionWarnings: projection.projectionWarnings,
          usedFallbackLogic: projection.usedFallbackLogic,
        },
        projectedFantasyPointsFromSource: projection.projectedFantasyPoints,
        projectedFantasyPointsFromDisplayedCategories: recomputedDisplayed,
        projectedFantasyPointInputs:
          String(projection.position).toUpperCase() === "G"
            ? {
                projectedWins: projection.projectedWins,
                projectedSaves: projection.projectedSaves,
                projectedGoalsAgainst: projection.projectedGoalsAgainst,
                projectedShutouts: projection.projectedShutouts,
              }
            : {
                projectedGoals: projection.projectedGoals,
                projectedAssists: projection.projectedAssists,
                projectedShots: projection.projectedShots,
                projectedHits: projection.projectedHits,
                projectedBlocks: projection.projectedBlocks,
                projectedPowerPlayPoints: projection.projectedPowerPlayPoints,
              },
        renderedRow: {
          projectedFantasyPoints: formatFantasyValue(projection.projectedFantasyPoints),
          projectedGames: formatProjectedCell(projection.projectedGames, 0),
          projectedGoals: formatProjectedCell(projection.projectedGoals),
          projectedAssists: formatProjectedCell(projection.projectedAssists),
          projectedShots: formatProjectedCell(projection.projectedShots),
          projectedHits: formatProjectedCell(projection.projectedHits),
          projectedBlocks: formatProjectedCell(projection.projectedBlocks),
          projectedSaves: formatProjectedCell(projection.projectedSaves),
          projectedWins: formatProjectedCell(projection.projectedWins),
        },
      };
    });
    console.debug("[FantasyRankingsTable] top 20 ranked projection rows", samples);
  }, [players, ranked, state, timeframe]);

  function toggleSort(nextKey) {
    if (sortKey === nextKey) {
      setSortDir((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir("desc");
  }

  const tableLabel = state.settings.leagueType === "categories" ? "Category Value" : "Projected FP";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#6caede", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Custom Rankings
          </div>
          <div style={{ color: "#eff8ff", fontSize: 26, fontWeight: 900, marginTop: 4 }}>
            {ranked.length} players
          </div>
        </div>
        <div style={{ color: "#7d95ab", fontSize: 12 }}>
          Rankings update automatically from your scoring settings and selected timeframe.
        </div>
      </div>

      <div className="fantasy-rankings-shell" style={{ borderRadius: 22, border: "1px solid #17283b", background: "#091017", overflow: "hidden" }}>
        <div className="fantasy-rankings-head" style={{ display: "grid", gridTemplateColumns: "56px minmax(220px, 1.3fr) 90px repeat(8, minmax(64px, 1fr))", gap: 10, padding: "12px 16px", borderBottom: "1px solid #142433", color: "#62809d", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <div>Rank</div>
          <div>Player</div>
          <button type="button" onClick={() => toggleSort("projectedFantasyPoints")} style={{ all: "unset", cursor: "pointer" }}>{tableLabel}</button>
          {SORTABLE_COLUMNS.filter((column) => column.key !== "projectedFantasyPoints").map(({ key, label }) => (
            <button key={key} type="button" onClick={() => toggleSort(key)} style={{ all: "unset", cursor: "pointer", textAlign: "right" }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "grid" }}>
          {ranked.slice(0, 200).map((player, index) => (
            <div
              key={player.player_id}
              className="fantasy-rankings-row"
              style={{
                display: "grid",
                gridTemplateColumns: "56px minmax(220px, 1.3fr) 90px repeat(8, minmax(64px, 1fr))",
                gap: 10,
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: "1px solid #111b28",
              }}
            >
              <div style={{ color: "#9dc5e6", fontSize: 15, fontWeight: 800 }}>{index + 1}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoUrl(player.team)}
                  alt={player.team}
                  width={28}
                  height={28}
                  style={{ width: 28, height: 28, objectFit: "contain" }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#eff8ff", fontSize: 15, fontWeight: 800 }}>{player.player_name}</div>
                  <div style={{ color: "#67849e", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                    {player.team} · {player.position} {player.isRostered ? "· rostered" : ""}
                  </div>
                </div>
              </div>
              <div style={{ color: "#8fd6ff", fontSize: 15, fontWeight: 900, textAlign: "right" }}>{formatFantasyValue(player.projectedFantasyPoints)}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{formatProjectedCell(player.projectedGoals)}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{formatProjectedCell(player.projectedAssists)}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{formatProjectedCell(player.projectedShots)}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{formatProjectedCell(player.projectedHits)}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{formatProjectedCell(player.projectedBlocks)}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{formatProjectedCell(player.projectedSaves)}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{formatProjectedCell(player.projectedWins)}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{formatProjectedCell(player.projectedGames, 0)}</div>
            </div>
          ))}
          {!ranked.length ? (
            <div style={{ padding: "22px 16px", color: "#718aa3", fontSize: 14 }}>
              No players match the current filters.
            </div>
          ) : null}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .fantasy-rankings-head {
            display: none !important;
          }
          .fantasy-rankings-row {
            grid-template-columns: 1fr !important;
            gap: 8px !important;
            padding: 14px 16px !important;
          }
        }
      `}</style>
    </div>
  );
}
