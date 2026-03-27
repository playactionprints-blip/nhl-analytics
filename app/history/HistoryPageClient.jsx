"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TEAM_COLOR } from "@/app/lib/nhlTeams";

// ── helpers ─────────────────────────────────────────────────────────────────

function fmt(val, digits = 0) {
  if (val == null || isNaN(val)) return "—";
  return Number(val).toFixed(digits);
}

function fmtToi(totalMinutes) {
  if (totalMinutes == null || isNaN(totalMinutes)) return "—";
  const mins = Math.floor(Number(totalMinutes));
  const secs = Math.round((Number(totalMinutes) - mins) * 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function toiPerGame(toi_total, gp) {
  if (!gp || !toi_total) return null;
  return toi_total / gp;
}

// ── styles ───────────────────────────────────────────────────────────────────

const SHELL = {
  background: "var(--bg-primary)",
  minHeight: "100vh",
  padding: "32px 24px 60px",
  maxWidth: 1280,
  margin: "0 auto",
};

const CARD = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-strong)",
  borderRadius: 24,
  padding: 24,
};

const MONO = { fontFamily: "'DM Mono',monospace" };

const LABEL_STYLE = {
  ...MONO,
  fontSize: 10,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
};

const INPUT_STYLE = {
  width: "100%",
  background: "var(--bg-card)",
  border: "1px solid var(--border-strong)",
  borderRadius: 12,
  padding: "10px 16px",
  color: "var(--text-primary)",
  ...MONO,
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const CHART_TOOLTIP = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  padding: "10px 14px",
  color: "var(--text-primary)",
  fontSize: 12,
  ...MONO,
};

const SECTION_TITLE = {
  ...MONO,
  fontSize: 10,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.14em",
  marginBottom: 14,
};

// ── custom recharts pieces ───────────────────────────────────────────────────

function ChartTooltipPts({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={CHART_TOOLTIP}>
      <div style={{ color: "#2fb4ff", fontWeight: 700, marginBottom: 6 }}>{d.season}</div>
      {d.team && <div style={{ color: "#7daec8" }}>Team: {d.team}</div>}
      <div>GP: {fmt(d.gp)}</div>
      <div>G: {fmt(d.g)} &nbsp;A: {fmt(d.a)}</div>
      <div>PTS: {fmt(d.pts)}</div>
      <div style={{ color: "#2fb4ff" }}>PTS/82: {fmt(d.pts_per_82, 1)}</div>
    </div>
  );
}

function ChartTooltipIxg({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={CHART_TOOLTIP}>
      <div style={{ color: "#ff8c42", fontWeight: 700, marginBottom: 6 }}>{d.season}</div>
      <div>GP: {fmt(d.gp)}</div>
      <div style={{ color: "#ff8c42" }}>ixG: {fmt(d.ixg, 2)}</div>
      <div>ixG/game: {d.gp ? fmt(d.ixg / d.gp, 3) : "—"}</div>
    </div>
  );
}

function ChartTooltipAge({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={CHART_TOOLTIP}>
      <div style={{ color: "#c084fc", fontWeight: 700, marginBottom: 6 }}>Age {d.age} — {d.season}</div>
      {d.team && <div style={{ color: "#7daec8" }}>Team: {d.team}</div>}
      <div>GP: {fmt(d.gp)}</div>
      <div>PTS: {fmt(d.pts)}</div>
      <div style={{ color: "#c084fc" }}>PTS/82: {fmt(d.pts_per_82, 1)}</div>
    </div>
  );
}

