"use client";

import { useState, useMemo } from "react";
import { logoUrl } from "@/app/lib/nhlTeams";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAbbr(team) {
  return typeof team.teamAbbrev === "string"
    ? team.teamAbbrev
    : (team.teamAbbrev?.default ?? "");
}

function getName(team) {
  return typeof team.teamName === "string"
    ? team.teamName
    : (team.teamName?.default ?? getAbbr(team));
}

function oddsColor(pct) {
  if (pct > 0.85) return "#35e3a0";
  if (pct > 0.60) return "#2fb4ff";
  if (pct > 0.35) return "#f0c040";
  if (pct > 0.15) return "#ff8d9b";
  return "#3a4a5a";
}

function fmtPct(pct) {
  if (pct == null || pct < 0.001) return "—";
  if (pct >= 1) return "100%";
  if (pct > 0.995) return ">99%";
  const p = Math.round(pct * 100);
  return p < 1 ? "<1%" : `${p}%`;
}

// ── Style constants ───────────────────────────────────────────────────────────

const CARD = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-strong)",
  borderRadius: 20,
  overflow: "hidden",
};

const STAT = {
  fontSize: 12,
  color: "#7e98b2",
  fontFamily: "'DM Mono',monospace",
  textAlign: "center",
};

// Desktop grid: logo | team | GP | W | L | OTL | PTS | PROJ | PLAYOFF ODDS | DIV FINAL | CONF FINAL | CUP
// cols 9 (DIV FINAL) and 10 (CONF FINAL) are hidden below 700 px (.hide-sm)
const GRID_DESKTOP = "26px minmax(80px,1fr) 26px 26px 26px 30px 36px 40px minmax(90px,150px) 54px 60px 44px";
const GRID_MOBILE  = "26px minmax(80px,1fr) 26px 26px 26px 30px 36px 40px minmax(90px,150px) 44px";

const COL_H = ["", "TEAM", "GP", "W", "L", "OTL", "PTS", "PROJ", "PLAYOFF ODDS", "DIV FINAL", "CONF FINAL", "CUP"];

// ── Column header row ─────────────────────────────────────────────────────────

function ColHeaderRow() {
  return (
    <div className="team-grid" style={{ padding: "5px 14px", borderBottom: "1px solid #0c1520" }}>
      {COL_H.map((h, i) => (
        <div
          key={i}
          className={i === 9 || i === 10 ? "hide-sm" : ""}
          style={{
            fontSize: 9,
            color: "var(--text-muted)",
            fontFamily: "'DM Mono',monospace",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            textAlign: i >= 2 ? "center" : "left",
          }}
        >
          {h}
        </div>
      ))}
    </div>
  );
}

// ── Team row ──────────────────────────────────────────────────────────────────

