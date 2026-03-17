"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip,
} from "recharts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const TEAM_COLOR = {
  ANA:"#F47A38",BOS:"#FFB81C",BUF:"#003087",CAR:"#CC0000",
  CBJ:"#002654",CGY:"#C8102E",CHI:"#CF0A2C",COL:"#6F263D",DAL:"#006847",
  DET:"#CE1126",EDM:"#FF4C00",FLA:"#C8102E",LAK:"#555555",MIN:"#154734",
  MTL:"#AF1E2D",NSH:"#FFB81C",NJD:"#CC0000",NYI:"#00539B",NYR:"#0038A8",
  OTT:"#C52032",PHI:"#F74902",PIT:"#CFC493",SEA:"#99D9D9",SJS:"#006D75",
  STL:"#002F87",TBL:"#002868",TOR:"#00205B",UTA:"#69B3E7",VAN:"#00843D",
  VGK:"#B4975A",WPG:"#041E42",WSH:"#C8102E",
};

function logoUrl(abbr) {
  return `https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg`;
}

function pctColor(v) {
  if (v >= 85) return "#00e5a0";
  if (v >= 60) return "#f0c040";
  if (v >= 40) return "#f08040";
  return "#e05050";
}

function fmtNum(v, digits = 1) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return Number(v).toFixed(digits);
}
function fmtInt(v) {
  if (v == null) return "—";
  return String(Math.round(Number(v)));
}
function fmtSigned(v, digits = 2) {
  if (v == null || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

// ── Player Search ─────────────────────────────────────────────────────────────
function PlayerPicker({ label, player, onSelect, accent = "#0080FF" }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const h = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase
        .from("players")
        .select("player_id,full_name,team,position,jersey,headshot_url,overall_rating,off_rating,def_rating,rapm_off,rapm_def,war_total,war_ev_off,war_ev_def,war_pp,gp,g,a,pts,percentiles")
        .ilike("full_name", `%${query.trim()}%`)
        .neq("position", "G")
        .order("overall_rating", { ascending: false, nullsFirst: false })
        .limit(12);
      setResults(data || []);
      setLoading(false);
    }, 150);
    return () => clearTimeout(h);
  }, [query]);

  function choose(p) {
    onSelect(p);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div style={{ flex: 1, minWidth: 240 }}>
      <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
      {player ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: `${TEAM_COLOR[player.team] || "#4a6a88"}18`, border: `1px solid ${TEAM_COLOR[player.team] || "#4a6a88"}44`, borderRadius: 10 }}>
          {player.headshot_url && <img src={player.headshot_url} alt={player.full_name} width={44} height={44} style={{ borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
          <img src={logoUrl(player.team)} alt={player.team} width={28} height={28} style={{ objectFit: "contain", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#e8f4ff", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "-0.3px" }}>{player.full_name}</div>
            <div style={{ fontSize: 10, color: "#5a7a99", fontFamily: "'DM Mono',monospace" }}>{player.team} · {player.position} · OVR {player.overall_rating != null ? Math.round(player.overall_rating) : "—"}</div>
          </div>
          <button onClick={() => onSelect(null)} style={{ background: "none", border: "none", color: "#3a5a78", cursor: "pointer", fontSize: 14, padding: 4 }}>✕</button>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <input
            type="text"
            placeholder="Search player name..."
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            style={{ width: "100%", padding: "12px 16px", background: "#0d1825", border: "1px solid #1e2d40", borderRadius: 10, color: "#e8f4ff", fontSize: 14, fontFamily: "'Barlow Condensed',sans-serif", outline: "none", boxSizing: "border-box" }}
          />
          {open && (results.length > 0 || loading) && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 99, background: "#0d1825", border: "1px solid #1e2d40", borderRadius: 10, overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.5)" }}>
              {loading && <div style={{ padding: "10px 14px", fontSize: 11, color: "#4a6a88", fontFamily: "'DM Mono',monospace" }}>Searching…</div>}
              {results.map(p => (
                <button key={p.player_id} onClick={() => choose(p)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "none", border: "none", borderBottom: "1px solid #142231", cursor: "pointer", textAlign: "left" }}>
                  <img src={logoUrl(p.team)} alt={p.team} width={22} height={22} style={{ objectFit: "contain" }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#c8dff0", fontFamily: "'Barlow Condensed',sans-serif" }}>{p.full_name}</div>
                    <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono',monospace" }}>{p.team} · {p.position}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stats Comparison Table ─────────────────────────────────────────────────────
const COMPARE_ROWS = [
  { label: "GP",          key: "gp",            fmt: fmtInt,   higherBetter: true },
  { label: "Goals",       key: "g",             fmt: fmtInt,   higherBetter: true },
  { label: "Assists",     key: "a",             fmt: fmtInt,   higherBetter: true },
  { label: "Points",      key: "pts",           fmt: fmtInt,   higherBetter: true },
  { label: "Pts/82",      key: "pts",           fmt: (v, p) => p?.gp > 0 ? fmtNum((v / p.gp) * 82, 0) : "—", higherBetter: true, derived: true },
  { label: "WAR3",        key: "war_total",     fmt: v => fmtNum(v, 2), higherBetter: true },
  { label: "Off Rating",  key: "off_rating",    fmt: fmtInt,   higherBetter: true, bold: true },
  { label: "Def Rating",  key: "def_rating",    fmt: fmtInt,   higherBetter: true, bold: true },
  { label: "OVR Rating",  key: "overall_rating",fmt: fmtInt,   higherBetter: true, bold: true },
  { label: "RAPM Off",    key: "rapm_off",      fmt: v => fmtSigned(v, 4), higherBetter: true },
  { label: "RAPM Def",    key: "rapm_def",      fmt: v => fmtSigned(v, 4), higherBetter: true },
  { label: "CF%",         key: "cf_pct",        fmt: v => fmtNum(v, 1), higherBetter: true },
  { label: "xGF%",        key: "xgf_pct",       fmt: v => fmtNum(v, 1), higherBetter: true },
  { label: "HDCF%",       key: "hdcf_pct",      fmt: v => fmtNum(v, 1), higherBetter: true },
  { label: "ixG",         key: "ixg",           fmt: v => fmtNum(v, 1), higherBetter: true },
  { label: "iCF",         key: "icf",           fmt: fmtInt,   higherBetter: true },
];

function getRowVal(row, player) {
  if (!player) return null;
  const raw = player[row.key];
  if (row.derived) {
    if (row.label === "Pts/82") return player.gp > 0 ? (player.pts / player.gp) * 82 : null;
  }
  return raw;
}

function CompareTable({ p1, p2 }) {
  const c1 = TEAM_COLOR[p1?.team] || "#0080FF";
  const c2 = TEAM_COLOR[p2?.team] || "#e05050";

  return (
    <div style={{ overflowX: "auto", border: "1px solid #1e2d40", borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#0a1520" }}>
            <th style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, color: "#3a5a78", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", borderBottom: "1px solid #1e2d40", width: "28%" }}>Stat</th>
            <th style={{ padding: "8px 14px", textAlign: "right", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", borderBottom: "1px solid #1e2d40", color: c1, width: "36%" }}>{p1?.full_name || "Player 1"}</th>
            <th style={{ padding: "8px 14px", textAlign: "right", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", borderBottom: "1px solid #1e2d40", color: c2, width: "36%" }}>{p2?.full_name || "Player 2"}</th>
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((row, i) => {
            const v1 = getRowVal(row, p1);
            const v2 = getRowVal(row, p2);
            const n1 = v1 != null ? Number(v1) : null;
            const n2 = v2 != null ? Number(v2) : null;
            const bothPresent = n1 != null && n2 != null;
            const p1Better = bothPresent && (row.higherBetter ? n1 > n2 : n1 < n2);
            const p2Better = bothPresent && (row.higherBetter ? n2 > n1 : n2 < n1);
            const bgColor = i % 2 === 0 ? "#080e17" : "#060b12";
            return (
              <tr key={row.label} style={{ background: bgColor, borderBottom: "1px solid #0a1218" }}>
                <td style={{ padding: "7px 14px", color: "#5a7a99", fontSize: 11, fontFamily: "'DM Mono',monospace", fontWeight: row.bold ? 700 : 400 }}>{row.label}</td>
                <td style={{ padding: "7px 14px", textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: p1Better ? 800 : 400, color: p1Better ? "#00e5a0" : p2Better ? "#4a6a88" : "#8899aa", fontSize: 13 }}>
                  {row.fmt(v1, p1)}
                  {p1Better && <span style={{ marginLeft: 4, fontSize: 9, color: "#00e5a0" }}>▲</span>}
                </td>
                <td style={{ padding: "7px 14px", textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: p2Better ? 800 : 400, color: p2Better ? "#00e5a0" : p1Better ? "#4a6a88" : "#8899aa", fontSize: 13 }}>
                  {row.fmt(v2, p2)}
                  {p2Better && <span style={{ marginLeft: 4, fontSize: 9, color: "#00e5a0" }}>▲</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Radar Overlay ─────────────────────────────────────────────────────────────
const RADAR_KEYS = ["WAR", "EV Off", "EV Def", "PP", "Shooting", "RAPM Off", "RAPM Def"];

function CompareRadar({ p1, p2 }) {
  const c1 = TEAM_COLOR[p1?.team] || "#0080FF";
  const c2 = TEAM_COLOR[p2?.team] || "#e05050";

  const keys = useMemo(() => {
    const allKeys = new Set(RADAR_KEYS);
    Object.keys(p1?.percentiles || {}).forEach(k => allKeys.add(k));
    return [...allKeys].filter(k => (p1?.percentiles?.[k] != null || p2?.percentiles?.[k] != null));
  }, [p1, p2]);

  if (!keys.length) return null;

  const data = keys.map(k => ({
    metric: k,
    p1val: p1?.percentiles?.[k] ?? 0,
    p2val: p2?.percentiles?.[k] ?? 0,
    fullMark: 100,
  }));

  return (
    <div style={{ background: "#0d1825", border: "1px solid #1e2d40", borderRadius: 10, padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Percentile Radar</div>
      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        {[p1, p2].map((p, idx) => p && (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 12, height: 3, borderRadius: 2, background: idx === 0 ? c1 : c2 }} />
            <span style={{ fontSize: 10, color: "#5a7a99", fontFamily: "'DM Mono',monospace" }}>{p.full_name}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="#1e2d40" />
          <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: "#5a7a99", fontFamily: "DM Mono,monospace" }} />
          <Radar dataKey="p1val" stroke={c1} fill={c1} fillOpacity={0.15} strokeWidth={2} dot={{ r: 3, fill: c1 }} name={p1?.full_name || "P1"} />
          <Radar dataKey="p2val" stroke={c2} fill={c2} fillOpacity={0.15} strokeWidth={2} dot={{ r: 3, fill: c2 }} name={p2?.full_name || "P2"} />
          <Tooltip
            contentStyle={{ background: "#0a1520", border: "1px solid #1e2d40", borderRadius: 6, fontSize: 11, fontFamily: "DM Mono,monospace" }}
            formatter={(v, name) => [`${Math.round(v)}th`, name]}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── WAR Component Bars ────────────────────────────────────────────────────────
function WarBars({ p1, p2 }) {
  const c1 = TEAM_COLOR[p1?.team] || "#0080FF";
  const c2 = TEAM_COLOR[p2?.team] || "#e05050";
  const bars = [
    { label: "WAR3",    k: "war_total",  digits: 2 },
    { label: "EV Off",  k: "war_ev_off", digits: 2 },
    { label: "EV Def",  k: "war_ev_def", digits: 2 },
    { label: "PP",      k: "war_pp",     digits: 2 },
  ];
  const allVals = bars.flatMap(b => [p1?.[b.k], p2?.[b.k]]).filter(v => v != null).map(Number);
  const maxAbs = allVals.length ? Math.max(...allVals.map(Math.abs), 0.1) : 1;

  return (
    <div style={{ background: "#0d1825", border: "1px solid #1e2d40", borderRadius: 10, padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>WAR Components</div>
      {bars.map(bar => {
        const v1 = p1?.[bar.k] != null ? Number(p1[bar.k]) : null;
        const v2 = p2?.[bar.k] != null ? Number(p2[bar.k]) : null;
        return (
          <div key={bar.label} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: "#4a6a88", fontFamily: "'DM Mono',monospace", marginBottom: 6 }}>{bar.label}</div>
            {[{v: v1, c: c1, name: p1?.full_name}, {v: v2, c: c2, name: p2?.full_name}].map(({v, c, name}) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono',monospace", width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || "—"}</div>
                <div style={{ flex: 1, height: 14, background: "#1a2535", borderRadius: 7, overflow: "hidden", position: "relative" }}>
                  {v != null && (
                    <div style={{ position: "absolute", left: v >= 0 ? "50%" : `${50 - (Math.abs(v) / maxAbs) * 50}%`, width: `${(Math.abs(v) / maxAbs) * 50}%`, height: "100%", background: `${c}cc`, borderRadius: 7, transition: "width 0.7s ease" }} />
                  )}
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#2a3d55" }} />
                </div>
                <div style={{ fontSize: 11, color: v != null ? (v >= 0 ? c : "#e05050") : "#2a4060", fontFamily: "'DM Mono',monospace", fontWeight: 700, width: 40, textAlign: "right" }}>
                  {v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(bar.digits)}` : "—"}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Verdict ────────────────────────────────────────────────────────────────────
function Verdict({ p1, p2 }) {
  if (!p1 || !p2) return null;
  const r1 = p1.overall_rating ?? 0;
  const r2 = p2.overall_rating ?? 0;
  const w1 = p1.war_total ?? 0;
  const w2 = p2.war_total ?? 0;
  const winner = r1 > r2 ? p1 : r2 > r1 ? p2 : null;
  const margin = Math.abs(r1 - r2).toFixed(1);
  const accentW = winner ? (TEAM_COLOR[winner.team] || "#00e5a0") : "#4a6a88";

  return (
    <div style={{ background: winner ? `${accentW}0f` : "#0d1825", border: `1px solid ${accentW}44`, borderRadius: 10, padding: "16px 20px" }}>
      <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Verdict</div>
      {winner ? (
        <>
          <div style={{ fontSize: 20, fontWeight: 900, color: accentW, fontFamily: "'Barlow Condensed',sans-serif", marginBottom: 6 }}>
            {winner.full_name} leads by {margin} OVR pts
          </div>
          <div style={{ fontSize: 12, color: "#5a7a99", fontFamily: "'DM Mono',monospace" }}>
            {p1.full_name}: OVR {Math.round(r1)} · WAR {w1.toFixed(2)} &nbsp;|&nbsp;
            {p2.full_name}: OVR {Math.round(r2)} · WAR {w2.toFixed(2)}
          </div>
          {Math.abs(w1 - w2) > 0.5 && (
            <div style={{ fontSize: 11, color: "#4a6a88", fontFamily: "'DM Mono',monospace", marginTop: 6 }}>
              {w1 > w2 ? p1.full_name : p2.full_name} has the WAR edge (+{Math.abs(w1 - w2).toFixed(2)}).
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 16, fontWeight: 700, color: "#f0c040", fontFamily: "'Barlow Condensed',sans-serif" }}>
          Dead even — both rate at OVR {Math.round(r1)}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function CompareClient() {
  const searchParams = useSearchParams();
  const [p1, setP1] = useState(null);
  const [p2, setP2] = useState(null);

  // Pre-fill from URL ?p1=<player_id>
  useEffect(() => {
    const id = searchParams?.get("p1");
    if (!id || p1) return;
    supabase
      .from("players")
      .select("player_id,full_name,team,position,jersey,headshot_url,overall_rating,off_rating,def_rating,rapm_off,rapm_def,war_total,war_ev_off,war_ev_def,war_pp,gp,g,a,pts,percentiles")
      .eq("player_id", id)
      .single()
      .then(({ data }) => { if (data) setP1(data); });
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch current-season stats (cf_pct, xgf_pct, hdcf_pct, ixg, icf) from player_seasons
  // and merge into the player object — these columns live on player_seasons, not players.
  useEffect(() => {
    [[p1, setP1], [p2, setP2]].forEach(([player, setter]) => {
      if (!player || player.cf_pct != null) return;
      supabase
        .from("player_seasons")
        .select("cf_pct,xgf_pct,hdcf_pct,ixg,icf")
        .eq("player_id", player.player_id)
        .eq("season", "25-26")
        .maybeSingle()
        .then(({ data }) => {
          if (data) setter(prev => prev ? { ...prev, ...data } : prev);
        });
    });
  }, [p1?.player_id, p2?.player_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = p1 && p2;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        body { background:#05090f; }
        input::placeholder { color:#2a4060; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:#0d1825; }
        ::-webkit-scrollbar-thumb { background:#1e2d40; border-radius:2px; }
      `}</style>

      <div style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 20% 20%,#0d1e30 0%,#05090f 60%)", padding: "40px 24px", fontFamily: "'Barlow Condensed',sans-serif" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {/* Page header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, color: "#2a5070", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 6 }}>NHL Analytics</div>
            <h1 style={{ fontSize: 38, fontWeight: 900, color: "#e8f4ff", letterSpacing: "-1px", lineHeight: 1 }}>Player Compare</h1>
            <div style={{ fontSize: 12, color: "#2a4060", fontFamily: "'DM Mono',monospace", marginTop: 6 }}>Select two skaters to compare stats, ratings, and percentiles</div>
          </div>

          {/* Player pickers */}
          <div style={{ display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
            <PlayerPicker label="Player 1" player={p1} onSelect={p => { setP1(p); }} />
            <div style={{ display: "flex", alignItems: "center", fontSize: 22, fontWeight: 900, color: "#1e2d40", fontFamily: "'Barlow Condensed',sans-serif", paddingTop: 24 }}>vs</div>
            <PlayerPicker label="Player 2" player={p2} onSelect={p => { setP2(p); }} />
          </div>

          {!ready && (
            <div style={{ textAlign: "center", padding: "60px 24px", color: "#2a4060", fontFamily: "'DM Mono',monospace", fontSize: 13 }}>
              {!p1 && !p2 ? "Search for two players to compare" : !p1 ? "Select Player 1" : "Select Player 2"}
            </div>
          )}

          {ready && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Player headers */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[p1, p2].map((p, idx) => {
                  const accent = TEAM_COLOR[p.team] || "#4a6a88";
                  return (
                    <div key={idx} style={{ padding: "16px 20px", background: `${accent}18`, border: `1px solid ${accent}44`, borderRadius: 10, display: "flex", alignItems: "center", gap: 14 }}>
                      {p.headshot_url && <img src={p.headshot_url} alt={p.full_name} width={56} height={56} style={{ borderRadius: 8, objectFit: "cover" }} />}
                      <img src={logoUrl(p.team)} alt={p.team} width={36} height={36} style={{ objectFit: "contain" }} />
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#e8f4ff", fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: "-0.5px" }}>{p.full_name}</div>
                        <div style={{ fontSize: 11, color: "#4a6a88", fontFamily: "'DM Mono',monospace" }}>{p.team} · {p.position} · OVR {p.overall_rating != null ? Math.round(p.overall_rating) : "—"}</div>
                      </div>
                      <div style={{ marginLeft: "auto", textAlign: "center" }}>
                        <div style={{ fontSize: 32, fontWeight: 900, color: pctColor(p.overall_rating), fontFamily: "'Barlow Condensed',sans-serif", lineHeight: 1 }}>
                          {p.overall_rating != null ? Math.round(p.overall_rating) : "—"}
                        </div>
                        <div style={{ fontSize: 9, color: "#3a5a78", fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>OVR</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Verdict */}
              <Verdict p1={p1} p2={p2} />

              {/* Stats table */}
              <CompareTable p1={p1} p2={p2} />

              {/* Radar + WAR side by side */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <CompareRadar p1={p1} p2={p2} />
                <WarBars p1={p1} p2={p2} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
