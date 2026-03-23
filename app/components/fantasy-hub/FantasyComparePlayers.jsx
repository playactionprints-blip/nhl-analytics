/**
 * Full compare-players experience for the Fantasy Hub.
 * Depends on the fantasy player pool, current scoring settings, and
 * schedule-aware ranking utilities to compare 2-4 players by timeframe.
 */
"use client";

import { useMemo, useState } from "react";
import {
  COMPARE_TIMEFRAME_OPTIONS,
} from "@/app/components/fantasy-hub/fantasyHubConfig";
import FantasyCompareBreakdown from "@/app/components/fantasy-hub/FantasyCompareBreakdown";
import FantasyCompareOverview from "@/app/components/fantasy-hub/FantasyCompareOverview";
import FantasyCompareSelector from "@/app/components/fantasy-hub/FantasyCompareSelector";
import FantasyCompareSummary from "@/app/components/fantasy-hub/FantasyCompareSummary";
import FantasyTimeframeSelector from "@/app/components/fantasy-hub/FantasyTimeframeSelector";
import { buildRankedPlayers, formatFantasyValue } from "@/app/components/fantasy-hub/fantasyHubUtils";

function bestPlayer(players, field = "fantasyValue") {
  if (!players.length) return null;
  return [...players].sort((left, right) => Number(right[field] ?? 0) - Number(left[field] ?? 0))[0];
}

function buildSummaryValue(player, field, formatter) {
  if (!player) return "—";
  return formatter(player[field], player);
}

function buildVerdictTags(selectedCurrent, selected7d, selectedRos) {
  const bestFitId = String(bestPlayer(selectedCurrent, "fantasyValue")?.player_id || "");
  const bestScheduleId = String(bestPlayer(selectedCurrent, "scheduleScore")?.player_id || "");
  const bestPeripheralsId = String(bestPlayer(selectedCurrent, "peripheralsValue")?.player_id || "");
  const bestUpsideId = String(bestPlayer(selectedCurrent, "scoringUpside")?.player_id || "");
  const bestShortId = String(bestPlayer(selected7d, "fantasyValue")?.player_id || "");
  const bestLongId = String(bestPlayer(selectedRos, "fantasyValue")?.player_id || "");

  const tags = {};
  selectedCurrent.forEach((player) => {
    const playerId = String(player.player_id);
    const next = [];
    if (playerId === bestFitId) next.push({ label: "Best Fit", color: "#8fd6ff", bg: "rgba(47,180,255,0.14)" });
    if (playerId === bestShortId) next.push({ label: "Best Short-Term", color: "#42d7a1", bg: "rgba(66,215,161,0.14)" });
    if (playerId === bestLongId) next.push({ label: "Best Long-Term", color: "#f7c14c", bg: "rgba(247,193,76,0.14)" });
    if (playerId === bestScheduleId) next.push({ label: "Best Schedule", color: "#ff7e8b", bg: "rgba(255,126,139,0.14)" });
    if (playerId === bestPeripheralsId) next.push({ label: "Best Peripherals", color: "#b18cff", bg: "rgba(177,140,255,0.14)" });
    if (playerId === bestUpsideId) next.push({ label: "Best Scoring Upside", color: "#ffd36d", bg: "rgba(255,211,109,0.14)" });
    tags[playerId] = next.slice(0, 2);
  });
  return tags;
}

