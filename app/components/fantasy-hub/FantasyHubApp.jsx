/**
 * Main client app for the Fantasy Hub.
 * Depends on the fantasy player/schedule APIs plus localStorage-backed league
 * settings and roster state to power My Team, Rankings, and Schedule tabs.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { TEAM_OPTIONS } from "@/app/components/fantasy-hub/fantasyHubConfig";
import FantasyHubLayout from "@/app/components/fantasy-hub/FantasyHubLayout";
import FantasyComparePlayers from "@/app/components/fantasy-hub/FantasyComparePlayers";
import FantasyLeagueSettings from "@/app/components/fantasy-hub/FantasyLeagueSettings";
import FantasyRankingsTable from "@/app/components/fantasy-hub/FantasyRankingsTable";
import FantasyRosterBuilder from "@/app/components/fantasy-hub/FantasyRosterBuilder";
import FantasyScheduleView from "@/app/components/fantasy-hub/FantasyScheduleView";
import FantasyTeamContextBar from "@/app/components/fantasy-hub/FantasyTeamContextBar";
import FantasyTimeframeSelector from "@/app/components/fantasy-hub/FantasyTimeframeSelector";
import {
  buildRosterContextSummary,
  createDefaultFantasyState,
  getRosteredIds,
  loadFantasyState,
  saveFantasyState,
  startOfWeekIso,
} from "@/app/components/fantasy-hub/fantasyHubUtils";

const FILTER_SHELL = {
  borderRadius: 22,
  border: "1px solid #17283b",
  background: "#091017",
  padding: "16px 16px 14px",
  display: "grid",
  gap: 14,
};

const SELECT_LABEL_STYLE = {
  color: "#7d95ab",
  fontSize: 11,
  fontFamily: "'DM Mono',monospace",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const SELECT_INPUT_STYLE = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid #213547",
  background: "#0f1823",
  color: "#e8f5ff",
  padding: "10px 12px",
  fontSize: 14,
  outline: "none",
};

function SelectField({ label, value, onChange, options }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={SELECT_LABEL_STYLE}>{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={SELECT_INPUT_STYLE}
      >
        {options.map((option) => (
          <option key={option.value || option.key} value={option.value || option.key}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function FantasyHubApp() {
  const [activeTab, setActiveTab] = useState("my-team");
  const [state, setState] = useState(createDefaultFantasyState);
  const [hydrated, setHydrated] = useState(false);
  const [players, setPlayers] = useState([]);
  const [scheduleData, setScheduleData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [timeframe, setTimeframe] = useState("ros");
  const [weekStart, setWeekStart] = useState(startOfWeekIso());
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [rosterStateFilter, setRosterStateFilter] = useState("all");
  const [showRosterTeamsOnly, setShowRosterTeamsOnly] = useState(false);

  useEffect(() => {
    setState(loadFantasyState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveFantasyState(state);
  }, [hydrated, state]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setError("");
        const [playersRes, scheduleRes] = await Promise.all([
          fetch("/api/fantasy/players", { cache: "no-store" }),
          fetch(`/api/fantasy/schedule?weekStart=${weekStart}`, { cache: "no-store" }),
        ]);

        if (!playersRes.ok) throw new Error("Could not load fantasy players");
        if (!scheduleRes.ok) throw new Error("Could not load fantasy schedule");

        const [playersPayload, schedulePayload] = await Promise.all([playersRes.json(), scheduleRes.json()]);

        if (!cancelled) {
          setPlayers(playersPayload);
          setScheduleData(schedulePayload);
          setLoading(false);
        }
      } catch (loadError) {
        console.error("[FantasyHubApp] loadData failed:", loadError);
        if (!cancelled) {
          setError(loadError.message || "Could not load Fantasy Hub");
          setLoading(false);
        }
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  const playerMap = useMemo(
    () => Object.fromEntries(players.map((player) => [String(player.player_id), player])),
    [players]
  );
  const summary = useMemo(
    () => buildRosterContextSummary(state, playerMap, timeframe, scheduleData),
    [playerMap, scheduleData, state, timeframe]
  );
  const rosterTeams = useMemo(() => {
    const teams = new Set();
    getRosteredIds(state).forEach((id) => {
      const team = playerMap[id]?.team;
      if (team) teams.add(team);
    });
    return teams;
  }, [playerMap, state]);

  const header = (
    <section
      style={{
        borderRadius: 24,
        border: "1px solid #18304a",
        background: "linear-gradient(180deg, rgba(10,20,32,0.98) 0%, rgba(7,11,18,0.98) 100%)",
        boxShadow: "0 18px 44px rgba(0,0,0,0.24)",
        padding: "18px 18px 16px",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ color: "#6caede", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
        NHL Analytics · Fantasy
      </div>
      <div style={{ color: "#eff8ff", fontSize: 34, fontWeight: 900, lineHeight: 1 }}>
        Fantasy Hub
      </div>
      <div style={{ color: "#86a5c0", fontSize: 14, lineHeight: 1.5, maxWidth: 860 }}>
        Build a fantasy roster, tune scoring settings, generate custom rankings, and plan around the weekly NHL schedule from one dedicated workspace.
      </div>
    </section>
  );

  let content = null;

  if (loading) {
    content = (
      <div style={FILTER_SHELL}>
        <div style={{ color: "#eff8ff", fontSize: 22, fontWeight: 900 }}>Loading Fantasy Hub…</div>
        <div style={{ color: "#7d95ab", fontSize: 14 }}>
          Pulling current-season players and the latest schedule context.
        </div>
      </div>
    );
  } else if (error) {
    content = (
      <div style={FILTER_SHELL}>
        <div style={{ color: "#eff8ff", fontSize: 22, fontWeight: 900 }}>Fantasy Hub unavailable</div>
        <div style={{ color: "#ff9aa4", fontSize: 14 }}>{error}</div>
      </div>
    );
  } else if (activeTab === "my-team") {
    content = (
      <div style={{ display: "grid", gap: 18 }}>
        <FantasyLeagueSettings state={state} onStateChange={setState} />
        <section style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={{ color: "#6caede", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
              Step 2: Build My Team
            </div>
            <div style={{ color: "#eff8ff", fontSize: 26, fontWeight: 900, marginTop: 4 }}>
              Add players and shape your roster
            </div>
            <div style={{ color: "#7d95ab", fontSize: 14, lineHeight: 1.6, maxWidth: 760, marginTop: 6 }}>
              Search the player pool, slot players into your fantasy roster, and let your league settings drive the player value context.
            </div>
          </div>
        </section>
        <FantasyRosterBuilder
          players={players}
          playerMap={playerMap}
          state={state}
          onStateChange={setState}
          search={teamSearch}
          onSearchChange={setTeamSearch}
        />
      </div>
    );
  } else if (activeTab === "rankings") {
    content = (
      <div style={{ display: "grid", gap: 16 }}>
        <section style={FILTER_SHELL}>
          <div className="fantasy-rankings-filters" style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) repeat(3, minmax(170px, 220px))", gap: 12, alignItems: "end" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ color: "#7d95ab", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Timeframe
              </div>
              <FantasyTimeframeSelector value={timeframe} onChange={setTimeframe} />
            </div>
            <div />
            <SelectField
              label="Position"
              value={positionFilter}
              onChange={setPositionFilter}
              options={[
                { value: "ALL", label: "All Positions" },
                { value: "F", label: "Forwards" },
                { value: "D", label: "Defense" },
                { value: "G", label: "Goalies" },
              ]}
            />
            <SelectField label="Team" value={teamFilter} onChange={setTeamFilter} options={TEAM_OPTIONS} />
            <SelectField
              label="Roster Status"
              value={rosterStateFilter}
              onChange={setRosterStateFilter}
              options={[
                { value: "all", label: "All Players" },
                { value: "available", label: "Available" },
                { value: "rostered", label: "My Roster" },
              ]}
            />
          </div>
          <style>{`
            @media (max-width: 980px) {
              .fantasy-rankings-filters {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>
        </section>

        <FantasyRankingsTable
          players={players}
          state={state}
          timeframe={timeframe}
          filters={{
            position: positionFilter,
            team: teamFilter,
            rosterState: rosterStateFilter,
          }}
          scheduleData={scheduleData}
        />
      </div>
    );
  } else if (activeTab === "compare") {
    content = (
      <FantasyComparePlayers
        players={players}
        state={state}
        scheduleData={scheduleData}
      />
    );
  } else {
    content = (
      <FantasyScheduleView
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        scheduleData={scheduleData}
        showRosterTeamsOnly={showRosterTeamsOnly}
        onToggleRosterTeamsOnly={setShowRosterTeamsOnly}
        rosterTeams={rosterTeams}
      />
    );
  }

  return (
    <FantasyHubLayout
      activeTab={activeTab}
      onTabChange={setActiveTab}
      header={header}
      contextBar={<FantasyTeamContextBar state={state} summary={summary} />}
    >
      {content}
    </FantasyHubLayout>
  );
}
