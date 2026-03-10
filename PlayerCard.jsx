"use client";
import { useState } from "react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from "recharts";

// ── Mock player data (replace with real API/DB calls) ──────────────────────
const PLAYERS = [
  {
    id: 8478402,
    name: "Connor McDavid",
    firstName: "Connor",
    lastName: "McDavid",
    number: 97,
    position: "C",
    team: "EDM",
    teamFull: "Edmonton Oilers",
    teamColor: "#FF4C00",
    teamColor2: "#041E42",
    age: 28,
    height: "6'1\"",
    weight: "193 lbs",
    shoots: "L",
    nationality: "🇨🇦",
    headshotBg: "#FF4C00",
    initials: "CM",

    // Core stats
    gp: 71, g: 32, a: 72, pts: 104, plusMinus: 22, toi: "21:53", ppp: 28, shp: 2,

    // Advanced / on-ice (per 60)
    cf_pct: 57.2,
    xgf_pct: 58.9,
    hdcf_pct: 55.4,
    scf_pct: 56.8,

    // WAR & RAPM
    war: 4.8,
    war_off: 3.6,
    war_def: 1.2,
    rapm_off: 4.21,
    rapm_def: 0.88,

    // Percentile ranks vs all forwards (0–100)
    percentiles: {
      "Goals/60":    96,
      "Pts/60":      99,
      "xGF%":        91,
      "HDCF%":       88,
      "WAR":         99,
      "Def. RAPM":   72,
    },

    // Season trend (last 4 seasons WAR)
    warTrend: [
      { season: "21-22", war: 3.9 },
      { season: "22-23", war: 5.2 },
      { season: "23-24", war: 6.1 },
      { season: "24-25", war: 4.8 },
    ],
  },
  {
    id: 8481528,
    name: "Auston Matthews",
    firstName: "Auston",
    lastName: "Matthews",
    number: 34,
    position: "C",
    team: "TOR",
    teamFull: "Toronto Maple Leafs",
    teamColor: "#00205B",
    teamColor2: "#00205B",
    age: 27,
    height: "6'3\"",
    weight: "220 lbs",
    shoots: "L",
    nationality: "🇺🇸",
    headshotBg: "#00205B",
    initials: "AM",

    gp: 69, g: 45, a: 49, pts: 94, plusMinus: 14, toi: "20:41", ppp: 19, shp: 0,

    cf_pct: 54.1,
    xgf_pct: 55.3,
    hdcf_pct: 57.8,
    scf_pct: 53.9,

    war: 4.2,
    war_off: 3.8,
    war_def: 0.4,
    rapm_off: 3.95,
    rapm_def: 0.31,

    percentiles: {
      "Goals/60":    99,
      "Pts/60":      95,
      "xGF%":        84,
      "HDCF%":       92,
      "WAR":         96,
      "Def. RAPM":   51,
    },

    warTrend: [
      { season: "21-22", war: 4.4 },
      { season: "22-23", war: 3.1 },
      { season: "23-24", war: 5.0 },
      { season: "24-25", war: 4.2 },
    ],
  },
  {
    id: 8480801,
    name: "Cale Makar",
    firstName: "Cale",
    lastName: "Makar",
    number: 8,
    position: "D",
    team: "COL",
    teamFull: "Colorado Avalanche",
    teamColor: "#6F263D",
    teamColor2: "#236192",
    age: 26,
    height: "5'11\"",
    weight: "187 lbs",
    shoots: "R",
    nationality: "🇨🇦",
    headshotBg: "#6F263D",
    initials: "CM",

    gp: 68, g: 21, a: 49, pts: 70, plusMinus: 18, toi: "25:12", ppp: 22, shp: 0,

    cf_pct: 55.9,
    xgf_pct: 57.1,
    hdcf_pct: 54.2,
    scf_pct: 56.0,

    war: 5.1,
    war_off: 3.1,
    war_def: 2.0,
    rapm_off: 2.88,
    rapm_def: 2.14,

    percentiles: {
      "Goals/60":    94,
      "Pts/60":      99,
      "xGF%":        89,
      "HDCF%":       85,
      "WAR":         99,
      "Def. RAPM":   95,
    },

    warTrend: [
      { season: "21-22", war: 6.2 },
      { season: "22-23", war: 4.8 },
      { season: "23-24", war: 4.5 },
      { season: "24-25", war: 5.1 },
    ],
  },
];

