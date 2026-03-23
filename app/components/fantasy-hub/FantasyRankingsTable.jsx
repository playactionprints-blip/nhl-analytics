/**
 * Scoring-aware fantasy rankings table.
 * Depends on fantasy settings, current player pool, and schedule-derived games
 * in span to produce sortable rankings tailored to the user's league.
 */
"use client";

import { useMemo, useState } from "react";
import { logoUrl } from "@/app/lib/nhlTeams";
import { buildRankedPlayers, formatFantasyValue } from "@/app/components/fantasy-hub/fantasyHubUtils";

const SORTABLE_COLUMNS = {
  fantasyValue: "Fantasy Value",
  goals: "Goals",
  assists: "Assists",
  shots: "Shots",
  hits: "Hits",
  blocks: "Blocks",
  saves: "Saves",
  wins: "Wins",
  gamesInSpan: "Games",
};

export default function FantasyRankingsTable({ players, state, timeframe, filters, scheduleData }) {
  const [sortKey, setSortKey] = useState("fantasyValue");
  const [sortDir, setSortDir] = useState("desc");

  const ranked = useMemo(() => {
    const base = buildRankedPlayers(players, state, timeframe, filters, scheduleData);
    const direction = sortDir === "asc" ? 1 : -1;
    return [...base].sort((left, right) => {
      const a = Number(left[sortKey] ?? left.fantasyValue ?? 0);
      const b = Number(right[sortKey] ?? right.fantasyValue ?? 0);
      if (a === b) return String(left.player_name).localeCompare(String(right.player_name));
      return (a - b) * direction;
    });
  }, [filters, players, scheduleData, sortDir, sortKey, state, timeframe]);

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
          <button type="button" onClick={() => toggleSort("fantasyValue")} style={{ all: "unset", cursor: "pointer" }}>{tableLabel}</button>
          {Object.entries(SORTABLE_COLUMNS).filter(([key]) => key !== "fantasyValue").map(([key, label]) => (
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
              <div style={{ color: "#8fd6ff", fontSize: 15, fontWeight: 900, textAlign: "right" }}>{formatFantasyValue(player.fantasyValue)}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{player.goals}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{player.assists}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{player.shots}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{player.hits}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{player.blocks}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{player.saves}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{player.wins}</div>
              <div style={{ color: "#d4e5f3", fontSize: 13, textAlign: "right" }}>{player.gamesInSpan}</div>
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