function ChartTooltipWar({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const total = (d.war_ev_off || 0) + (d.war_ev_def || 0) + (d.war_pp || 0) + (d.war_pk || 0);
  return (
    <div style={CHART_TOOLTIP}>
      <div style={{ color: "#35e3a0", fontWeight: 700, marginBottom: 6 }}>{d.season}</div>
      <div>EV Off: <span style={{ color: "#35e3a0" }}>{fmt(d.war_ev_off, 2)}</span></div>
      <div>EV Def: <span style={{ color: "#2fb4ff" }}>{fmt(d.war_ev_def, 2)}</span></div>
      <div>PP: <span style={{ color: "#f0c040" }}>{fmt(d.war_pp, 2)}</span></div>
      <div>PK: <span style={{ color: "#ff8d9b" }}>{fmt(d.war_pk, 2)}</span></div>
      <div style={{ borderTop: "1px solid #1e3143", marginTop: 6, paddingTop: 6 }}>
        WAR Total: <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{fmt(total, 2)}</span>
      </div>
    </div>
  );
}

function AgeDot({ cx, cy, payload, maxGp, isPeak }) {
  if (cx == null || cy == null) return null;
  const r = 3 + Math.min(7, (payload.gp / maxGp) * 7);
  if (isPeak) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={r + 3} fill="rgba(192,132,252,0.25)" />
        <circle cx={cx} cy={cy} r={r} fill="#c084fc" stroke="#fff" strokeWidth={1.5} />
        <text x={cx} y={cy - r - 5} textAnchor="middle" fontSize={10} fill="#c084fc" fontFamily="'DM Mono',monospace">★</text>
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={r} fill="#c084fc" fillOpacity={0.7} stroke="#8b5cf6" strokeWidth={1} />;
}

// ── player selector ──────────────────────────────────────────────────────────

function PlayerSelector({ players, onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return players.slice(0, 80);
    const q = query.toLowerCase();
    return players.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) ||
        p.team?.toLowerCase().includes(q) ||
        p.position?.toLowerCase().includes(q)
    ).slice(0, 80);
  }, [players, query]);

  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative", maxWidth: 480 }}>
      <input
        style={INPUT_STYLE}
        placeholder="Search player name or team…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--bg-card)",
            border: "1px solid var(--border-strong)",
            borderRadius: 12,
            zIndex: 50,
            maxHeight: 340,
            overflowY: "auto",
          }}
        >
          {filtered.map((p) => (
            <button
              key={p.player_id}
              type="button"
              onClick={() => {
                onSelect(p.player_id);
                setQuery(p.full_name);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-strong)",
                padding: "10px 16px",
                color: "var(--text-primary)",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 13,
                fontFamily: "'DM Mono',monospace",
                gap: 10,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span>{p.full_name}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                {p.team} · {p.position}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── player header card ────────────────────────────────────────────────────────

function PlayerHeader({ player, seasons = [] }) {
  const teamColor = TEAM_COLOR[player.team] || "#2fb4ff";
  const pct = player.percentiles || {};
  const isRetired = !player.off_rating && !player.overall_rating;
  const careerGP = seasons.reduce((s, r) => s + (r.gp || 0), 0);
  const careerG = seasons.reduce((s, r) => s + (r.g || 0), 0);
  const careerA = seasons.reduce((s, r) => s + (r.a || 0), 0);
  const careerPTS = seasons.reduce((s, r) => s + (r.pts || 0), 0);
  const peakPts82 = Math.max(0, ...seasons.map((s) => s.pts_per_82 || 0));

  return (
    <div
      style={{
        ...CARD,
        borderColor: teamColor + "55",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 24,
        alignItems: "start",
      }}
    >
      {/* Left: identity */}
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <img
          src={player.headshot_url || `https://assets.nhle.com/mugs/nhl/latest/${player.player_id}.png`}
          alt={player.full_name}
          width={80}
          height={80}
          style={{ borderRadius: 16, objectFit: "cover", flexShrink: 0, border: `2px solid ${teamColor}44` }}
        />
        <div>
          <div style={{ ...MONO, fontSize: 10, color: teamColor, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>
            {player.team} · #{player.jersey} · {player.position}
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1.1 }}>
            {player.full_name}
          </div>
          {isRetired ? (
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 12 }}>
              {[
                { label: "Career GP", value: careerGP },
                { label: "Career G", value: careerG },
                { label: "Career A", value: careerA },
                { label: "Career PTS", value: careerPTS },
                { label: "Peak PTS/82", value: peakPts82.toFixed(1) },
              ].map(({ label, value }) => (
                <div key={label} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)" }}>{value}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'DM Mono',monospace",
                    textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
              <div>
                <div style={LABEL_STYLE}>Off Rating</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#2fb4ff" }}>{fmt(player.off_rating, 1)}</div>
              </div>
              <div>
                <div style={LABEL_STYLE}>Def Rating</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "#35e3a0" }}>{fmt(player.def_rating, 1)}</div>
              </div>
              <div>
                <div style={LABEL_STYLE}>Overall</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)" }}>{fmt(player.overall_rating, 1)}</div>
              </div>
              {player.war_total != null && (
                <div>
                  <div style={LABEL_STYLE}>3yr WAR</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: player.war_total >= 0 ? "#35e3a0" : "#ff8d9b" }}>
                    {fmt(player.war_total, 2)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: percentile snapshot */}
      {Object.keys(pct).length > 0 && (
        <div style={{ display: "grid", gap: 8, minWidth: 140 }}>
          <div style={LABEL_STYLE}>Percentiles</div>
          {[
            ["RAPM Off", pct.rapm_off_pct, "#2fb4ff"],
            ["RAPM Def", pct.rapm_def_pct, "#35e3a0"],
            ["ixG/60", pct.ixg_60_pct, "#ff8c42"],
          ].map(([label, val, color]) =>
            val != null ? (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ ...MONO, fontSize: 10, color: "var(--text-muted)", width: 72 }}>{label}</div>
                <div style={{ flex: 1, background: "var(--bg-card-hover)", borderRadius: 4, height: 6 }}>
                  <div style={{ width: `${val}%`, height: "100%", background: color, borderRadius: 4 }} />
                </div>
                <div style={{ ...MONO, fontSize: 11, color, width: 28, textAlign: "right" }}>{Math.round(val)}</div>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}

// ── season stats table ────────────────────────────────────────────────────────

function SeasonTable({ seasons }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", ...MONO, fontSize: 12 }}>
        <thead>
          <tr style={{ background: "var(--bg-secondary)" }}>
            {["Season", "Team", "GP", "G", "A", "PTS", "PTS/82", "ixG", "TOI/gm", "WAR"].map((h) => (
              <th
                key={h}
                style={{
                  padding: "8px 12px",
                  textAlign: h === "Season" || h === "Team" ? "left" : "right",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "#b8d4e8",
                  fontWeight: 700,
                  borderBottom: "1px solid var(--border-color)",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {seasons.map((s, i) => {
            const isCurrentSeason = s.season === "25-26";
            const warColor =
              s.war_total == null ? "var(--text-muted)" : s.war_total >= 0 ? "#35e3a0" : "#ff8d9b";
            const tpg = toiPerGame(s.toi_total, s.gp);
            return (
              <tr
                key={s.season}
                style={{
                  background: isCurrentSeason
                    ? "rgba(47,180,255,0.06)"
                    : i % 2 === 0
                    ? "var(--bg-card)"
                    : "var(--bg-secondary)",
                  borderLeft: isCurrentSeason ? "2px solid #2fb4ff" : "2px solid transparent",
                }}
              >
                <td style={{ padding: "7px 12px", color: "#9fd8ff", fontWeight: 700, borderBottom: "1px solid var(--border-color)" }}>
                  {s.season}
                </td>
                <td style={{ padding: "7px 12px", color: "#7daec8", borderBottom: "1px solid var(--border-color)" }}>
                  {s.team || "—"}
                </td>
                {[s.gp, s.g, s.a, s.pts].map((v, ci) => (
                  <td key={ci} style={{ padding: "7px 12px", textAlign: "right", color: "#d0e8f8", borderBottom: "1px solid var(--border-color)" }}>
                    {v ?? "—"}
                  </td>
                ))}
                <td style={{ padding: "7px 12px", textAlign: "right", color: "#2fb4ff", borderBottom: "1px solid var(--border-color)" }}>
                  {fmt(s.pts_per_82, 1)}
                </td>
                <td style={{ padding: "7px 12px", textAlign: "right", color: "#ff8c42", borderBottom: "1px solid var(--border-color)" }}>
                  {fmt(s.ixg, 2)}
                </td>
                <td style={{ padding: "7px 12px", textAlign: "right", color: "#d0e8f8", borderBottom: "1px solid var(--border-color)" }}>
                  {fmtToi(tpg)}
                </td>
                <td style={{ padding: "7px 12px", textAlign: "right", color: warColor, fontWeight: s.war_total != null ? 700 : 400, borderBottom: "1px solid var(--border-color)" }}>
                  {s.war_total != null ? fmt(s.war_total, 2) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── historical season card ────────────────────────────────────────────────────

// Color by total WAR value (for war_total badge and stat boxes)
function warColor(val) {
  if (val == null) return "rgba(255,255,255,0.25)";
  if (val > 1.5) return "#35e3a0";
  if (val > 0.5) return "#2fb4ff";
  if (val >= 0) return "#f0c040";
  return "#ff6b6b";
}

// Color by PP/PK/Shooting WAR value (smaller scale)
function ppWarColor(val) {
  if (val == null) return "rgba(255,255,255,0.25)";
  if (val > 0.5) return "#35e3a0";
  if (val > 0.2) return "#2fb4ff";
  if (val >= 0) return "#f0c040";
  return "#ff6b6b";
}

// Color by percentile rank 0-100 — matches PlayerCard pc() function
function pc(v) {
  if (v == null) return "#3a5570";
  if (v >= 80) return "#35e3a0";
  if (v >= 60) return "#2fb4ff";
  if (v >= 40) return "#f0c040";
  return "#ff6b6b";
}

function HistoricalSeasonCard({ player, seasons, birthYear }) {
  const availableSeasons = (seasons || [])
    .filter((s) => s.gp > 0)
    .map((s) => s.season)
    .sort((a, b) => b.localeCompare(a));

  const [selectedSeason, setSelectedSeason] = useState(availableSeasons[0] || null);

  const season = (seasons || []).find((s) => s.season === selectedSeason);
  if (!season) return null;

  const startYear = 2000 + parseInt(selectedSeason.split("-")[0]);
  const age = birthYear ? startYear - birthYear : null;
  const accent = TEAM_COLOR[season.team] || TEAM_COLOR[player?.team] || "#2fb4ff";

  // Peak WAR values across career for bar scaling
  const peakPP = Math.max(0.01, ...seasons.map((s) => Math.abs(s.war_pp || 0)));
  const peakPK = Math.max(0.01, ...seasons.map((s) => Math.abs(s.war_pk || 0)));
  const peakShoot = Math.max(0.01, ...seasons.map((s) => Math.abs(s.war_shooting || 0)));

  const pts82 = season.pts_per_82;

  const seasonsWithWar = seasons.filter((s) => s.war_total != null);
  const avgCareerWAR =
    seasonsWithWar.length > 0
      ? seasonsWithWar.reduce((s, r) => s + r.war_total, 0) / seasonsWithWar.length
      : null;
  const bestPts82 = Math.max(0, ...seasons.map((s) => s.pts_per_82 || 0));

  const warTrendData = seasons
    .filter((s) => s.war_total != null)
    .map((s) => ({ season: s.season, war_total: s.war_total }));

  const ptsTrendData = seasons
    .filter((s) => s.pts_per_82 != null)
    .map((s) => ({ season: s.season, pts_per_82: s.pts_per_82 }));

  // WAR badge: prefer percentile, fall back to raw
  const warBadgePct = season.war_total_pct;
  const warBadgeRaw = season.war_total;
  const showWarBadge = warBadgePct != null || warBadgeRaw != null;

  // Per-60 computations (toi_total is in minutes)
  const toi60 = (season.toi_total || 0) / 60;
  const goals60 = toi60 > 0 ? (season.g || 0) / toi60 : null;
  const pts60   = toi60 > 0 ? (season.pts || 0) / toi60 : null;
  const ixg60   = toi60 > 0 ? (season.ixg || 0) / toi60 : null;

  // Approximate percentile from raw value vs league avg/elite benchmarks
  const scalePct = (val, avg, elite) =>
    val == null ? null : Math.min(100, Math.max(0, ((val - avg / 2) / (elite - avg / 2)) * 100));

  // PP/PK eligibility — use toi data when available, fall back to WAR signal
  const ppPerGame = (season.toi_pp || 0) / (season.gp || 1);
  const pkPerGame = (season.toi_pk || 0) / (season.gp || 1);
  const hasPP = season.pp_war_pct != null || ppPerGame >= 0.5 || (season.war_pp != null && season.war_pp !== 0);
  const hasPK = season.pk_war_pct != null || pkPerGame >= 0.17 || (season.war_pk != null && season.war_pk !== 0);

  // WAR Components (matches PlayerCard warTiles layout)
  const warTiles = [
    { label: "EV OFF",  pct: season.rapm_off_pct,              raw: null,           peak: null,      na: false },
    { label: "EV DEF",  pct: season.rapm_def_pct,              raw: null,           peak: null,      na: false },
    { label: "PP",      pct: hasPP ? season.pp_war_pct : null, raw: hasPP ? season.war_pp : null, peak: peakPP, na: !hasPP },
    { label: "PK",      pct: hasPK ? season.pk_war_pct : null, raw: hasPK ? season.war_pk : null, peak: peakPK, na: !hasPK },
    { label: "FINISH",  pct: season.war_total_pct,             raw: null,           peak: null,      na: false },
  ];

  // Production bars (matches PlayerCard productionBars layout)
  const prodBars = [
    { label: "Goals / 60", pct: season.goals_pct ?? scalePct(goals60, 0.20, 0.70) },
    { label: "Pts / 60",   pct: season.pts82_pct  ?? scalePct(pts60,   0.60, 1.80) },
    { label: "ixG / 60",   pct: season.ixg_pct    ?? scalePct(ixg60,   0.20, 0.60) },
    { label: "WAR Total",  pct: season.war_total_pct },
  ];

  // Context bars — raw WAR components
  const contextBars = [
    { label: "PP WAR",      pct: season.pp_war_pct, raw: season.war_pp,       peak: peakPP    },
    { label: "PK WAR",      pct: season.pk_war_pct, raw: season.war_pk,       peak: peakPK    },
    { label: "Shooting WAR",pct: null,              raw: season.war_shooting, peak: peakShoot },
  ];

  return (
    <div
      style={{
        background: "#05090f",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 24,
        overflow: "hidden",
        color: "#eff8ff",
        fontFamily: "'Barlow Condensed', sans-serif",
      }}
    >
      {/* Accent bar */}
      <div style={{ height: 3, background: accent }} />

      {/* Header */}
      <div
        style={{
          background: `linear-gradient(135deg, ${accent}22 0%, rgba(9,16,23,0.96) 60%)`,
          padding: "20px 24px",
          display: "flex",
          gap: 20,
          alignItems: "center",
          flexWrap: "wrap",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Headshot */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            player?.headshot_url ||
            `https://assets.nhle.com/mugs/nhl/latest/${player?.player_id}.png`
          }
          alt={player?.full_name || "Player"}
          width={72}
          height={72}
          style={{
            borderRadius: 14,
            objectFit: "cover",
            flexShrink: 0,
            border: `2px solid ${accent}55`,
          }}
        />

        {/* Identity */}
        <div style={{ flex: 1, minWidth: 160 }}>
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              color: accent,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            {season.team || player?.team} · {player?.position}
            {age ? ` · Age ${age}` : ""}
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: "#eff8ff", lineHeight: 1.1 }}>
            {player?.full_name}
          </div>
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: "rgba(255,255,255,0.45)",
              marginTop: 4,
            }}
          >
            {selectedSeason?.toUpperCase()} SEASON
          </div>
        </div>

        {/* Stat boxes */}
        <div style={{ display: "flex", gap: 16, flexShrink: 0 }}>
          {[
            { label: "GP", value: season.gp ?? "—" },
            { label: "G", value: season.g ?? "—" },
            { label: "A", value: season.a ?? "—" },
            { label: "PTS", value: season.pts ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#eff8ff" }}>{value}</div>
              <div
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  color: "rgba(255,255,255,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  marginTop: 2,
                }}
              >
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* WAR badge */}
        {showWarBadge && (
          <div
            style={{
              background: "rgba(9,16,23,0.8)",
              border: `1px solid ${(warBadgePct != null ? pc(warBadgePct) : warColor(warBadgeRaw))}44`,
              borderRadius: 12,
              padding: "10px 16px",
              textAlign: "center",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 9,
                color: "rgba(255,255,255,0.35)",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              {warBadgePct != null ? "WAR Pctile" : "WAR"}
            </div>
            {warBadgePct != null ? (
              <div style={{ fontSize: 22, fontWeight: 900, color: pc(warBadgePct) }}>
                {Math.round(warBadgePct)}
                <span style={{ fontSize: 12, fontWeight: 400 }}>th</span>
              </div>
            ) : (
              <div style={{ fontSize: 22, fontWeight: 900, color: warColor(warBadgeRaw) }}>
                {warBadgeRaw >= 0 ? "+" : ""}{fmt(warBadgeRaw, 2)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Season selector row */}
      <div
        style={{
          padding: "10px 24px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: 10,
            color: "rgba(255,255,255,0.35)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          Season
        </span>
        <select
          value={selectedSeason}
          onChange={(e) => setSelectedSeason(e.target.value)}
          style={{
            background: "#091017",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "#eff8ff",
            padding: "6px 12px",
            fontSize: 12,
            fontFamily: "'DM Mono', monospace",
            cursor: "pointer",
            outline: "none",
          }}
        >
          {availableSeasons.map((s) => (
            <option key={s} value={s}>
              {s.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* Body — two columns */}
      <div
        className="season-card-body"
        style={{ display: "grid", gridTemplateColumns: "55% 45%", gap: 0, padding: 24 }}
      >
        {/* LEFT: WAR components + Production */}
        <div style={{ paddingRight: 24, borderRight: "1px solid rgba(255,255,255,0.06)" }}>
          {/* WAR Components */}
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8, fontFamily: "'DM Mono',monospace" }}>
            WAR Components
          </div>

          {/* WAR Component bars — PlayerCard-style inline layout */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 18 }}>
            {warTiles.map((tile) => {
              const isPct = tile.pct != null;
              const hasRaw = tile.raw != null;
              const barW = tile.na ? 0
                : isPct ? tile.pct
                : (hasRaw && tile.peak)
                  ? Math.min(100, Math.max(0, (Math.abs(tile.raw) / tile.peak) * 100))
                  : 0;
              const tileColor = tile.na
                ? "rgba(255,255,255,0.2)"
                : isPct ? pc(tile.pct)
                : hasRaw ? ppWarColor(tile.raw)
                : "rgba(255,255,255,0.2)";
              const tileDisplay = tile.na ? "N/A"
                : isPct ? Math.round(tile.pct)
                : hasRaw ? (tile.raw >= 0 ? `+${fmt(tile.raw, 2)}` : fmt(tile.raw, 2))
                : "\u2014";
              return (
                <div key={tile.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", width: 110, flexShrink: 0 }}>
                    {tile.label}
                  </span>
                  <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${barW}%`, background: tileColor, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: tileColor, width: 36, textAlign: "right", fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>
                    {tileDisplay}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "2px 0 14px" }} />

          {/* Production section label */}
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8, fontFamily: "'DM Mono',monospace" }}>
            Production
          </div>

          {/* Production bars */}
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 18 }}>
            {prodBars.map(({ label, pct }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", width: 110, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {label}
                </span>
                <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct ?? 0}%`, background: pc(pct), borderRadius: 2 }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: pc(pct), width: 36, textAlign: "right", fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>
                  {pct != null ? Math.round(pct) : "\u2014"}
                </span>
              </div>
            ))}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "2px 0 14px" }} />

          {/* Context & Deployment */}
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8, fontFamily: "'DM Mono',monospace" }}>
            Context &amp; Deployment
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
            {contextBars.map(({ label, pct, raw, peak }) => {
              const isPct = pct != null;
              const hasRaw = raw != null;
              const barW = isPct ? pct
                : (hasRaw && peak) ? Math.min(100, Math.max(0, (Math.abs(raw) / peak) * 100))
                : 0;
              const barColor = isPct ? pc(pct) : hasRaw ? ppWarColor(raw) : "rgba(255,255,255,0.2)";
              const barDisplay = isPct ? Math.round(pct)
                : hasRaw ? (raw >= 0 ? `+${fmt(raw, 2)}` : fmt(raw, 2))
                : "\u2014";
              return (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", width: 110, flexShrink: 0 }}>
                    {label}
                  </span>
                  <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${barW}%`, background: barColor, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: barColor, width: 36, textAlign: "right", fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>
                    {barDisplay}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", fontFamily: "'DM Mono',monospace", lineHeight: 1.6 }}>
            * Competition and teammate context not available for historical seasons.
          </div>
        </div>

        {/* RIGHT: Career context + trend charts */}
        <div style={{ paddingLeft: 24 }}>
          {/* Season vs career stat boxes */}
          <div
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 10,
              color: "rgba(255,255,255,0.35)",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              marginBottom: 12,
            }}
          >
            Season vs Career
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
            {[
              {
                label: "This Season WAR",
                value:
                  season.war_total != null
                    ? season.war_total >= 0
                      ? `+${fmt(season.war_total, 2)}`
                      : fmt(season.war_total, 2)
                    : "N/A",
                sub: avgCareerWAR != null ? `Avg ${fmt(avgCareerWAR, 2)}` : null,
                color: season.war_total != null ? warColor(season.war_total) : "rgba(255,255,255,0.25)",
              },
              {
                label: "PTS/82",
                value: pts82 != null ? fmt(pts82, 1) : "—",
                sub: bestPts82 > 0 ? `Best ${fmt(bestPts82, 1)}` : null,
                color: season.pts82_pct != null ? pc(season.pts82_pct) : "rgba(255,255,255,0.25)",
              },
              {
                label: "GP",
                value: season.gp ?? "—",
                sub: "of 82",
                color: "#eff8ff",
              },
            ].map(({ label, value, sub, color }) => (
              <div
                key={label}
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 9,
                    color: "rgba(255,255,255,0.3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 6,
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
                {sub && (
                  <div
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 9,
                      color: "rgba(255,255,255,0.28)",
                      marginTop: 4,
                    }}
                  >
                    {sub}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* WAR trend chart */}
          {warTrendData.length > 1 && (
            <>
              <div
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  color: "rgba(255,255,255,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  marginBottom: 6,
                }}
              >
                Career WAR Trend
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart
                  data={warTrendData}
                  margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="season"
                    tick={{ fill: "rgba(255,255,255,0.28)", fontSize: 9, fontFamily: "'DM Mono',monospace" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: "rgba(255,255,255,0.28)", fontSize: 9, fontFamily: "'DM Mono',monospace" }}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                  <Line
                    type="monotone"
                    dataKey="war_total"
                    stroke="#35e3a0"
                    strokeWidth={1.5}
                    dot={(dotProps) => {
                      const { cx, cy, payload } = dotProps;
                      if (cx == null || cy == null) return null;
                      const isSel = payload?.season === selectedSeason;
                      return (
                        <circle
                          key={`w-${payload.season}`}
                          cx={cx}
                          cy={cy}
                          r={isSel ? 5 : 2.5}
                          fill={isSel ? "#35e3a0" : "rgba(53,227,160,0.5)"}
                          stroke={isSel ? "#fff" : "none"}
                          strokeWidth={1.5}
                        />
                      );
                    }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}

          {/* PTS/82 trend chart */}
          {ptsTrendData.length > 1 && (
            <>
              <div
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  color: "rgba(255,255,255,0.35)",
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  marginBottom: 6,
                  marginTop: 16,
                }}
              >
                Career PTS/82 Trend
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart
                  data={ptsTrendData}
                  margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="season"
                    tick={{ fill: "rgba(255,255,255,0.28)", fontSize: 9, fontFamily: "'DM Mono',monospace" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: "rgba(255,255,255,0.28)", fontSize: 9, fontFamily: "'DM Mono',monospace" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="pts_per_82"
                    stroke="#2fb4ff"
                    strokeWidth={1.5}
                    dot={(dotProps) => {
                      const { cx, cy, payload } = dotProps;
                      if (cx == null || cy == null) return null;
                      const isSel = payload?.season === selectedSeason;
                      return (
                        <circle
                          key={`p-${payload.season}`}
                          cx={cx}
                          cy={cy}
                          r={isSel ? 5 : 2.5}
                          fill={isSel ? "#2fb4ff" : "rgba(47,180,255,0.5)"}
                          stroke={isSel ? "#fff" : "none"}
                          strokeWidth={1.5}
                        />
                      );
                    }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function HistoryPageClient({ players }) {
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [playerData, setPlayerData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [histTab, setHistTab] = useState("overview");

  useEffect(() => {
    if (!selectedPlayerId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setPlayerData(null);
    setHistTab("overview");

    fetch(`/api/history/player?id=${selectedPlayerId}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load player history");
        return r.json();
      })
      .then((d) => {
        if (!cancelled) { setPlayerData(d); setLoading(false); }
      })
      .catch((e) => {
        if (!cancelled) { setError(e.message || "Error loading player"); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [selectedPlayerId]);

  const warSeasons = useMemo(
    () => (playerData?.seasons || []).filter((s) => s.war_total != null),
    [playerData]
  );

  const ageSeasons = useMemo(
    () =>
      playerData?.birthYear
        ? (playerData.seasons || []).filter((s) => s.age != null && s.pts_per_82 != null && s.gp >= 10)
        : [],
    [playerData]
  );

  const peakAge = useMemo(() => {
    if (!ageSeasons.length) return null;
    return ageSeasons.reduce((best, s) =>
      s.pts_per_82 > (best?.pts_per_82 || 0) ? s : best
    , null)?.age;
  }, [ageSeasons]);

  const maxGp = useMemo(
    () => Math.max(1, ...ageSeasons.map((s) => s.gp || 0)),
    [ageSeasons]
  );

  const chartSeasons = useMemo(
    () => (playerData?.seasons || []).filter((s) => s.pts_per_82 != null || s.ixg != null),
    [playerData]
  );

  return (
    <div style={SHELL}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ ...MONO, fontSize: 10, color: "#2fb4ff", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
          NHL Analytics · History
        </div>
        <div style={{ fontSize: 32, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1 }}>
          Historical Player Cards
        </div>
        <div style={{ color: "#7daec8", fontSize: 14, marginTop: 8, maxWidth: 640 }}>
          Explore career trajectories, season-by-season production, WAR components, and age curves for every skater.
        </div>
      </div>

      {/* Player selector */}
      <div style={{ ...CARD, marginBottom: 24 }}>
        <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>Select Player</div>
        <PlayerSelector players={players} onSelect={setSelectedPlayerId} />
      </div>

      {/* Loading / error */}
      {loading && (
        <div style={{ ...CARD, color: "#7daec8", fontSize: 14 }}>
          Loading player history…
        </div>
      )}
      {error && (
        <div style={{ ...CARD, color: "#ff8d9b", fontSize: 14 }}>{error}</div>
      )}

      {/* Player data */}
      {playerData && !loading && (
        <>
          {/* Tab row */}
          <div
            style={{
              display: "flex",
              gap: 4,
              marginBottom: 16,
              borderBottom: "1px solid var(--border-color)",
              paddingBottom: 0,
            }}
          >
            {[
              { key: "overview", label: "Career Overview" },
              { key: "season-card", label: "Season Card" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setHistTab(tab.key)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: histTab === tab.key ? "2px solid #2fb4ff" : "2px solid transparent",
                  color: histTab === tab.key ? "#2fb4ff" : "var(--text-secondary)",
                  fontSize: 12,
                  fontFamily: "'DM Mono', monospace",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "10px 16px",
                  cursor: "pointer",
                  marginBottom: -1,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {histTab === "overview" && (
            <div style={{ display: "grid", gap: 20 }}>
              {/* Section 1: Player header */}
              {playerData.player && <PlayerHeader player={playerData.player} seasons={playerData.seasons || []} />}

              {/* Section 2: Career charts (two-column grid) */}
              {chartSeasons.length > 0 && (
                <div
                  style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 20 }}
                  className="history-chart-grid"
                >
                  {/* Chart A: Points/82 */}
                  <div style={CARD}>
                    <div style={SECTION_TITLE}>Points per 82 Games</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={chartSeasons} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#0d1a26" />
                        <XAxis
                          dataKey="season"
                          tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }} />
                        <Tooltip content={<ChartTooltipPts />} />
                        <ReferenceLine y={82} stroke="#35e3a0" strokeDasharray="4 3" strokeOpacity={0.5} />
                        <ReferenceLine y={50} stroke="var(--text-muted)" strokeDasharray="4 3" strokeOpacity={0.4} />
                        <Line
                          type="monotone"
                          dataKey="pts_per_82"
                          stroke="#2fb4ff"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#2fb4ff", strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 20, height: 2, background: "#35e3a0", borderTop: "1px dashed #35e3a0" }} />
                        <span style={{ ...MONO, fontSize: 10, color: "var(--text-muted)" }}>1 pt/gm</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 20, height: 2, borderTop: "1px dashed var(--text-muted)" }} />
                        <span style={{ ...MONO, fontSize: 10, color: "var(--text-muted)" }}>~avg</span>
                      </div>
                    </div>
                  </div>

                  {/* Chart B: ixG */}
                  <div style={CARD}>
                    <div style={SECTION_TITLE}>Individual Expected Goals</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={chartSeasons} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#0d1a26" />
                        <XAxis
                          dataKey="season"
                          tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                          interval="preserveStartEnd"
                        />
                        <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }} />
                        <Tooltip content={<ChartTooltipIxg />} />
                        <Line
                          type="monotone"
                          dataKey="ixg"
                          stroke="#ff8c42"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#ff8c42", strokeWidth: 0 }}
                          activeDot={{ r: 5 }}
                          connectNulls
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Section 3: WAR components */}
              {warSeasons.length > 0 && (
                <div style={CARD}>
                  <div style={SECTION_TITLE}>WAR Components (Recent Seasons)</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={warSeasons} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#0d1a26" />
                      <XAxis
                        dataKey="season"
                        tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                      />
                      <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }} />
                      <Tooltip content={<ChartTooltipWar />} />
                      <ReferenceLine y={0} stroke="var(--text-muted)" strokeWidth={1} />
                      <Bar dataKey="war_ev_off" stackId="war" fill="#35e3a0" name="EV Off" />
                      <Bar dataKey="war_ev_def" stackId="war" fill="#2fb4ff" name="EV Def" />
                      <Bar dataKey="war_pp" stackId="war" fill="#f0c040" name="PP" />
                      <Bar dataKey="war_pk" stackId="war" fill="#ff8d9b" name="PK" />
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
                    {[["EV Off", "#35e3a0"], ["EV Def", "#2fb4ff"], ["PP", "#f0c040"], ["PK", "#ff8d9b"]].map(([label, color]) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                        <span style={{ ...MONO, fontSize: 10, color: "var(--text-muted)" }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 4: Age curve */}
              {ageSeasons.length > 1 && (
                <div style={CARD}>
                  <div style={SECTION_TITLE}>Age Curve — Production by Age</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={ageSeasons} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#0d1a26" />
                      <XAxis
                        dataKey="age"
                        type="number"
                        domain={["dataMin - 1", "dataMax + 1"]}
                        tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                        label={{ value: "Age", position: "insideBottomRight", offset: -4, fill: "var(--text-muted)", fontSize: 10 }}
                      />
                      <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }} />
                      <Tooltip content={<ChartTooltipAge />} />
                      <Line
                        type="monotone"
                        dataKey="pts_per_82"
                        stroke="#c084fc"
                        strokeWidth={2}
                        dot={(props) => (
                          <AgeDot
                            key={`${props.cx}-${props.cy}`}
                            {...props}
                            maxGp={maxGp}
                            isPeak={props.payload?.age === peakAge}
                          />
                        )}
                        activeDot={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                  <div style={{ ...MONO, fontSize: 10, color: "var(--text-muted)", marginTop: 8 }}>
                    Dot size ∝ games played · ★ peak season
                  </div>
                </div>
              )}

              {/* Section 5: Season stats table */}
              {playerData.seasons.length > 0 && (
                <div style={CARD}>
                  <div style={SECTION_TITLE}>Season-by-Season Stats</div>
                  <SeasonTable seasons={playerData.seasons} />
                </div>
              )}
            </div>
          )}

          {/* Season Card tab */}
          {histTab === "season-card" && (
            <HistoricalSeasonCard
              player={playerData.player}
              seasons={playerData.seasons}
              birthYear={playerData.birthYear}
            />
          )}
        </>
      )}

      {/* Empty state */}
      {!selectedPlayerId && !loading && (
        <div style={{ ...CARD, textAlign: "center", padding: "48px 24px", color: "var(--text-muted)", fontSize: 14, ...MONO }}>
          Search and select a player above to view their career history.
        </div>
      )}

      <style>{`
        @media (max-width: 780px) {
          .history-chart-grid {
            grid-template-columns: 1fr !important;
          }
          .season-card-body {
            grid-template-columns: 1fr !important;
          }
          .season-card-body > div:first-child {
            padding-right: 0 !important;
            border-right: none !important;
            padding-bottom: 24px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
          }
          .season-card-body > div:last-child {
            padding-left: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}