// ── Utility ────────────────────────────────────────────────────────────────
function pctColor(v) {
  if (v >= 85) return "#00e5a0";
  if (v >= 60) return "#f0c040";
  if (v >= 40) return "#f08040";
  return "#e05050";
}

function statColor(pct) {
  if (pct >= 52) return "#00e5a0";
  if (pct >= 48) return "#f0c040";
  return "#e05050";
}

function PercentileBar({ label, value }) {
  const color = pctColor(value);
  return (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#8899aa", fontFamily: "'DM Mono', monospace", letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "'DM Mono', monospace" }}>{value}</span>
      </div>
      <div style={{ height: 5, background: "#1a2535", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          width: `${value}%`,
          height: "100%",
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          borderRadius: 3,
          transition: "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
        }} />
      </div>
    </div>
  );
}

function StatBox({ label, value, sub, highlight }) {
  return (
    <div style={{
      background: highlight ? "rgba(0,229,160,0.07)" : "#0d1825",
      border: `1px solid ${highlight ? "#00e5a088" : "#1e2d40"}`,
      borderRadius: 6,
      padding: "10px 12px",
      textAlign: "center",
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: highlight ? "#00e5a0" : "#e8f0f8", fontFamily: "'Barlow Condensed', sans-serif", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: "#5a7a99", marginTop: 3, fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "#00e5a0", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>{sub}</div>}
    </div>
  );
}

function WARTrendMini({ data, color }) {
  const max = Math.max(...data.map(d => d.war));
  const min = Math.min(...data.map(d => d.war));
  const range = max - min || 1;
  const W = 200, H = 50;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * (W - 20) + 10;
    const y = H - 8 - ((d.war - min) / range) * (H - 16);
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => {
        const x = (i / (data.length - 1)) * (W - 20) + 10;
        const y = H - 8 - ((d.war - min) / range) * (H - 16);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={3.5} fill={color} />
            <text x={x} y={H} textAnchor="middle" fontSize={9} fill="#445566" fontFamily="DM Mono, monospace">{d.season}</text>
            <text x={x} y={y - 7} textAnchor="middle" fontSize={9} fill={color} fontWeight="700" fontFamily="DM Mono, monospace">{d.war}</text>
          </g>
        );
      })}
    </svg>
  );
}

function PercentileModal({ percentiles, color, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "linear-gradient(160deg, #0c1a28 0%, #081016 100%)",
          border: "1px solid #1e2d40",
          borderRadius: 16,
          padding: "32px 36px",
          width: "100%",
          maxWidth: 560,
          position: "relative",
          boxShadow: "0 32px 80px rgba(0,0,0,0.8)",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "#1a2535",
            border: "1px solid #2a3d55",
            color: "#8899aa",
            fontSize: 18,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >×</button>

        <div style={{
          fontSize: 11,
          color: "#3a5a78",
          fontFamily: "'DM Mono', monospace",
          textTransform: "uppercase",
          letterSpacing: "0.15em",
          marginBottom: 28,
        }}>
          Percentile Rankings
        </div>

        {Object.entries(percentiles).map(([label, value]) => {
          const barColor = pctColor(value);
          return (
            <div key={label} style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <span style={{
                  fontSize: 13,
                  color: "#8899aa",
                  fontFamily: "'DM Mono', monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}>{label}</span>
                <span style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: barColor,
                  fontFamily: "'Barlow Condensed', sans-serif",
                  lineHeight: 1,
                }}>{value}</span>
              </div>
              <div style={{ height: 8, background: "#1a2535", borderRadius: 4, overflow: "hidden" }}>
                <div style={{
                  width: `${value}%`,
                  height: "100%",
                  background: `linear-gradient(90deg, ${barColor}66, ${barColor})`,
                  borderRadius: 4,
                  transition: "width 0.9s cubic-bezier(0.22, 1, 0.36, 1)",
                }} />
              </div>
            </div>
          );
        })}

        <div style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: "1px solid #1a2535",
          display: "flex",
          justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 9, color: "#2a4060", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            2024–25 Regular Season
          </span>
          <span style={{ fontSize: 9, color: "#2a4060", fontFamily: "'DM Mono', monospace" }}>
            hockeystats.dev
          </span>
        </div>
      </div>
    </div>
  );
}