function TeamRow({ team, simResults, cutlineAfter = false }) {
  const abbr = getAbbr(team);
  const name = getName(team);
  const sim = simResults[abbr] || {};

  const simClinched = !!sim.clinched;
  const simEliminated = !!sim.eliminated;
  const rawPlayoff = sim.playoffOdds ?? 0;
  const isClinched = !!team.clinchIndicator || simClinched;
  const playoff = isClinched ? Math.max(rawPlayoff, 0.99) : rawPlayoff;
  const barColor = oddsColor(playoff);

  const currentPts = team.points || 0;
  const projPts = sim.projectedPoints ?? currentPts;
  const projHigher = projPts > currentPts;

  return (
    <div
      style={{
        borderBottom: cutlineAfter
          ? "2px dashed rgba(47,180,255,0.28)"
          : "1px solid #0c1520",
      }}
    >
      <div className="team-grid team-grid-desktop" style={{ padding: "8px 14px" }}>
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl(abbr)}
          alt={abbr}
          width={22}
          height={22}
          style={{ width: 22, height: 22, objectFit: "contain" }}
        />

        {/* Team name + clinch badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
          <span
            style={{
              color: "var(--text-primary)",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "'Barlow Condensed',sans-serif",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {name}
          </span>
          {isClinched && (
            <span
              title={`Clinched: ${team.clinchIndicator}`}
              style={{
                flexShrink: 0,
                fontSize: 9,
                color: "#35e3a0",
                fontFamily: "'DM Mono',monospace",
                background: "rgba(53,227,160,0.1)",
                border: "1px solid rgba(53,227,160,0.25)",
                borderRadius: 4,
                padding: "1px 4px",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {team.clinchIndicator}
            </span>
          )}
        </div>

        {/* Stats */}
        <div style={STAT}>{team.gamesPlayed ?? "—"}</div>
        <div style={STAT}>{team.wins ?? "—"}</div>
        <div style={STAT}>{team.losses ?? "—"}</div>
        <div style={STAT}>{team.otLosses ?? "—"}</div>
        <div style={{ ...STAT, color: "var(--text-primary)", fontWeight: 800 }}>{currentPts}</div>
        <div style={{ ...STAT, color: projHigher ? "#9fd8ff" : "var(--text-secondary)", fontWeight: 600 }}>
          {projPts}
        </div>

        {/* Playoff odds — colour-coded bar + % / CLINCHED / ELIM label */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              flex: 1,
              height: 6,
              background: "#0d1825",
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: simClinched ? "100%" : simEliminated ? "0%" : `${Math.min(100, playoff * 100)}%`,
                height: "100%",
                background: simClinched
                  ? "linear-gradient(90deg, #35e3a055, #35e3a0)"
                  : `linear-gradient(90deg, ${barColor}55, ${barColor})`,
                borderRadius: 3,
              }}
            />
          </div>
          <div
            style={{
              fontSize: 11,
              fontFamily: "'DM Mono',monospace",
              color: simClinched ? "#35e3a0" : simEliminated ? "#e05050" : barColor,
              fontWeight: 700,
              minWidth: 34,
              textAlign: "right",
            }}
          >
            {simClinched ? "CLINCHED" : simEliminated ? "ELIM" : fmtPct(playoff)}
          </div>
        </div>

        {/* Div Final — hidden on mobile */}
        <div
          className="hide-sm"
          style={{ ...STAT, color: simEliminated ? "#3a4a5a" : oddsColor(sim.divFinalOdds ?? 0) }}
        >
          {simEliminated ? "—" : fmtPct(sim.divFinalOdds ?? 0)}
        </div>

        {/* Conf Final — hidden on mobile */}
        <div
          className="hide-sm"
          style={{ ...STAT, color: simEliminated ? "#3a4a5a" : oddsColor(sim.confFinalOdds ?? 0) }}
        >
          {simEliminated ? "—" : fmtPct(sim.confFinalOdds ?? 0)}
        </div>

        {/* Cup */}
        <div style={{ ...STAT, color: simEliminated ? "#3a4a5a" : oddsColor(sim.cupOdds ?? 0) }}>
          {simEliminated ? "—" : fmtPct(sim.cupOdds ?? 0)}
        </div>
      </div>
      <div
        className="team-mobile-card"
        style={{
          display: "none",
          padding: "12px 14px",
          background: "#060d14",
        }}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src={logoUrl(abbr)}
              alt={abbr}
              width={26}
              height={26}
              style={{ width: 26, height: 26, objectFit: "contain" }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {name}
              </div>
              <div style={{ color: "#6d89a3", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {abbr} · {currentPts} pts · proj {projPts}
              </div>
            </div>
            <div style={{ color: simClinched ? "#35e3a0" : simEliminated ? "#e05050" : oddsColor(playoff), fontSize: simClinched || simEliminated ? 11 : 16, fontWeight: 900, fontFamily: "'DM Mono',monospace" }}>
              {simClinched ? "CLINCHED" : simEliminated ? "ELIMINATED" : fmtPct(playoff)}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            {[
              ["GP", team.gamesPlayed ?? "—"],
              ["W", team.wins ?? "—"],
              ["Proj", projPts],
              ["Cup", fmtPct(sim.cupOdds ?? 0)],
            ].map(([label, value]) => (
              <div key={label} style={{ borderRadius: 12, border: "1px solid #162736", background: "var(--bg-card)", padding: "8px 10px", textAlign: "center" }}>
                <div style={{ color: "#5f7b95", fontSize: 9, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
                <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 800, marginTop: 4 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Division card ─────────────────────────────────────────────────────────────

function DivisionCard({ divName, teams, simResults }) {
  return (
    <div style={CARD}>
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-strong)",
          background: "#060d14",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-secondary)",
            fontFamily: "'DM Mono',monospace",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {divName} Division
        </span>
      </div>
      <ColHeaderRow />
      {teams.map((team) => (
        <TeamRow key={getAbbr(team)} team={team} simResults={simResults} />
      ))}
    </div>
  );
}

// ── Conference card (used in Conference view) ─────────────────────────────────

function ConferenceCard({ confName, teams, simResults }) {
  return (
    <div style={CARD}>
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-strong)",
          background: "#060d14",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "#2fb4ff",
            fontFamily: "'DM Mono',monospace",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          {confName} Conference
        </span>
      </div>
      <ColHeaderRow />
      {teams.map((team, i) => (
        <TeamRow
          key={getAbbr(team)}
          team={team}
          simResults={simResults}
          cutlineAfter={i === 7}
        />
      ))}
    </div>
  );
}

// ── Views ─────────────────────────────────────────────────────────────────────

const CONF_ORDER = [
  { name: "Eastern", divisions: ["Atlantic", "Metropolitan"] },
  { name: "Western", divisions: ["Central", "Pacific"] },
];

function DivisionView({ divisionMap, simResults }) {
  return (
    <div>
      {CONF_ORDER.map(({ name, divisions }) => (
        <div key={name} style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#2fb4ff",
                fontFamily: "'DM Mono',monospace",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                whiteSpace: "nowrap",
              }}
            >
              {name} Conference
            </span>
            <div
              style={{
                flex: 1,
                height: 1,
                background: "linear-gradient(90deg, rgba(47,180,255,0.38), transparent)",
              }}
            />
          </div>
          <div className="conf-grid">
            {divisions.map((div) => (
              <DivisionCard
                key={div}
                divName={div}
                teams={divisionMap[div] || []}
                simResults={simResults}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConferenceView({ conferenceMap, simResults }) {
  return (
    <div className="conf-grid">
      {["Eastern", "Western"].map((conf) => (
        <ConferenceCard
          key={conf}
          confName={conf}
          teams={conferenceMap[conf] || []}
          simResults={simResults}
        />
      ))}
    </div>
  );
}

function LeagueView({ sortedStandings, simResults }) {
  return (
    <div style={CARD}>
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-strong)",
          background: "#060d14",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-secondary)",
            fontFamily: "'DM Mono',monospace",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          League Standings
        </span>
      </div>
      <ColHeaderRow />
      {sortedStandings.map((team, i) => (
        <TeamRow
          key={getAbbr(team)}
          team={team}
          simResults={simResults}
          cutlineAfter={i === 7 || i === 15 || i === 23}
        />
      ))}
    </div>
  );
}

// ── Filter toggle ─────────────────────────────────────────────────────────────

function FilterToggle({ filter, setFilter }) {
  const options = ["division", "conference", "league"];
  return (
    <div
      style={{
        display: "flex",
        gap: 3,
        background: "#060d14",
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
        padding: 3,
      }}
    >
      {options.map((f) => {
        const active = f === filter;
        return (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 12px",
              borderRadius: 7,
              border: active ? "1px solid #2fb4ff" : "1px solid transparent",
              background: active ? "#1a2d42" : "transparent",
              color: active ? "#9fd8ff" : "#4a6a88",
              fontSize: 10,
              fontFamily: "'DM Mono',monospace",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {f}
          </button>
        );
      })}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  const items = [
    { color: "#35e3a0", label: ">85% — Very likely" },
    { color: "#2fb4ff", label: "60–85% — Likely" },
    { color: "#f0c040", label: "35–60% — Bubble" },
    { color: "#ff8d9b", label: "15–35% — Long shot" },
    { color: "#3a4a5a", label: "<15% — Near eliminated" },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 22 }}>
      {items.map(({ color, label }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
          <span
            style={{
              fontSize: 10,
              color: "var(--text-secondary)",
              fontFamily: "'DM Mono',monospace",
            }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function PlayoffOddsClient({ standings, simResults }) {
  const [filter, setFilter] = useState("division");

  const { divisionMap, conferenceMap, sortedStandings } = useMemo(() => {
    const divMap = {};
    const confMap = {};
    const cmp = (a, b) => (b.points || 0) - (a.points || 0) || (b.wins || 0) - (a.wins || 0);

    for (const team of standings) {
      const div = team.divisionName || "Unknown";
      const conf = team.conferenceName || "Unknown";
      if (!divMap[div]) divMap[div] = [];
      divMap[div].push(team);
      if (!confMap[conf]) confMap[conf] = [];
      confMap[conf].push(team);
    }
    for (const arr of [...Object.values(divMap), ...Object.values(confMap)]) {
      arr.sort(cmp);
    }
    return {
      divisionMap: divMap,
      conferenceMap: confMap,
      sortedStandings: [...standings].sort(cmp),
    };
  }, [standings]);

  return (
    <div className="playoff-page-shell" style={{ minHeight: "100vh", background: "var(--bg-primary)", padding: "28px 20px 64px" }}>
      <style>{`
        .team-grid {
          display: grid;
          grid-template-columns: ${GRID_DESKTOP};
          align-items: center;
          gap: 0 8px;
        }
        .conf-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        @media (max-width: 900px) {
          .conf-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 700px) {
          .team-grid { grid-template-columns: ${GRID_MOBILE}; }
          .hide-sm { display: none; }
        }
        @media (max-width: 640px) {
          .playoff-page-shell {
            padding: 18px 12px 36px !important;
          }
        }
        @media (max-width: 560px) {
          .team-grid-desktop {
            display: none !important;
          }
          .team-mobile-card {
            display: block !important;
          }
        }
      `}</style>

      <div style={{ maxWidth: 1360, margin: "0 auto" }}>
        {/* Page header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 20,
            marginBottom: 26,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1
              style={{
                color: "var(--text-primary)",
                fontFamily: "'Barlow Condensed',sans-serif",
                fontSize: 34,
                fontWeight: 900,
                margin: 0,
                letterSpacing: "-0.5px",
              }}
            >
              NHL Playoff Odds
            </h1>
            <p
              style={{
                color: "var(--text-secondary)",
                fontFamily: "'DM Mono',monospace",
                fontSize: 11,
                margin: "6px 0 0",
                letterSpacing: "0.04em",
              }}
            >
              Monte Carlo simulation · 20,000 runs · updates hourly · top 3 per division + 2 wild cards per conference
            </p>
          </div>
          <FilterToggle filter={filter} setFilter={setFilter} />
        </div>

        {/* Content */}
        {filter === "division" && (
          <DivisionView divisionMap={divisionMap} simResults={simResults} />
        )}
        {filter === "conference" && (
          <ConferenceView conferenceMap={conferenceMap} simResults={simResults} />
        )}
        {filter === "league" && (
          <LeagueView sortedStandings={sortedStandings} simResults={simResults} />
        )}

        <Legend />
      </div>
    </div>
  );
}
