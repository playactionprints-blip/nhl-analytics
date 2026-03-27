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

function parseToi(toi) {
  if (!toi) return null;
  const [mins, secs] = String(toi).split(":");
  const m = Number.parseInt(mins, 10);
  const s = Number.parseInt(secs || "0", 10);
  if (Number.isNaN(m) || Number.isNaN(s)) return null;
  return m + s / 60;
}

function pctColor(value) {
  if (value == null || Number.isNaN(Number(value))) return "var(--text-muted)";
  if (value >= 85) return "var(--accent-teal)";
  if (value >= 70) return "#2fb4ff";
  if (value >= 50) return "#ffbf47";
  return "#ff6b7a";
}

function formatPercentileText(value) {
  if (value == null || Number.isNaN(Number(value))) return "value signal building";
  const rounded = Math.round(Number(value));
  const mod100 = rounded % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th percentile`;
  const mod10 = rounded % 10;
  if (mod10 === 1) return `${rounded}st percentile`;
  if (mod10 === 2) return `${rounded}nd percentile`;
  if (mod10 === 3) return `${rounded}rd percentile`;
  return `${rounded}th percentile`;
}

function roleLabel(player) {
  const toi = parseToi(player.toi);
  const pos = (player.position || "").toUpperCase();
  if (pos === "D") {
    if (toi >= 23) return "Top pair";
    if (toi >= 20) return "Top four";
    if (toi >= 17) return "Second pair";
    return "Depth pair";
  }
  if (pos === "G") return "Goaltender";
  if (toi >= 20) return "First line";
  if (toi >= 17) return "Top six";
  if (toi >= 14) return "Middle six";
  return "Depth";
}

function getPlayerDescriptor(player) {
  const percentiles = player.percentiles || {};
  const evOff = percentiles["EV Off"] ?? percentiles["RAPM Off"] ?? player.rapm_off_pct ?? 0;
  const evDef = percentiles["EV Def"] ?? percentiles["RAPM Def"] ?? player.rapm_def_pct ?? 0;
  const shooting = percentiles["Shooting"] ?? 0;
  const pp = percentiles["PP"] ?? 0;
  const pos = (player.position || "").toUpperCase();

  if (pos === "D") {
    if (evDef >= 82 && evOff >= 72) return "Strong two-way defenceman";
    if (evOff >= 85) return "Offence-driving defenceman";
    if (evDef >= 85) return "Matchup defender";
    return "Reliable blue-line contributor";
  }
  if (pos === "G") return "Goaltending value profile";
  if (evOff >= 90 && shooting >= 70) return "Elite offensive play driver";
  if (evOff >= 84) return "Top-line scoring forward";
  if (evDef >= 80 && evOff >= 65) return "Strong two-way forward";
  if (pp >= 82) return "Power-play specialist";
  return "Everyday impact contributor";
}

function getTopStrengths(player, limit = 3) {
  const percentiles = player.percentiles || {};
  return [
    { label: "Even strength offence", value: percentiles["EV Off"] ?? percentiles["RAPM Off"] ?? player.rapm_off_pct },
    { label: "Even strength defence", value: percentiles["EV Def"] ?? percentiles["RAPM Def"] ?? player.rapm_def_pct },
    { label: "Power play impact", value: percentiles["PP"] },
    { label: "Penalty impact", value: percentiles["Penalties"] },
    { label: "Finishing impact", value: percentiles["Shooting"] },
    { label: "Points", value: percentiles["Pts/60"] },
    { label: "Goals", value: percentiles["Goals/60"] },
  ]
    .filter((item) => item.value != null)
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
    .slice(0, limit);
}

function getPlayerBars(player) {
  const percentiles = player.percentiles || {};
  return [
    { label: "Even Strength Offence", value: percentiles["EV Off"] ?? percentiles["RAPM Off"] ?? player.rapm_off_pct },
    { label: "Even Strength Defence", value: percentiles["EV Def"] ?? percentiles["RAPM Def"] ?? player.rapm_def_pct },
    { label: "Power Play Impact", value: percentiles["PP"] },
    { label: "Finishing Impact", value: percentiles["Shooting"] },
  ].filter((item) => item.value != null);
}

function formatRecord(record) {
  if (!record) return null;
  return `${record.wins}-${record.losses}-${record.otLosses}`;
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
          color: "var(--text-secondary)",
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
          border: `1px solid ${open ? `${accent}66` : "var(--border-strong)"}`,
          background: "var(--bg-card)",
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
              color: "var(--text-primary)",
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
              color: "var(--text-secondary)",
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
              color: "var(--text-muted)",
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
            border: "1px solid var(--border-strong)",
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
            <div style={{ padding: 14, color: "var(--text-secondary)" }}>No matches found.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PlayerPreview({ player }) {
  if (!player) return null;
  const accent = TEAM_COLOR[player.team] || "#2fb4ff";
  const percentiles = player.percentiles || {};
  const strengths = getTopStrengths(player);
  const bars = getPlayerBars(player);
  const profilePct = percentiles["WAR"] ?? percentiles["Overall"] ?? player.overall_rating ?? null;
  const descriptor = getPlayerDescriptor(player);
  return (
    <div
      style={{
        borderRadius: 22,
        border: `1px solid ${accent}33`,
        background: "linear-gradient(180deg, rgba(11,18,27,0.98) 0%, rgba(8,13,21,0.98) 100%)",
        padding: 18,
        display: "grid",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
          <img src={logoUrl(player.team)} alt={player.team} style={{ width: 42, height: 42, objectFit: "contain", flexShrink: 0 }} />
          <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
            <div style={{ color: "var(--text-primary)", fontSize: 24, fontWeight: 900, lineHeight: 1 }}>
              {player.full_name}
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: 13, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span>{player.team} · {TEAM_FULL[player.team] || player.team}</span>
              <span>{player.position || "—"} · {roleLabel(player)}</span>
            </div>
          </div>
        </div>

        <div
          style={{
            borderRadius: 14,
            border: `1px solid ${accent}`,
            background: `${accent}12`,
            padding: "10px 12px",
            minWidth: 88,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              color: accent,
              fontSize: 10,
              fontFamily: "'DM Mono',monospace",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            3-Year WAR
          </div>
          <div style={{ color: accent, fontSize: 22, fontWeight: 900, lineHeight: 1.1 }}>
            {player.war_total != null ? `${Number(player.war_total) > 0 ? "+" : ""}${Number(player.war_total).toFixed(1)}` : "—"}
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: 9, fontFamily: "'DM Mono',monospace", marginTop: 4 }}>
            {formatPercentileText(profilePct)}
          </div>
        </div>
      </div>

      <div
        style={{
          borderRadius: 16,
          border: "1px solid var(--border-strong)",
          background: "var(--bg-secondary)",
          padding: 14,
          display: "grid",
          gap: 10,
        }}
      >
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: 10,
            fontFamily: "'DM Mono',monospace",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Percentile card preview
        </div>
        <div style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 800 }}>
          {descriptor}
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.55 }}>
          {profilePct != null ? `${formatPercentileText(profilePct)} overall value signal with a ${roleLabel(player).toLowerCase()} usage profile.` : "Player value signal still building."}
        </div>
        {strengths.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {strengths.map((item) => (
              <span
                key={item.label}
                style={{
                  fontSize: 11,
                  color: "var(--text-primary)",
                  borderRadius: 999,
                  border: "1px solid var(--border-strong)",
                  background: "var(--bg-card)",
                  padding: "6px 10px",
                }}
              >
                {item.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: 10,
            fontFamily: "'DM Mono',monospace",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Percentile snapshot
        </div>
        {bars.map((item) => (
          <PercentilePreviewBar key={item.label} label={item.label} value={item.value} />
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <StatBox label="GP" value={player.gp ?? "—"} valueColor="var(--text-primary)" />
        <StatBox label="OVR" value={player.overall_rating != null ? Math.round(player.overall_rating) : "—"} valueColor="#2fb4ff" />
        <StatBox label="Role" value={player.position || "—"} valueColor={accent} />
      </div>
    </div>
  );
}

function TeamPreview({ team }) {
  if (!team) return null;
  const accent = TEAM_COLOR[team.abbr] || "var(--accent-teal)";
  const recordText = formatRecord(team.record);
  const pointsText = team.record?.points != null ? `${team.record.points} pts` : null;
  const teamStats = [
    { label: "CF% (5v5)", value: team.avgCF != null ? `${team.avgCF.toFixed(1)}%` : "—" },
    { label: "xGF% (5v5)", value: team.avgXGF != null ? `${team.avgXGF.toFixed(1)}%` : "—" },
    { label: "Total WAR", value: team.war != null ? team.war.toFixed(1) : "—" },
    { label: "PP%", value: team.record?.ppPct != null ? `${team.record.ppPct.toFixed(1)}%` : "—" },
  ];
  return (
    <div
      style={{
        borderRadius: 22,
        border: `1px solid ${accent}33`,
        background: "linear-gradient(180deg, rgba(11,18,27,0.98) 0%, rgba(8,13,21,0.98) 100%)",
        padding: 18,
        display: "grid",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <div
          style={{
            width: 62,
            height: 62,
            borderRadius: 16,
            border: `1px solid ${accent}33`,
            background: `linear-gradient(135deg, ${accent}16, rgba(10,20,31,0.8))`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <img src={logoUrl(team.abbr)} alt={team.abbr} style={{ width: 42, height: 42, objectFit: "contain" }} />
        </div>
        <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
          <div style={{ color: accent, fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.14em" }}>
            {team.abbr}
          </div>
          <div style={{ color: "var(--text-primary)", fontSize: 24, fontWeight: 900, lineHeight: 1 }}>
            {team.name}
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: 13, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {recordText ? <span>{recordText}</span> : null}
            {pointsText ? <span>{pointsText}</span> : null}
            <span>WAR Rank #{team.rank}</span>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 10,
        }}
        className="home-team-preview-grid"
      >
        {teamStats.map((item) => (
          <StatBox
            key={item.label}
            label={item.label}
            value={item.value}
            valueColor={item.label === "PP%" ? "#34e2a2" : item.label === "Total WAR" ? "#2fb4ff" : "var(--text-primary)"}
          />
        ))}
      </div>

      <div
        style={{
          color: "var(--text-muted)",
          fontSize: 10,
          fontFamily: "'DM Mono',monospace",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        Record and points reflect the current team season view.
      </div>
    </div>
  );
}

function PercentilePreviewBar({ label, value }) {
  const color = pctColor(value);
  return (
    <div style={{ display: "grid", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span
          style={{
            color: "var(--text-secondary)",
            fontSize: 11,
            fontFamily: "'DM Mono',monospace",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {label}
        </span>
        <span style={{ color, fontSize: 12, fontWeight: 800, fontFamily: "'DM Mono',monospace" }}>
          {Math.round(Number(value))}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--bg-secondary)", overflow: "hidden" }}>
        <div
          style={{
            width: `${Math.max(0, Math.min(100, Number(value) || 0))}%`,
            height: "100%",
            borderRadius: 999,
            background: `linear-gradient(90deg, ${color}77, ${color})`,
          }}
        />
      </div>
    </div>
  );
}

function StatBox({ label, value, valueColor = "var(--text-primary)" }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid var(--border-strong)",
        background: "rgba(12,19,29,0.88)",
        padding: "10px 12px",
        display: "grid",
        gap: 5,
      }}
    >
      <div
        style={{
          color: "var(--text-muted)",
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
        <div style={{ color: "var(--text-secondary)", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>
          Quick card explorer
        </div>
        <h2 style={{ margin: 0, color: "var(--text-primary)", fontSize: 34, lineHeight: 1, fontWeight: 900 }}>
          Jump straight into player and team cards
        </h2>
      </div>

      <div className="home-cards-explorer-grid">
        <article style={panelShell("#2fb4ff")}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ color: "var(--text-primary)", fontSize: 24, fontWeight: 900 }}>Player Cards</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 }}>
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
                    <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {player.full_name}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      {player.team} · {player.position || "—"}
                    </span>
                  </span>
                </span>
              </button>
            )}
          />

          <PlayerPreview player={selectedPlayer} />
        </article>

        <article style={panelShell("var(--accent-teal)")}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ color: "var(--text-primary)", fontSize: 24, fontWeight: 900 }}>Team Cards</div>
              <div style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 }}>
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
            accent="var(--accent-teal)"
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
                    <span style={{ color: "var(--text-primary)", fontWeight: 800, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {team.name}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
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
        .home-team-preview-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        @media (max-width: 860px) {
          .home-cards-explorer-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 560px) {
          .home-team-preview-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
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
  color: "var(--text-primary)",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 800,
  borderRadius: 999,
  border: "1px solid var(--border-strong)",
  padding: "10px 14px",
  background: "var(--bg-card)",
};