export default function FantasyComparePlayers({ players, state, scheduleData }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState("");
  const [timeframe, setTimeframe] = useState("7d");

  const playerFilters = useMemo(
    () => ({ position: "ALL", team: "ALL", rosterState: "all" }),
    []
  );

  const rankingsByTimeframe = useMemo(
    () => ({
      today: buildRankedPlayers(players, state, "today", playerFilters, scheduleData),
      "this-week": buildRankedPlayers(players, state, "this-week", playerFilters, scheduleData),
      "7d": buildRankedPlayers(players, state, "7d", playerFilters, scheduleData),
      "14d": buildRankedPlayers(players, state, "14d", playerFilters, scheduleData),
      ros: buildRankedPlayers(players, state, "ros", playerFilters, scheduleData),
    }),
    [playerFilters, players, scheduleData, state]
  );

  const selectedCurrent = useMemo(() => {
    const currentMap = Object.fromEntries(
      rankingsByTimeframe[timeframe].map((player) => [String(player.player_id), player])
    );
    return selectedIds.map((id) => currentMap[String(id)]).filter(Boolean);
  }, [rankingsByTimeframe, selectedIds, timeframe]);

  const selected7d = useMemo(() => {
    const map = Object.fromEntries(rankingsByTimeframe["7d"].map((player) => [String(player.player_id), player]));
    return selectedIds.map((id) => map[String(id)]).filter(Boolean);
  }, [rankingsByTimeframe, selectedIds]);

  const selected14d = useMemo(() => {
    const map = Object.fromEntries(rankingsByTimeframe["14d"].map((player) => [String(player.player_id), player]));
    return selectedIds.map((id) => map[String(id)]).filter(Boolean);
  }, [rankingsByTimeframe, selectedIds]);

  const selectedRos = useMemo(() => {
    const map = Object.fromEntries(rankingsByTimeframe.ros.map((player) => [String(player.player_id), player]));
    return selectedIds.map((id) => map[String(id)]).filter(Boolean);
  }, [rankingsByTimeframe, selectedIds]);

  const summary = useMemo(() => {
    const best7d = bestPlayer(selected7d, "fantasyValue");
    const best14d = bestPlayer(selected14d, "fantasyValue");
    const bestRos = bestPlayer(selectedRos, "fantasyValue");
    const bestSchedule = bestPlayer(selectedCurrent, "scheduleScore");
    const bestFit = bestPlayer(selectedCurrent, "fantasyValue");
    const timeframeLabel = COMPARE_TIMEFRAME_OPTIONS.find((option) => option.key === timeframe)?.label || "Selected timeframe";

    return {
      best7d: best7d
        ? { player: best7d, value: `${formatFantasyValue(best7d.fantasyValue)} projected` }
        : null,
      best14d: best14d
        ? { player: best14d, value: `${formatFantasyValue(best14d.fantasyValue)} projected` }
        : null,
      bestRos: bestRos
        ? { player: bestRos, value: `${formatFantasyValue(bestRos.fantasyValue)} projected` }
        : null,
      bestSchedule: bestSchedule
        ? {
            player: bestSchedule,
            value: `${buildSummaryValue(bestSchedule, "gamesInSpan", (value) => `${value} games`)} · ${buildSummaryValue(bestSchedule, "offNightGames", (value) => `${value} off-night`)}`,
          }
        : null,
      bestFit: bestFit
        ? {
            player: bestFit,
            note: `${bestFit.player_name} gives you the strongest ${timeframeLabel.toLowerCase()} value in your current ${state.settings.leagueType} format, with ${bestFit.gamesInSpan} games and ${bestFit.offNightGames} off-night opportunities.`,
          }
        : null,
    };
  }, [selected14d, selected7d, selectedCurrent, selectedRos, state.settings.leagueType, timeframe]);

  const verdicts = useMemo(
    () => buildVerdictTags(selectedCurrent, selected7d, selectedRos),
    [selectedCurrent, selected7d, selectedRos]
  );

  function addPlayer(playerId) {
    setSelectedIds((current) => {
      const target = String(playerId);
      if (current.includes(target) || current.length >= 4) return current;
      return [...current, target];
    });
  }

  function removePlayer(playerId) {
    setSelectedIds((current) => current.filter((id) => String(id) !== String(playerId)));
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <FantasyCompareSelector
        players={players}
        selectedIds={selectedIds}
        onAddPlayer={addPlayer}
        onRemovePlayer={removePlayer}
        search={search}
        onSearchChange={setSearch}
      />

      <section
        style={{
          borderRadius: 22,
          border: "1px solid #17283b",
          background: "#091017",
          padding: "16px 16px 14px",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ color: "#7d95ab", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Timeframe
        </div>
        <FantasyTimeframeSelector
          value={timeframe}
          onChange={setTimeframe}
          options={COMPARE_TIMEFRAME_OPTIONS}
        />
      </section>

      {selectedCurrent.length >= 2 ? (
        <>
          <FantasyCompareSummary summary={summary} />
          <FantasyCompareOverview
            players={selectedCurrent}
            timeframeLabel={COMPARE_TIMEFRAME_OPTIONS.find((option) => option.key === timeframe)?.label || "Selected timeframe"}
            verdicts={verdicts}
            leagueType={state.settings.leagueType}
          />
          <FantasyCompareBreakdown players={selectedCurrent} />
        </>
      ) : (
        <section
          style={{
            borderRadius: 22,
            border: "1px solid #17283b",
            background: "#091017",
            padding: "26px 20px",
            display: "grid",
            gap: 8,
            justifyItems: "start",
          }}
        >
          <div style={{ color: "#eff8ff", fontSize: 22, fontWeight: 900 }}>
            Start with two players
          </div>
          <div style={{ color: "#7d95ab", fontSize: 14, lineHeight: 1.6, maxWidth: 720 }}>
            Compare skaters or goalies side by side using your scoring weights, selected timeframe, game volume, and off-night schedule value. Add 2 to 4 players above to unlock the full breakdown.
          </div>
        </section>
      )}
    </div>
  );
}
