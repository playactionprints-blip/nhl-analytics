export const metadata = {
  title: "NHL Playoff Odds — NHL Analytics",
  description: "Live NHL standings with Monte Carlo playoff odds for all 32 teams.",
};

export const revalidate = 3600;

import { TEAM_COLOR, logoUrl } from "@/app/lib/nhlTeams";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// Box-Muller transform for normally-distributed random values
function gaussianSample(mean, stddev) {
  if (stddev <= 0) return mean;
  let u1;
  do { u1 = Math.random(); } while (u1 === 0);
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * stddev;
}

// ── Monte Carlo simulation ────────────────────────────────────────────────────
// NHL playoff format: top 3 per division + 2 wild cards per conference = 8 per conference.
function simulatePlayoffOdds(standings, numSims = 20000) {
  const teamStats = standings.map((team) => {
    const remaining = Math.max(0, 82 - (team.gamesPlayed || 0));
    return {
      abbr: getAbbr(team),
      points: team.points || 0,
      remaining,
      meanAdditional: (team.pointPctg || 0) * 2 * remaining, // ppg * remaining
      stddev: Math.sqrt(remaining) * 0.85,
      conf: team.conferenceName || "",
      div: team.divisionName || "",
    };
  });

  // Pre-group by conference → division for fast inner-loop access
  const confDivGroups = {};
  for (const t of teamStats) {
    if (!confDivGroups[t.conf]) confDivGroups[t.conf] = {};
    if (!confDivGroups[t.conf][t.div]) confDivGroups[t.conf][t.div] = [];
    confDivGroups[t.conf][t.div].push(t);
  }
  // Pre-flatten conference team arrays for wild card step
  const confTeams = {};
  for (const [conf, divMap] of Object.entries(confDivGroups)) {
    confTeams[conf] = Object.values(divMap).flat();
  }

  const playoffCount = Object.fromEntries(teamStats.map((t) => [t.abbr, 0]));

  for (let sim = 0; sim < numSims; sim++) {
    // Project final points for every team
    const final = {};
    for (const t of teamStats) {
      const extra =
        t.remaining > 0
          ? Math.max(0, Math.min(t.remaining * 2, gaussianSample(t.meanAdditional, t.stddev)))
          : 0;
      final[t.abbr] = t.points + extra;
    }

    for (const [conf, divMap] of Object.entries(confDivGroups)) {
      const qualified = new Set();

      // Top 3 from each division
      for (const divTeams of Object.values(divMap)) {
        const sorted = [...divTeams].sort((a, b) => final[b.abbr] - final[a.abbr]);
        for (let i = 0; i < Math.min(3, sorted.length); i++) {
          qualified.add(sorted[i].abbr);
        }
      }

      // Wild cards: next 2 highest-point teams in conference not already in
      const wc = confTeams[conf]
        .filter((t) => !qualified.has(t.abbr))
        .sort((a, b) => final[b.abbr] - final[a.abbr]);
      for (let i = 0; i < Math.min(2, wc.length); i++) {
        qualified.add(wc[i].abbr);
      }

      for (const abbr of qualified) playoffCount[abbr]++;
    }
  }

  return Object.fromEntries(teamStats.map((t) => [t.abbr, playoffCount[t.abbr] / numSims]));
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function oddsColor(pct) {
  if (pct > 0.85) return "#35e3a0";
  if (pct > 0.60) return "#2fb4ff";
  if (pct > 0.35) return "#f0c040";
  if (pct > 0.15) return "#ff8d9b";
  return "#3a4a5a";
}

const COL_HEADERS = ["", "Team", "GP", "W", "L", "OTL", "PTS", "Playoff Odds"];
const GRID_COLS = "28px 1fr 32px 28px 28px 36px 40px 160px";

const colHeadStyle = {
  fontSize: 9,
  color: "#3a5a78",
  fontFamily: "'DM Mono',monospace",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  textAlign: "center",
  padding: "5px 0",
};

const statCellStyle = {
  fontSize: 12,
  color: "#7e98b2",
  fontFamily: "'DM Mono',monospace",
  textAlign: "center",
};

// ── Sub-components ────────────────────────────────────────────────────────────
function TeamRow({ team, oddsMap, rank }) {
  const abbr = getAbbr(team);
  const name = getName(team);
  const raw = oddsMap[abbr] ?? 0;
  const isClinched = !!team.clinchIndicator;
  const pct = isClinched ? Math.max(raw, 0.99) : raw;
  const color = oddsColor(pct);
  const displayPct = Math.min(99, Math.round(pct * 100));
  const isPlayoffSpot = rank <= 3; // top 3 in division get slightly accented row

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        alignItems: "center",
        gap: "0 10px",
        padding: "9px 16px",
        borderBottom: "1px solid #0c1520",
        background: isPlayoffSpot ? "rgba(47,180,255,0.03)" : "transparent",
      }}
    >
      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl(abbr)}
        alt={abbr}
        width={24}
        height={24}
        style={{ width: 24, height: 24, objectFit: "contain" }}
      />

      {/* Team name */}
      <div
        style={{
          color: TEAM_COLOR[abbr] ? "#eff8ff" : "#eff8ff",
          fontSize: 13,
          fontWeight: 700,
          fontFamily: "'Barlow Condensed',sans-serif",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {name}
        {isClinched && (
          <span
            title={`Clinched: ${team.clinchIndicator}`}
            style={{
              fontSize: 9,
              color: "#35e3a0",
              fontFamily: "'DM Mono',monospace",
              background: "rgba(53,227,160,0.12)",
              border: "1px solid rgba(53,227,160,0.3)",
              borderRadius: 4,
              padding: "1px 4px",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {team.clinchIndicator}
          </span>
        )}
      </div>

      {/* Stats */}
      <div style={statCellStyle}>{team.gamesPlayed ?? "—"}</div>
      <div style={statCellStyle}>{team.wins ?? "—"}</div>
      <div style={statCellStyle}>{team.losses ?? "—"}</div>
      <div style={statCellStyle}>{team.otLosses ?? "—"}</div>
      <div style={{ ...statCellStyle, color: "#eff8ff", fontWeight: 800 }}>
        {team.points ?? "—"}
      </div>

      {/* Odds bar + label */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <div
          style={{
            flex: 1,
            height: 7,
            background: "#0d1825",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min(100, pct * 100)}%`,
              height: "100%",
              background: `linear-gradient(90deg, ${color}66, ${color})`,
              borderRadius: 4,
            }}
          />
        </div>
        <div
          style={{
            fontSize: 11,
            fontFamily: "'DM Mono',monospace",
            color,
            fontWeight: 700,
            minWidth: 32,
            textAlign: "right",
          }}
        >
          {pct < 0.005 ? "<1%" : pct > 0.995 ? ">99%" : `${displayPct}%`}
        </div>
      </div>
    </div>
  );
}

function DivisionCard({ divName, teams, oddsMap }) {
  return (
    <div
      style={{
        background: "#091017",
        border: "1px solid #17283b",
        borderRadius: 20,
        overflow: "hidden",
      }}
    >
      {/* Division header */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #17283b",
          background: "#060d14",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#5a8aaa",
            fontFamily: "'DM Mono',monospace",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {divName} Division
        </span>
      </div>

      {/* Column headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLS,
          gap: "0 10px",
          padding: "4px 16px",
          borderBottom: "1px solid #0f1924",
        }}
      >
        {COL_HEADERS.map((h, i) => (
          <div
            key={i}
            style={{
              ...colHeadStyle,
              textAlign: i <= 1 ? "left" : "center",
            }}
          >
            {h}
          </div>
        ))}
      </div>

      {/* Team rows */}
      {teams.map((team, i) => (
        <TeamRow key={getAbbr(team)} team={team} oddsMap={oddsMap} rank={i + 1} />
      ))}
    </div>
  );
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchStandings() {
  try {
    const res = await fetch("https://api-web.nhle.com/v1/standings/now", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.standings) && data.standings.length > 0
      ? data.standings
      : null;
  } catch {
    return null;
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function PlayoffOddsPage() {
  const standings = await fetchStandings();

  if (!standings) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#05090f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#5a7a99",
          fontFamily: "'DM Mono',monospace",
          fontSize: 13,
        }}
      >
        Unable to load standings — NHL API unavailable. Please try again later.
      </div>
    );
  }

  const oddsMap = simulatePlayoffOdds(standings);

  // Group by division, sort by points then wins
  const divisionMap = {};
  for (const team of standings) {
    const div = team.divisionName || "Unknown";
    if (!divisionMap[div]) divisionMap[div] = [];
    divisionMap[div].push(team);
  }
  for (const div in divisionMap) {
    divisionMap[div].sort(
      (a, b) => (b.points || 0) - (a.points || 0) || (b.wins || 0) - (a.wins || 0)
    );
  }

  const conferences = [
    { name: "Eastern Conference", divisions: ["Atlantic", "Metropolitan"] },
    { name: "Western Conference", divisions: ["Central", "Pacific"] },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#05090f",
        padding: "28px 20px 64px",
      }}
    >
      <style>{`
        .playoff-conf-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        @media (max-width: 900px) { .playoff-conf-grid { grid-template-columns: 1fr; } }
      `}</style>

      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        {/* Page heading */}
        <div style={{ marginBottom: 30 }}>
          <h1
            style={{
              color: "#eff8ff",
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
              color: "#5a7a99",
              fontFamily: "'DM Mono',monospace",
              fontSize: 11,
              margin: "6px 0 0",
              letterSpacing: "0.04em",
            }}
          >
            Monte Carlo simulation · 20,000 runs · updates hourly · top 3 per division + 2 wild cards per conference
          </p>
        </div>

        {/* Conferences */}
        {conferences.map(({ name: confName, divisions }) => (
          <div key={confName} style={{ marginBottom: 34 }}>
            {/* Conference header */}
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
                {confName}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: "linear-gradient(90deg, rgba(47,180,255,0.4) 0%, transparent 100%)",
                }}
              />
            </div>

            {/* Division cards */}
            <div className="playoff-conf-grid">
              {divisions.map((divName) => (
                <DivisionCard
                  key={divName}
                  divName={divName}
                  teams={divisionMap[divName] || []}
                  oddsMap={oddsMap}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Legend */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 8 }}>
          {[
            { color: "#35e3a0", label: ">85% — Very likely" },
            { color: "#2fb4ff", label: "60–85% — Likely" },
            { color: "#f0c040", label: "35–60% — Bubble" },
            { color: "#ff8d9b", label: "15–35% — Long shot" },
            { color: "#3a4a5a", label: "<15% — Near eliminated" },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{ width: 10, height: 10, borderRadius: 3, background: color }}
              />
              <span
                style={{
                  fontSize: 10,
                  color: "#5a7a99",
                  fontFamily: "'DM Mono',monospace",
                }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