function RadarViz({ percentiles, color }) {
  const data = Object.entries(percentiles).map(([k, v]) => ({ metric: k, value: v, fullMark: 100 }));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="72%">
        <PolarGrid stroke="#1e2d40" />
        <PolarAngleAxis
          dataKey="metric"
          tick={{ fontSize: 10, fill: "#5a7a99", fontFamily: "DM Mono, monospace" }}
        />
        <Radar dataKey="value" stroke={color} fill={color} fillOpacity={0.18} strokeWidth={2} dot={{ r: 3, fill: color }} />
        <Tooltip
          contentStyle={{ background: "#0a1520", border: `1px solid ${color}44`, borderRadius: 6, fontSize: 12, fontFamily: "DM Mono, monospace" }}
          labelStyle={{ color: "#8899aa" }}
          itemStyle={{ color }}
          formatter={(v) => [`${v}th pct`, ""]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ── Main Card Component ─────────────────────────────────────────────────────
function PlayerCard({ player }) {
  const [tab, setTab] = useState("overview");
  const [showPercentileModal, setShowPercentileModal] = useState(false);
  const accent = player.teamColor;
  const ptsPer82 = Math.round((player.pts / player.gp) * 82);

  const tabs = ["overview", "on-ice", "war / rapm"];

  return (
    <div style={{
      width: 400,
      background: "linear-gradient(160deg, #0c1a28 0%, #081016 100%)",
      borderRadius: 16,
      border: `1px solid #1e2d40`,
      overflow: "hidden",
      boxShadow: `0 0 0 1px #0a1520, 0 24px 60px rgba(0,0,0,0.6), 0 0 80px ${accent}15`,
      fontFamily: "'Barlow Condensed', sans-serif",
      position: "relative",
    }}>
      {/* Top accent bar */}
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, ${accent}88, transparent)` }} />

      {/* Header */}
      <div style={{
        padding: "20px 24px 16px",
        background: `linear-gradient(135deg, ${accent}22 0%, transparent 60%)`,
        borderBottom: "1px solid #1a2535",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Big number watermark */}
        <div style={{
          position: "absolute",
          right: -8,
          top: -10,
          fontSize: 110,
          fontWeight: 900,
          color: `${accent}18`,
          lineHeight: 1,
          fontFamily: "'Barlow Condensed', sans-serif",
          userSelect: "none",
          letterSpacing: "-4px",
        }}>{player.number}</div>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", position: "relative", zIndex: 1 }}>
          {/* Avatar */}
          <div style={{
            width: 64,
            height: 64,
            borderRadius: 10,
            background: `linear-gradient(135deg, ${accent}, ${accent}88)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 900,
            color: "white",
            flexShrink: 0,
            boxShadow: `0 4px 20px ${accent}44`,
            border: `2px solid ${accent}66`,
            letterSpacing: "-1px",
          }}>
            {player.initials}
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 11, color: accent, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                #{player.number} · {player.position} · {player.nationality}
              </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#e8f4ff", lineHeight: 1, letterSpacing: "-0.5px" }}>
              {player.firstName}
            </div>
            <div style={{ fontSize: 32, fontWeight: 900, color: "white", lineHeight: 1, letterSpacing: "-1px", textTransform: "uppercase" }}>
              {player.lastName}
            </div>
            <div style={{ marginTop: 5, fontSize: 11, color: "#4a6a88", fontFamily: "'DM Mono', monospace" }}>
              {player.teamFull} · {player.age} yrs · {player.height} · {player.shoots}H
            </div>
          </div>
        </div>

        {/* WAR badge */}
        <div style={{
          position: "absolute",
          top: 20,
          right: 24,
          background: "#00e5a015",
          border: "1px solid #00e5a044",
          borderRadius: 8,
          padding: "6px 12px",
          textAlign: "center",
          zIndex: 2,
        }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#00e5a0", lineHeight: 1 }}>{player.war}</div>
          <div style={{ fontSize: 9, color: "#00e5a088", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>WAR</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1a2535" }}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1,
            padding: "10px 0",
            background: "none",
            border: "none",
            borderBottom: tab === t ? `2px solid ${accent}` : "2px solid transparent",
            color: tab === t ? "#e8f4ff" : "#3a5a78",
            fontSize: 10,
            fontFamily: "'DM Mono', monospace",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            cursor: "pointer",
            transition: "all 0.2s",
            fontWeight: tab === t ? 700 : 400,
            marginBottom: -1,
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: "18px 20px 20px" }}>

        {/* OVERVIEW TAB */}
        {tab === "overview" && (
          <div>
            {/* Core stat grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16 }}>
              <StatBox label="GP"  value={player.gp} />
              <StatBox label="G"   value={player.g} />
              <StatBox label="A"   value={player.a} />
              <StatBox label="PTS" value={player.pts} highlight />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 20 }}>
              <StatBox label="PPP"  value={player.ppp} />
              <StatBox label="+/-"  value={`${player.plusMinus > 0 ? "+" : ""}${player.plusMinus}`} />
              <StatBox label="Pts/82" value={ptsPer82} highlight />
            </div>

            {/* TOI */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, padding: "10px 14px", background: "#0d1825", borderRadius: 8, border: "1px solid #1e2d40" }}>
              <span style={{ fontSize: 11, color: "#5a7a99", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>Avg TOI</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: accent }}>{player.toi}</span>
            </div>

            {/* Radar */}
            <div style={{ marginBottom: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Percentile Profile vs. Forwards
                </div>
                <button
                  onClick={() => setShowPercentileModal(true)}
                  style={{
                    fontSize: 9,
                    color: accent,
                    fontFamily: "'DM Mono', monospace",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    background: `${accent}15`,
                    border: `1px solid ${accent}44`,
                    borderRadius: 4,
                    padding: "3px 8px",
                    cursor: "pointer",
                  }}
                >
                  View All →
                </button>
              </div>
              <div
                onClick={() => setShowPercentileModal(true)}
                style={{ cursor: "pointer" }}
                title="Click to expand percentile rankings"
              >
                <RadarViz percentiles={player.percentiles} color={accent} />
              </div>
            </div>
          </div>
        )}

        {showPercentileModal && (
          <PercentileModal
            percentiles={player.percentiles}
            color={accent}
            onClose={() => setShowPercentileModal(false)}
          />
        )}

        {/* ON-ICE TAB */}
        {tab === "on-ice" && (
          <div>
            <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
              5v5 On-Ice Rates (All Situations)
            </div>

            {/* CF% xGF% etc */}
            {[
              { label: "CF% (Corsi For)", value: player.cf_pct, baseline: 50 },
              { label: "xGF% (Exp. Goals For)", value: player.xgf_pct, baseline: 50 },
              { label: "HDCF% (High Danger)", value: player.hdcf_pct, baseline: 50 },
              { label: "SCF% (Scoring Chances)", value: player.scf_pct, baseline: 50 },
            ].map(stat => (
              <div key={stat.label} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "#8899aa", fontFamily: "'DM Mono', monospace" }}>{stat.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: statColor(stat.value), fontFamily: "'DM Mono', monospace" }}>
                    {stat.value}%
                  </span>
                </div>
                <div style={{ height: 8, background: "#1a2535", borderRadius: 4, position: "relative", overflow: "hidden" }}>
                  {/* 50% marker */}
                  <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#2a3d55", zIndex: 1 }} />
                  <div style={{
                    position: "absolute",
                    left: stat.value >= 50 ? "50%" : `${stat.value}%`,
                    width: stat.value >= 50 ? `${stat.value - 50}%` : `${50 - stat.value}%`,
                    height: "100%",
                    background: statColor(stat.value),
                    opacity: 0.8,
                    borderRadius: 4,
                    transition: "width 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
                  }} />
                </div>
              </div>
            ))}

            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
                Percentile Rankings
              </div>
              {Object.entries(player.percentiles).map(([k, v]) => (
                <PercentileBar key={k} label={k} value={v} />
              ))}
            </div>
          </div>
        )}

        {/* WAR / RAPM TAB */}
        {tab === "war / rapm" && (
          <div>
            {/* WAR breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
              <StatBox label="Total WAR" value={player.war} highlight />
              <StatBox label="Off WAR" value={player.war_off} />
              <StatBox label="Def WAR" value={player.war_def} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 20 }}>
              <StatBox label="RAPM Off" value={`+${player.rapm_off}`} />
              <StatBox label="RAPM Def" value={`+${player.rapm_def}`} />
            </div>

            {/* WAR definitions */}
            <div style={{ background: "#0d1825", border: "1px solid #1e2d40", borderRadius: 8, padding: "12px 14px", marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>What is WAR?</div>
              <p style={{ fontSize: 11, color: "#5a7a99", lineHeight: 1.6, margin: 0, fontFamily: "'DM Mono', monospace" }}>
                Wins Above Replacement estimates how many wins a player contributes vs. a replacement-level player. Source: Evolving-Hockey.
              </p>
            </div>

            {/* WAR trend chart */}
            <div>
              <div style={{ fontSize: 10, color: "#3a5a78", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
                WAR Trend (Last 4 Seasons)
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <WARTrendMini data={player.warTrend} color={accent} />
              </div>
            </div>

            {/* Source tags */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
              {["Evolving-Hockey", "Natural Stat Trick", "NHL API"].map(src => (
                <span key={src} style={{
                  fontSize: 9,
                  padding: "3px 8px",
                  background: "#0d1825",
                  border: "1px solid #1e2d40",
                  borderRadius: 20,
                  color: "#3a5a78",
                  fontFamily: "'DM Mono', monospace",
                  letterSpacing: "0.04em",
                }}>
                  {src}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: "1px solid #1a2535",
        padding: "10px 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{ fontSize: 9, color: "#2a4060", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          2024–25 Regular Season
        </span>
        <span style={{ fontSize: 9, color: "#2a4060", fontFamily: "'DM Mono', monospace" }}>
          hockeystats.dev
        </span>
      </div>
    </div>
  );
}

// ── App Shell ───────────────────────────────────────────────────────────────
export default function App() {
  const [selectedId, setSelectedId] = useState(PLAYERS[0].id);
  const player = PLAYERS.find(p => p.id === selectedId);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #05090f; }
        button:hover { opacity: 0.85; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 20% 20%, #0d1e30 0%, #05090f 60%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 20px",
        fontFamily: "'Barlow Condensed', sans-serif",
      }}>
        {/* Header */}
        <div style={{ marginBottom: 36, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#2a5070", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 8 }}>
            NHL Analytics
          </div>
          <h1 style={{ fontSize: 42, fontWeight: 900, color: "#e8f4ff", letterSpacing: "-1px", lineHeight: 1 }}>
            Player Cards
          </h1>
          <div style={{ fontSize: 12, color: "#2a4060", fontFamily: "'DM Mono', monospace", marginTop: 6 }}>
            WAR · RAPM · On-Ice Shot Rates · Percentile Rankings
          </div>
        </div>

        {/* Player selector */}
        <div style={{ display: "flex", gap: 10, marginBottom: 32, flexWrap: "wrap", justifyContent: "center" }}>
          {PLAYERS.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              style={{
                padding: "8px 20px",
                background: selectedId === p.id ? p.teamColor : "#0d1825",
                border: `1px solid ${selectedId === p.id ? p.teamColor : "#1e2d40"}`,
                borderRadius: 8,
                color: selectedId === p.id ? "white" : "#4a6a88",
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "'Barlow Condensed', sans-serif",
                cursor: "pointer",
                letterSpacing: "0.03em",
                transition: "all 0.2s",
                boxShadow: selectedId === p.id ? `0 4px 20px ${p.teamColor}44` : "none",
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* Card */}
        <div style={{ animation: "fadeUp 0.4s ease" }}>
          <PlayerCard key={player.id} player={player} />
        </div>

        {/* Data source note */}
        <div style={{ marginTop: 28, fontSize: 10, color: "#1e3348", fontFamily: "'DM Mono', monospace", textAlign: "center", maxWidth: 400 }}>
          Data: NHL API · Natural Stat Trick · Evolving-Hockey · TopDownHockey<br />
          Mock data shown — wire up real sources via nhl_pipeline.py
        </div>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
