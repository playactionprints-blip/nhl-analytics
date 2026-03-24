"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { TEAM_COLOR, TEAM_FULL, logoUrl } from "@/app/lib/nhlTeams";

function normalizeTeamCode(team) {
  const map = { "L.A": "LAK", "N.J": "NJD", "S.J": "SJS", "T.B": "TBL" };
  return map[team] || team || null;
}

function useCombobox(initialOpen = false) {
  const [open, setOpen] = useState(initialOpen);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (!ref.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return { open, setOpen, ref };
}

function panelShell(accent) {
  return {
    borderRadius: 28,
    border: `1px solid ${accent}33`,
    background: "linear-gradient(180deg, rgba(13,20,30,0.98) 0%, rgba(8,13,21,0.98) 100%)",
    boxShadow: "0 18px 40px rgba(0,0,0,0.2)",
    padding: 22,
    display: "grid",
    gap: 16,
    minWidth: 0,
  };
}

function SearchableSelect({
  title,
  accent,
  query,
  onQueryChange,
  open,
  setOpen,
  comboRef,
  options,
  selectedLabel,
  placeholder,
  renderOption,
}) {
  return (
    <div ref={comboRef} style={{ display: "grid", gap: 8, position: "relative" }}>
      <div
        style={{
          color: "#86a9c6",
          fontSize: 11,
          fontFamily: "'DM Mono',monospace",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        {title}
      </div>

      <div
        style={{
          borderRadius: 18,
          border: `1px solid ${open ? `${accent}66` : "#1d3347"}`,
          background: "#0a141f",
          padding: "12px 14px",
          display: "grid",
          gap: 10,
          boxShadow: open ? `0 0 0 1px ${accent}22 inset` : "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <input
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#eef8ff",
              fontSize: 15,
              fontWeight: 700,
              fontFamily: "'Barlow Condensed',sans-serif",
            }}
          />
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            style={{
              border: "none",
              background: "transparent",
              color: "#7ea3c0",
              cursor: "pointer",
              fontSize: 12,
              padding: 0,
            }}
          >
            {open ? "▲" : "▼"}
          </button>
        </div>

        {!query && selectedLabel ? (
          <div
            style={{
              color: "#7f97ad",
              fontSize: 12,
              fontFamily: "'DM Mono',monospace",
            }}
          >
            Featured: {selectedLabel}
          </div>
        ) : null}
      </div>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 8,
            borderRadius: 18,
            border: "1px solid #1d3347",
            background: "rgba(8,13,21,0.98)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.42)",
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 20,
          }}
        >
          {options.length ? (
            options.map((option) => renderOption(option))
          ) : (
            <div style={{ padding: 14, color: "#8ba7bf" }}>No matches found.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PlayerPreview({ player }) {
  if (!player) return null;
  return (
    <div
      style={{
        borderRadius: 22,
        border: `1px solid ${(TEAM_COLOR[player.team] || "#2fb4ff")}33`,
        background: "linear-gradient(180deg, rgba(11,18,27,0.98) 0%, rgba(8,13,21,0.98) 100%)",
        padding: 18,
        display: "grid",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <img src={logoUrl(player.team)} alt={player.team} style={{ width: 42, height: 42, objectFit: "contain" }} />
        <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
          <div style={{ color: "#eff8ff", fontSize: 24, fontWeight: 900, lineHeight: 1 }}>
            {player.full_name}
          </div>
          <div style={{ color: "#84a4be", fontSize: 13 }}>
            {player.team} · {player.position || "—"} · {player.gp ?? "—"} GP
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <StatBox label="WAR" value={player.war_total != null ? Number(player.war_total).toFixed(2) : "—"} valueColor="#dff6ff" />
        <StatBox label="OVR" value={player.overall_rating != null ? Math.round(player.overall_rating) : "—"} valueColor="#2fb4ff" />
        <StatBox label="Team" value={player.team} valueColor={TEAM_COLOR[player.team] || "#8fd3ff"} />
      </div>
    </div>
  );
}

function TeamPreview({ team }) {
  if (!team) return null;
  return (
    <div
      style={{
        borderRadius: 22,
        border: `1px solid ${(TEAM_COLOR[team.abbr] || "#56e0a8")}33`,
        background: "linear-gradient(180deg, rgba(11,18,27,0.98) 0%, rgba(8,13,21,0.98) 100%)",
        padding: 18,
        display: "grid",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <img src={logoUrl(team.abbr)} alt={team.abbr} style={{ width: 44, height: 44, objectFit: "contain" }} />
        <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
          <div style={{ color: "#eff8ff", fontSize: 24, fontWeight: 900, lineHeight: 1 }}>
            {team.name}
          </div>
          <div style={{ color: "#84a4be", fontSize: 13 }}>
            #{team.rank} by current WAR · {team.abbr}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <StatBox label="WAR" value={team.war.toFixed(1)} valueColor="#dff6ff" />
        <StatBox label="OVR" value={team.avgRating != null ? Math.round(team.avgRating) : "—"} valueColor="#56e0a8" />
        <StatBox label="Players" value={team.playerCount} valueColor="#8fd3ff" />
      </div>
    </div>
  );
}

function StatBox({ label, value, valueColor = "#eef8ff" }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid #1f3448",
        background: "rgba(12,19,29,0.88)",
        padding: "10px 12px",
        display: "grid",
        gap: 5,
      }}
    >
      <div
        style={{
          color: "#7f9ab1",
          fontSize: 10,
          fontFamily: "'DM Mono',monospace",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div style={{ color: valueColor, fontSize: 18, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

export default function HomeCardsExplorer({ players = [], teams = [] }) {
  const normalizedPlayers = useMemo(
    () =>
      players.map((player) => ({
        ...player,
        team: normalizeTeamCode(player.team),
      })),
    [players]
  );

  const normalizedTeams = useMemo(
    () =>
      teams.map((team, index) => ({
        ...team,
        rank: index + 1,
      })),
    [teams]
  );

  const defaultPlayer = normalizedPlayers[0] || null;
  const defaultTeam = normalizedTeams[0] || null;

  const [playerQuery, setPlayerQuery] = useState("");
  const [teamQuery, setTeamQuery] = useState("");
  const [selectedPlayerId, setSelectedPlayerId] = useState(defaultPlayer?.player_id || null);
  const [selectedTeamAbbr, setSelectedTeamAbbr] = useState(defaultTeam?.abbr || null);

  const playerBox = useCombobox(false);
  const teamBox = useCombobox(false);

  const filteredPlayers = useMemo(() => {
    const base = playerQuery.trim()
      ? normalizedPlayers.filter((player) => {
          const haystack = `${player.full_name} ${player.team} ${player.position || ""}`.toLowerCase();
          return haystack.includes(playerQuery.trim().toLowerCase());
        })
      : normalizedPlayers.slice(0, 5);
    return base.slice(0, 12);
  }, [normalizedPlayers, playerQuery]);

  const filteredTeams = useMemo(() => {
    const base = teamQuery.trim()
      ? normalizedTeams.filter((team) => {
          const haystack = `${team.name} ${team.abbr}`.toLowerCase();
          return haystack.includes(teamQuery.trim().toLowerCase());
        })
      : normalizedTeams;
    return base.slice(0, 16);
  }, [normalizedTeams, teamQuery]);

  const selectedPlayer =
    normalizedPlayers.find((player) => player.player_id === selectedPlayerId) || defaultPlayer;
  const selectedTeam =
    normalizedTeams.find((team) => team.abbr === selectedTeamAbbr) || defaultTeam;

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ color: "#86a9c6", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Quick card explorer
        </div>
        <h2 style={{ margin: 0, color: "#eef8ff", fontSize: 34, lineHeight: 1, fontWeight: 900 }}>
          Jump straight into player and team cards
        </h2>
      </div>

      <div className="home-cards-explorer-grid">
        <article style={panelShell("#2fb4ff")}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ color: "#eef8ff", fontSize: 24, fontWeight: 900 }}>Player Cards</div>
              <div style={{ color: "#8ba7bf", fontSize: 14, lineHeight: 1.5 }}>
                Search the current player pool and preview a card instantly.
              </div>
            </div>
            <Link
              href={selectedPlayer ? `/players/${selectedPlayer.player_id}` : "/players"}
              style={ctaStyle}
            >
              View More...
            </Link>
          </div>

          <SearchableSelect
            title="Search players"
            accent="#2fb4ff"
            query={playerQuery}
            onQueryChange={setPlayerQuery}
            open={playerBox.open}
            setOpen={playerBox.setOpen}
            comboRef={playerBox.ref}
            options={filteredPlayers}
            selectedLabel={defaultPlayer?.full_name}
            placeholder="Search players"
            renderOption={(player) => (
              <button
                key={player.player_id}
                type="button"
                onClick={() => {
                  setSelectedPlayerId(player.player_id);
                  setPlayerQuery("");
                  playerBox.setOpen(false);
                }}
                style={optionButtonStyle}
              >
                <span style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                  <img src={logoUrl(player.team)} alt={player.team} style={{ width: 24, height: 24, objectFit: "contain", flexShrink: 0 }} />
                  <span style={{ display: "grid", gap: 2, minWidth: 0, textAlign: "left" }}>
                    <span style={{ color: "#eef8ff", fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {player.full_name}
                    </span>
                    <span style={{ color: "#7f9ab1", fontSize: 12 }}>
                      {player.team} · {player.position || "—"}
                    </span>
                  </span>
                </span>
              </button>
            )}
          />

          <PlayerPreview player={selectedPlayer} />
        </article>

        <article style={panelShell("#56e0a8")}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ color: "#eef8ff", fontSize: 24, fontWeight: 900 }}>Team Cards</div>
              <div style={{ color: "#8ba7bf", fontSize: 14, lineHeight: 1.5 }}>
                Search teams and jump into the current card view without leaving home.
              </div>
            </div>
            <Link
              href={selectedTeam ? `/team/${selectedTeam.abbr}` : "/teams"}
              style={ctaStyle}
            >
              View More...
            </Link>
          </div>

          <SearchableSelect
            title="Search teams"
            accent="#56e0a8"
            query={teamQuery}
            onQueryChange={setTeamQuery}
            open={teamBox.open}
            setOpen={teamBox.setOpen}
            comboRef={teamBox.ref}
            options={filteredTeams}
            selectedLabel={defaultTeam?.name}
            placeholder="Search teams"
            renderOption={(team) => (
              <button
                key={team.abbr}
                type="button"
                onClick={() => {
                  setSelectedTeamAbbr(team.abbr);
                  setTeamQuery("");
                  teamBox.setOpen(false);
                }}
                style={optionButtonStyle}
              >
                <span style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                  <img src={logoUrl(team.abbr)} alt={team.abbr} style={{ width: 24, height: 24, objectFit: "contain", flexShrink: 0 }} />
                  <span style={{ display: "grid", gap: 2, minWidth: 0, textAlign: "left" }}>
                    <span style={{ color: "#eef8ff", fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {team.name}
                    </span>
                    <span style={{ color: "#7f9ab1", fontSize: 12 }}>
                      {team.abbr}
                    </span>
                  </span>
                </span>
              </button>
            )}
          />

          <TeamPreview team={selectedTeam} />
        </article>
      </div>

      <style>{`
        .home-cards-explorer-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
        }
        @media (max-width: 860px) {
          .home-cards-explorer-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}

const optionButtonStyle = {
  border: "none",
  background: "transparent",
  width: "100%",
  textAlign: "left",
  padding: "12px 14px",
  cursor: "pointer",
};

const ctaStyle = {
  color: "#dff3ff",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 800,
  borderRadius: 999,
  border: "1px solid #274663",
  padding: "10px 14px",
  background: "#0e1722",
};
