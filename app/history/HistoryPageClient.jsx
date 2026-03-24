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
  background: "#05090f",
  minHeight: "100vh",
  padding: "32px 24px 60px",
  maxWidth: 1280,
  margin: "0 auto",
};

const CARD = {
  background: "#091017",
  border: "1px solid #17283b",
  borderRadius: 24,
  padding: 24,
};

const MONO = { fontFamily: "'DM Mono',monospace" };

const LABEL_STYLE = {
  ...MONO,
  fontSize: 10,
  color: "#5e7b98",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
};

const INPUT_STYLE = {
  width: "100%",
  background: "#091017",
  border: "1px solid #17283b",
  borderRadius: 12,
  padding: "10px 16px",
  color: "#eff8ff",
  ...MONO,
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const CHART_TOOLTIP = {
  background: "#0b1621",
  border: "1px solid #17283b",
  borderRadius: 10,
  padding: "10px 14px",
  color: "#eff8ff",
  fontSize: 12,
  ...MONO,
};

const SECTION_TITLE = {
  ...MONO,
  fontSize: 10,
  color: "#5e7b98",
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
        WAR Total: <span style={{ color: "#eff8ff", fontWeight: 700 }}>{fmt(total, 2)}</span>
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
            background: "#091017",
            border: "1px solid #17283b",
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
                borderBottom: "1px solid #17283b",
                padding: "10px 16px",
                color: "#eff8ff",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 13,
                fontFamily: "'DM Mono',monospace",
                gap: 10,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#0d1926"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span>{p.full_name}</span>
              <span style={{ color: "#5e7b98", fontSize: 11 }}>
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

function PlayerHeader({ player }) {
  const teamColor = TEAM_COLOR[player.team] || "#2fb4ff";
  const pct = player.percentiles || {};

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
        {player.headshot_url && (
          <img
            src={player.headshot_url}
            alt={player.full_name}
            width={80}
            height={80}
            style={{ borderRadius: 16, objectFit: "cover", flexShrink: 0, border: `2px solid ${teamColor}44` }}
          />
        )}
        <div>
          <div style={{ ...MONO, fontSize: 10, color: teamColor, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>
            {player.team} · #{player.jersey} · {player.position}
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#eff8ff", lineHeight: 1.1 }}>
            {player.full_name}
          </div>
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
              <div style={{ fontSize: 22, fontWeight: 900, color: "#eff8ff" }}>{fmt(player.overall_rating, 1)}</div>
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
                <div style={{ ...MONO, fontSize: 10, color: "#5e7b98", width: 72 }}>{label}</div>
                <div style={{ flex: 1, background: "#0d1926", borderRadius: 4, height: 6 }}>
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
          <tr style={{ background: "#3a5570" }}>
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
                  borderBottom: "1px solid #0d1a26",
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
              s.war_total == null ? "#5e7b98" : s.war_total >= 0 ? "#35e3a0" : "#ff8d9b";
            const tpg = toiPerGame(s.toi_total, s.gp);
            return (
              <tr
                key={s.season}
                style={{
                  background: isCurrentSeason
                    ? "rgba(47,180,255,0.06)"
                    : i % 2 === 0
                    ? "#091017"
                    : "#0b131d",
                  borderLeft: isCurrentSeason ? "2px solid #2fb4ff" : "2px solid transparent",
                }}
              >
                <td style={{ padding: "7px 12px", color: "#9fd8ff", fontWeight: 700, borderBottom: "1px solid #0d1a26" }}>
                  {s.season}
                </td>
                <td style={{ padding: "7px 12px", color: "#7daec8", borderBottom: "1px solid #0d1a26" }}>
                  {s.team || "—"}
                </td>
                {[s.gp, s.g, s.a, s.pts].map((v, ci) => (
                  <td key={ci} style={{ padding: "7px 12px", textAlign: "right", color: "#d0e8f8", borderBottom: "1px solid #0d1a26" }}>
                    {v ?? "—"}
                  </td>
                ))}
                <td style={{ padding: "7px 12px", textAlign: "right", color: "#2fb4ff", borderBottom: "1px solid #0d1a26" }}>
                  {fmt(s.pts_per_82, 1)}
                </td>
                <td style={{ padding: "7px 12px", textAlign: "right", color: "#ff8c42", borderBottom: "1px solid #0d1a26" }}>
                  {fmt(s.ixg, 2)}
                </td>
                <td style={{ padding: "7px 12px", textAlign: "right", color: "#d0e8f8", borderBottom: "1px solid #0d1a26" }}>
                  {fmtToi(tpg)}
                </td>
                <td style={{ padding: "7px 12px", textAlign: "right", color: warColor, fontWeight: s.war_total != null ? 700 : 400, borderBottom: "1px solid #0d1a26" }}>
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

// ── main component ────────────────────────────────────────────────────────────

export default function HistoryPageClient({ players }) {
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [playerData, setPlayerData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectedPlayerId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setPlayerData(null);

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
        <div style={{ fontSize: 32, fontWeight: 900, color: "#eff8ff", lineHeight: 1 }}>
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
        <div style={{ display: "grid", gap: 20 }}>
          {/* Section 1: Player header */}
          {playerData.player && <PlayerHeader player={playerData.player} />}

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
                      tick={{ fill: "#5e7b98", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fill: "#5e7b98", fontSize: 10, fontFamily: "'DM Mono',monospace" }} />
                    <Tooltip content={<ChartTooltipPts />} />
                    <ReferenceLine y={82} stroke="#35e3a0" strokeDasharray="4 3" strokeOpacity={0.5} />
                    <ReferenceLine y={50} stroke="#5e7b98" strokeDasharray="4 3" strokeOpacity={0.4} />
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
                    <span style={{ ...MONO, fontSize: 10, color: "#5e7b98" }}>1 pt/gm</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 20, height: 2, borderTop: "1px dashed #5e7b98" }} />
                    <span style={{ ...MONO, fontSize: 10, color: "#5e7b98" }}>~avg</span>
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
                      tick={{ fill: "#5e7b98", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fill: "#5e7b98", fontSize: 10, fontFamily: "'DM Mono',monospace" }} />
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
                    tick={{ fill: "#5e7b98", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                  />
                  <YAxis tick={{ fill: "#5e7b98", fontSize: 10, fontFamily: "'DM Mono',monospace" }} />
                  <Tooltip content={<ChartTooltipWar />} />
                  <ReferenceLine y={0} stroke="#5e7b98" strokeWidth={1} />
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
                    <span style={{ ...MONO, fontSize: 10, color: "#5e7b98" }}>{label}</span>
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
                    tick={{ fill: "#5e7b98", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                    label={{ value: "Age", position: "insideBottomRight", offset: -4, fill: "#5e7b98", fontSize: 10 }}
                  />
                  <YAxis tick={{ fill: "#5e7b98", fontSize: 10, fontFamily: "'DM Mono',monospace" }} />
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
              <div style={{ ...MONO, fontSize: 10, color: "#5e7b98", marginTop: 8 }}>
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

      {/* Empty state */}
      {!selectedPlayerId && !loading && (
        <div style={{ ...CARD, textAlign: "center", padding: "48px 24px", color: "#5e7b98", fontSize: 14, ...MONO }}>
          Search and select a player above to view their career history.
        </div>
      )}

      <style>{`
        @media (max-width: 780px) {
          .history-chart-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
