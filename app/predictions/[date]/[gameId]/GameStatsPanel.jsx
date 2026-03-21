"use client";
import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import BoxscorePanel from "./BoxscorePanel";

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function computeXG(xCoord, yCoord, shotType) {
  let nx = xCoord ?? 0;
  let ny = yCoord ?? 0;
  if (nx < 0) { nx = -nx; ny = -ny; }
  const dist = Math.sqrt((89 - nx) ** 2 + ny ** 2);
  const angle = Math.abs(Math.atan2(Math.abs(ny), Math.max(89 - nx, 1)) * (180 / Math.PI));
  const typeBase = {
    wrist: 0.085, snap: 0.094, slap: 0.072, backhand: 0.060,
    "tip-in": 0.145, deflected: 0.138, bat: 0.05, "between-legs": 0.08, poke: 0.04,
  };
  const base = typeBase[shotType] ?? 0.075;
  return Math.min(Math.max(base * Math.exp(-dist / 35) * Math.cos(angle * Math.PI / 180) * 3.2, 0.005), 0.95);
}

function computeWinProb(homeScore, awayScore, totalSecondsElapsed) {
  const remaining = Math.max(3600 - totalSecondsElapsed, 0);
  const scoreDiff = homeScore - awayScore;
  const timeWeight = remaining / 3600;
  return Math.min(Math.max(0.5 + scoreDiff * 0.15 * (1 - timeWeight * 0.3), 0.02), 0.98);
}

function periodSeconds(periodNum, timeInPeriod) {
  if (!timeInPeriod) return (periodNum - 1) * 1200;
  const [m, s] = timeInPeriod.split(":").map(Number);
  return (periodNum - 1) * 1200 + (m || 0) * 60 + (s || 0);
}

function parsePBP(data, homeTeamId, awayTeamId) {
  const plays = data?.plays ?? [];
  const rosterSpots = data?.rosterSpots ?? [];

  const nameMap = {};
  for (const r of rosterSpots) {
    const pid = String(r.playerId);
    const fn = r.firstName?.default ?? "";
    const ln = r.lastName?.default ?? "";
    nameMap[pid] = `${fn} ${ln}`.trim() || pid;
  }

  const shotEvents = [];
  const winProbTimeline = [{ x: 0, home: 50, away: 50 }];
  const xgByPeriod = { 1: { home: 0, away: 0 }, 2: { home: 0, away: 0 }, 3: { home: 0, away: 0 }, OT: { home: 0, away: 0 } };
  const playerXG = {};

  let homeScore = 0;
  let awayScore = 0;

  const SHOT_TYPES = new Set(["shot-on-goal", "missed-shot", "blocked-shot", "goal"]);

  for (const play of plays) {
    const typeKey = play.typeDescKey;
    if (!SHOT_TYPES.has(typeKey)) continue;

    const det = play.details ?? {};
    const xCoord = det.xCoord;
    const yCoord = det.yCoord;
    const shotType = det.shotType ?? "wrist";
    const teamId = det.eventOwnerTeamId ?? play.eventOwnerTeamId;
    const periodNum = play.periodDescriptor?.number ?? 1;
    const periodType = play.periodDescriptor?.periodType ?? "REG";
    const timeInPeriod = play.timeInPeriod;

    let isHome;
    if (typeKey === "blocked-shot") {
      isHome = teamId !== homeTeamId;
    } else {
      isHome = teamId === homeTeamId;
    }

    const xg = computeXG(xCoord, yCoord, shotType);
    const totalSec = periodSeconds(periodNum, timeInPeriod);

    const pKey = periodType === "OT" || periodNum > 3 ? "OT" : periodNum;
    if (xgByPeriod[pKey]) {
      xgByPeriod[pKey][isHome ? "home" : "away"] += xg;
    }

    shotEvents.push({ x: xCoord, y: yCoord, xg, type: typeKey, isHome, period: periodNum });

    const shooterId = String(det.shootingPlayerId ?? det.playerId ?? "");
    if (shooterId && typeKey !== "blocked-shot") {
      if (!playerXG[shooterId]) {
        playerXG[shooterId] = { name: nameMap[shooterId] ?? shooterId, xg: 0, shots: 0, isHome };
      }
      playerXG[shooterId].xg += xg;
      if (typeKey === "shot-on-goal" || typeKey === "goal") playerXG[shooterId].shots += 1;
    }

    if (typeKey === "goal") {
      if (isHome) homeScore++; else awayScore++;
      const prob = computeWinProb(homeScore, awayScore, totalSec);
      winProbTimeline.push({ x: totalSec, home: Math.round(prob * 100), away: Math.round((1 - prob) * 100) });
    }
  }

  for (const [sec] of [[1200], [2400]]) {
    winProbTimeline.push({ x: sec, marker: true });
  }
  winProbTimeline.sort((a, b) => a.x - b.x);

  const totalHomeXG = Object.values(xgByPeriod).reduce((s, p) => s + p.home, 0);
  const totalAwayXG = Object.values(xgByPeriod).reduce((s, p) => s + p.away, 0);

  return { shotEvents, winProbTimeline, xgByPeriod, playerXG, totalHomeXG, totalAwayXG };
}

// ── SVG helpers ──────────────────────────────────────────────────────────────

function toSvgX(x) { return (x + 100) * 3.0; }
function toSvgY(y) { return (y + 42.5) * 3.0; }

// ── Style constants ──────────────────────────────────────────────────────────

const CARD = {
  background: "#091017",
  border: "1px solid #17283b",
  borderRadius: 20,
  padding: "16px 18px",
  display: "grid",
  gap: 10,
};

const SECTION_LABEL = {
  color: "#8db9dc",
  fontSize: 11,
  fontFamily: "'DM Mono',monospace",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
};

const MUTED = { color: "#5e7b98", fontFamily: "'DM Mono',monospace", fontSize: 11 };

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionDivider({ label }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "center" }}>
      <div style={{ color: "#8db9dc", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>{label}</div>
      <div style={{ height: 1, background: "linear-gradient(90deg,rgba(115,141,165,0.55),rgba(23,40,59,0.4))" }} />
    </div>
  );
}

function IceRink({ shotEvents, homeColor, awayColor, homeAbbr, awayAbbr, totalHomeXG, totalAwayXG }) {
  const homeShots = shotEvents.filter(e => e.isHome && (e.type === "shot-on-goal" || e.type === "goal")).length;
  const awayShots = shotEvents.filter(e => !e.isHome && (e.type === "shot-on-goal" || e.type === "goal")).length;

  const goalLineLeft = 66;   // toSvgX(-78)
  const goalLineRight = 534; // toSvgX(78)
  const blueLineLeft = 180;  // toSvgX(-40)
  const blueLineRight = 420; // toSvgX(40)
  const centerX = 300;
  const centerY = 127.5;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ color: awayColor, fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700 }}>
          {awayAbbr}: {awayShots} shots · {totalAwayXG.toFixed(2)} xG
        </span>
        <span style={{ color: homeColor, fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700 }}>
          {homeAbbr}: {homeShots} shots · {totalHomeXG.toFixed(2)} xG
        </span>
      </div>
      <svg viewBox="0 0 600 255" style={{ width: "100%", maxWidth: 600, height: "auto", display: "block", margin: "0 auto" }}>
        {/* Boards */}
        <rect x={0} y={0} width={600} height={255} rx={28} fill="#071118" stroke="#1a3a5a" strokeWidth={2.5} />
        {/* Center ice circle */}
        <circle cx={centerX} cy={centerY} r={32} fill="none" stroke="rgba(200,50,50,0.25)" strokeWidth={1.5} />
        {/* Center line */}
        <line x1={centerX} y1={0} x2={centerX} y2={255} stroke="rgba(220,50,50,0.6)" strokeWidth={2} />
        {/* Blue lines */}
        <line x1={blueLineLeft} y1={0} x2={blueLineLeft} y2={255} stroke="rgba(50,100,220,0.6)" strokeWidth={2.5} />
        <line x1={blueLineRight} y1={0} x2={blueLineRight} y2={255} stroke="rgba(50,100,220,0.6)" strokeWidth={2.5} />
        {/* Goal lines */}
        <line x1={goalLineLeft} y1={22} x2={goalLineLeft} y2={233} stroke="rgba(220,50,50,0.5)" strokeWidth={1.5} />
        <line x1={goalLineRight} y1={22} x2={goalLineRight} y2={233} stroke="rgba(220,50,50,0.5)" strokeWidth={1.5} />
        {/* Goal creases */}
        <path
          d={`M ${goalLineLeft},${centerY - 22} Q ${goalLineLeft + 24},${centerY} ${goalLineLeft},${centerY + 22}`}
          fill="rgba(50,100,220,0.12)" stroke="rgba(50,100,220,0.3)" strokeWidth={1}
        />
        <path
          d={`M ${goalLineRight},${centerY - 22} Q ${goalLineRight - 24},${centerY} ${goalLineRight},${centerY + 22}`}
          fill="rgba(50,100,220,0.12)" stroke="rgba(50,100,220,0.3)" strokeWidth={1}
        />
        {/* Nets */}
        <rect x={goalLineLeft - 9} y={centerY - 9} width={9} height={18} rx={2} fill="none" stroke="#aabbcc" strokeWidth={1} />
        <rect x={goalLineRight} y={centerY - 9} width={9} height={18} rx={2} fill="none" stroke="#aabbcc" strokeWidth={1} />
        {/* Team labels */}
        <text x={goalLineLeft - 24} y={15} textAnchor="middle" fill={awayColor} fontSize={9} fontFamily="'DM Mono',monospace" fontWeight={700}>{awayAbbr}</text>
        <text x={goalLineRight + 24} y={15} textAnchor="middle" fill={homeColor} fontSize={9} fontFamily="'DM Mono',monospace" fontWeight={700}>{homeAbbr}</text>
        {/* Shot dots */}
        {shotEvents.map((ev, i) => {
          if (ev.x == null || ev.y == null) return null;
          const cx = toSvgX(ev.x);
          const cy = toSvgY(ev.y);
          const baseR = Math.min(ev.xg * 10 + 5, 14);
          const isGoal = ev.type === "goal";
          const isMissed = ev.type === "missed-shot";
          const isBlocked = ev.type === "blocked-shot";
          const r = isGoal ? Math.min(baseR + 3, 17) : baseR;
          const color = ev.isHome ? homeColor : awayColor;

          if (isGoal) {
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={r + 4} fill={color} opacity={0.28} />
                <circle cx={cx} cy={cy} r={r} fill={color} opacity={1.0} stroke="#ffffff" strokeWidth={2} />
              </g>
            );
          }
          if (isMissed) {
            return <circle key={i} cx={cx} cy={cy} r={baseR} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} />;
          }
          if (isBlocked) {
            return <circle key={i} cx={cx} cy={cy} r={Math.max(baseR - 2, 3)} fill={color} opacity={0.25} />;
          }
          return <circle key={i} cx={cx} cy={cy} r={baseR} fill={color} opacity={0.8} />;
        })}
      </svg>
      {/* Legend */}
      <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
        {[
          { label: "Goal", fillOpacity: 1.0, stroke: "#ffffff", sw: 1.5 },
          { label: "Shot", fillOpacity: 0.8, stroke: "none", sw: 0 },
          { label: "Missed", fillOpacity: 0, stroke: "#8db9dc", sw: 1.5 },
          { label: "Blocked", fillOpacity: 0.25, stroke: "none", sw: 0 },
        ].map(({ label, fillOpacity, stroke, sw }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <svg width={12} height={12}>
              <circle cx={6} cy={6} r={5} fill="#8db9dc" fillOpacity={fillOpacity} stroke={stroke} strokeWidth={sw} />
            </svg>
            <span style={{ color: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>{label}</span>
          </div>
        ))}
        <div style={{ flexBasis: "100%", display: "flex", gap: 16, justifyContent: "center", marginTop: 2 }}>
          {[{ label: awayAbbr, color: awayColor }, { label: homeAbbr, color: homeColor }].map(({ label, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <svg width={10} height={10}><circle cx={5} cy={5} r={4} fill={color} opacity={0.85} /></svg>
              <span style={{ color, fontSize: 10, fontFamily: "'DM Mono',monospace" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PuckLuckMeter({ homeXG, awayXG, homeAbbr, awayAbbr, homeColor, awayColor }) {
  const total = homeXG + awayXG;
  const homeXGPct = total > 0 ? homeXG / total : 0.5;
  const theta = Math.PI * homeXGPct;
  const cx = 160, cy = 148, r = 110;
  const nx = cx + r * Math.cos(Math.PI - theta);
  const ny = cy - r * Math.sin(Math.PI - theta);
  return (
    <div style={{ textAlign: "center" }}>
      <svg viewBox="0 0 320 175" style={{ width: "100%", maxWidth: 320, height: "auto", display: "block", margin: "0 auto" }}>
        <path d="M 50,148 A 110,110 0 0,1 160,38" fill="none" stroke={awayColor} strokeWidth={18} strokeLinecap="round" opacity={0.4} />
        <path d="M 160,38 A 110,110 0 0,1 270,148" fill="none" stroke={homeColor} strokeWidth={18} strokeLinecap="round" opacity={0.4} />
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#eff8ff" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={6} fill="#eff8ff" />
        <text x={cx} y={cy - 18} textAnchor="middle" fill="#eff8ff" fontSize={22} fontWeight={900} fontFamily="'DM Mono',monospace">
          {(homeXGPct * 100).toFixed(0)}%
        </text>
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#5e7b98" fontSize={9} fontFamily="'DM Mono',monospace" letterSpacing="2">
          HOME xG SHARE
        </text>
        <text x={38} y={170} textAnchor="middle" fill={awayColor} fontSize={11} fontFamily="'DM Mono',monospace" fontWeight={700}>{awayAbbr}</text>
        <text x={282} y={170} textAnchor="middle" fill={homeColor} fontSize={11} fontFamily="'DM Mono',monospace" fontWeight={700}>{homeAbbr}</text>
        <text x={38} y={155} textAnchor="middle" fill={awayColor} fontSize={10} fontFamily="'DM Mono',monospace">{awayXG.toFixed(2)}</text>
        <text x={282} y={155} textAnchor="middle" fill={homeColor} fontSize={10} fontFamily="'DM Mono',monospace">{homeXG.toFixed(2)}</text>
      </svg>
      <div style={{ color: "#5e7b98", fontSize: 9, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>
        xG share — shot quality control
      </div>
    </div>
  );
}

function WinProbTooltip({ active, payload, homeAbbr, awayAbbr, homeColor, awayColor }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (d?.marker) return null;
  const sec = d?.x ?? 0;
  const period = Math.min(Math.floor(sec / 1200) + 1, 3);
  const minInPeriod = Math.floor((sec % 1200) / 60);
  return (
    <div style={{ background: "#0d1926", border: "1px solid #1e3349", borderRadius: 8, padding: "8px 12px", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
      <div style={{ color: "#5a7a96", marginBottom: 4 }}>P{period} {minInPeriod}:00</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>{p.dataKey === "home" ? homeAbbr : awayAbbr}: {p.value}%</div>
      ))}
    </div>
  );
}

function XGBarTooltip({ active, payload, homeAbbr, awayAbbr }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0d1926", border: "1px solid #1e3349", borderRadius: 8, padding: "8px 12px", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color }}>{p.dataKey === "home" ? homeAbbr : awayAbbr}: {Number(p.value).toFixed(2)} xG</div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GameStatsPanel({
  gameId,
  homeTeamId,
  awayTeamId,
  homeAbbr,
  awayAbbr,
  homeColor,
  awayColor,
  gameState,
  playerByGameStats,
}) {
  const [pbp, setPbp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    setPbp(null);

    async function fetchPBP() {
      try {
        const res = await fetch(`/api/nhl/pbp/${gameId}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) { setError(true); setLoading(false); }
          return;
        }
        const data = await res.json();
        if (!cancelled) { setPbp(data); setLoading(false); }
      } catch {
        if (!cancelled) { setError(true); setLoading(false); }
      }
    }

    fetchPBP();
    let interval = null;
    if (gameState === "LIVE" || gameState === "CRIT") {
      interval = setInterval(fetchPBP, 60_000);
    }
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [gameId, gameState]);

  if (loading) {
    return (
      <div style={{ color: "#5a7a96", fontFamily: "'DM Mono',monospace", fontSize: 12, padding: "16px 0" }}>
        Loading game analytics...
      </div>
    );
  }

  if (error || !pbp) {
    return (
      <div style={{ color: "#5a7a96", fontFamily: "'DM Mono',monospace", fontSize: 12, padding: "16px 0" }}>
        Game analytics unavailable
      </div>
    );
  }

  const { shotEvents, winProbTimeline, xgByPeriod, playerXG, totalHomeXG, totalAwayXG } =
    parsePBP(pbp, homeTeamId, awayTeamId);
  const totalXG = totalHomeXG + totalAwayXG;

  if (totalXG < 0.01) {
    return (
      <div style={{ color: "#5a7a96", fontFamily: "'DM Mono',monospace", fontSize: 12, padding: "16px 0" }}>
        No shot data available yet
      </div>
    );
  }

  const homeXGPct = totalHomeXG / totalXG;
  const awayXGPct = 1 - homeXGPct;

  const periodLabels = { 1: "P1", 2: "P2", 3: "P3", OT: "OT" };
  const xgPeriodData = Object.entries(xgByPeriod)
    .filter(([, v]) => v.home > 0 || v.away > 0)
    .map(([k, v]) => ({ period: periodLabels[k] ?? k, home: +v.home.toFixed(2), away: +v.away.toFixed(2) }));

  const awayPlayers = Object.entries(playerXG)
    .filter(([, v]) => !v.isHome)
    .sort(([, a], [, b]) => b.xg - a.xg)
    .slice(0, 6)
    .map(([, v]) => ({ name: v.name.split(" ").pop() ?? v.name, xg: +v.xg.toFixed(2) }));

  const homePlayers = Object.entries(playerXG)
    .filter(([, v]) => v.isHome)
    .sort(([, a], [, b]) => b.xg - a.xg)
    .slice(0, 6)
    .map(([, v]) => ({ name: v.name.split(" ").pop() ?? v.name, xg: +v.xg.toFixed(2) }));

  const hasWinProb = winProbTimeline.filter(d => !d.marker).length > 2;
  const playerBarHeight = 200;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <style>{`
        .gsp-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 700px) { .gsp-two-col { grid-template-columns: 1fr; } }
      `}</style>

      {/* 1. xG Share bar */}
      <div style={CARD}>
        <div style={SECTION_LABEL}>xG Share</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ textAlign: "left", minWidth: 64 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://assets.nhle.com/logos/nhl/svg/${awayAbbr}_light.svg`}
              width={24} height={24}
              style={{ display: "block", marginBottom: 4 }}
              alt={awayAbbr}
            />
            <div style={{ color: awayColor, fontSize: 18, fontWeight: 900, fontFamily: "'DM Mono',monospace" }}>
              {(awayXGPct * 100).toFixed(1)}%
            </div>
            <div style={MUTED}>xG: {totalAwayXG.toFixed(2)}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ height: 12, borderRadius: 999, background: "#1a2d40", overflow: "hidden", display: "flex" }}>
              <div style={{ width: `${awayXGPct * 100}%`, background: awayColor, transition: "width 0.4s ease" }} />
              <div style={{ flex: 1, background: homeColor }} />
            </div>
          </div>
          <div style={{ textAlign: "right", minWidth: 64 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://assets.nhle.com/logos/nhl/svg/${homeAbbr}_light.svg`}
              width={24} height={24}
              style={{ display: "block", marginBottom: 4, marginLeft: "auto" }}
              alt={homeAbbr}
            />
            <div style={{ color: homeColor, fontSize: 18, fontWeight: 900, fontFamily: "'DM Mono',monospace" }}>
              {(homeXGPct * 100).toFixed(1)}%
            </div>
            <div style={{ ...MUTED, textAlign: "right" }}>xG: {totalHomeXG.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* 2. Puck Luck | Win Probability */}
      <div className="gsp-two-col">
        <div style={{
          ...CARD,
          background: `linear-gradient(135deg, ${hexToRgba(awayColor, 0.08)} 0%, #091017 40%, #091017 60%, ${hexToRgba(homeColor, 0.08)} 100%)`,
        }}>
          <div style={SECTION_LABEL}>Puck luck · xG share</div>
          <PuckLuckMeter
            homeXG={totalHomeXG}
            awayXG={totalAwayXG}
            homeAbbr={homeAbbr}
            awayAbbr={awayAbbr}
            homeColor={homeColor}
            awayColor={awayColor}
          />
        </div>

        {hasWinProb ? (
          <div style={CARD}>
            <div style={SECTION_LABEL}>Win probability over time</div>
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={winProbTimeline} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#141f2d" vertical={false} />
                  <XAxis
                    dataKey="x"
                    type="number"
                    domain={[0, 3600]}
                    ticks={[0, 1200, 2400, 3600]}
                    tickFormatter={(v) => v === 0 ? "START" : v === 1200 ? "P2" : v === 2400 ? "P3" : "END"}
                    tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ReferenceLine y={50} stroke="#1a2d40" strokeDasharray="4 4" />
                  <ReferenceLine x={1200} stroke="#1a2d40" strokeDasharray="4 4" />
                  <ReferenceLine x={2400} stroke="#1a2d40" strokeDasharray="4 4" />
                  <Tooltip content={<WinProbTooltip homeAbbr={homeAbbr} awayAbbr={awayAbbr} homeColor={homeColor} awayColor={awayColor} />} />
                  <Line dataKey="away" stroke={awayColor} dot={false} strokeWidth={2} connectNulls strokeDasharray="5 3" />
                  <Line dataKey="home" stroke={homeColor} dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width={22} height={8}><line x1={0} y1={4} x2={22} y2={4} stroke={awayColor} strokeWidth={2} strokeDasharray="5 3" /></svg>
                <span style={MUTED}>{awayAbbr}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width={22} height={8}><line x1={0} y1={4} x2={22} y2={4} stroke={homeColor} strokeWidth={2} /></svg>
                <span style={MUTED}>{homeAbbr}</span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ ...CARD, alignItems: "center", justifyContent: "center" }}>
            <div style={MUTED}>Win probability data not yet available</div>
          </div>
        )}
      </div>

      {/* 3. xG By Period */}
      {xgPeriodData.length > 0 && (
        <div style={CARD}>
          <div style={SECTION_LABEL}>xG by period</div>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={xgPeriodData} barGap={4} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#141f2d" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
                <ReferenceLine y={0} stroke="#1a2d40" />
                <Tooltip content={<XGBarTooltip homeAbbr={homeAbbr} awayAbbr={awayAbbr} />} />
                <Bar dataKey="away" fill={awayColor} opacity={0.9} radius={[3, 3, 0, 0]} />
                <Bar dataKey="home" fill={homeColor} opacity={0.9} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
            {[{ label: awayAbbr, color: awayColor }, { label: homeAbbr, color: homeColor }].map(({ label, color }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: color, opacity: 0.9 }} />
                <span style={MUTED}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Shot map */}
      {shotEvents.length > 0 && (
        <div style={CARD}>
          <div style={SECTION_LABEL}>Shot map</div>
          <IceRink
            shotEvents={shotEvents}
            homeColor={homeColor}
            awayColor={awayColor}
            homeAbbr={homeAbbr}
            awayAbbr={awayAbbr}
            totalHomeXG={totalHomeXG}
            totalAwayXG={totalAwayXG}
          />
        </div>
      )}

      {/* 5. xG per player */}
      {(awayPlayers.length > 0 || homePlayers.length > 0) && (
        <div className="gsp-two-col">
          {awayPlayers.length > 0 && (
            <div style={CARD}>
              <div style={SECTION_LABEL}>{awayAbbr} xG Leaders</div>
              <div style={{ width: "100%", height: playerBarHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={awayPlayers} layout="vertical" margin={{ top: 0, right: 32, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={72} tick={{ fill: "#b8d4e8", fontSize: 11, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v) => [`${Number(v).toFixed(2)} xG`]}
                      contentStyle={{ background: "#0d1926", border: "1px solid #1e3349", borderRadius: 8, fontFamily: "'DM Mono',monospace", fontSize: 11 }}
                    />
                    <Bar dataKey="xg" fill={awayColor} radius={[0, 3, 3, 0]} opacity={0.9} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
          {homePlayers.length > 0 && (
            <div style={CARD}>
              <div style={SECTION_LABEL}>{homeAbbr} xG Leaders</div>
              <div style={{ width: "100%", height: playerBarHeight }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={homePlayers} layout="vertical" margin={{ top: 0, right: 32, left: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={72} tick={{ fill: "#b8d4e8", fontSize: 11, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v) => [`${Number(v).toFixed(2)} xG`]}
                      contentStyle={{ background: "#0d1926", border: "1px solid #1e3349", borderRadius: 8, fontFamily: "'DM Mono',monospace", fontSize: 11 }}
                    />
                    <Bar dataKey="xg" fill={homeColor} radius={[0, 3, 3, 0]} opacity={0.9} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. BoxscorePanel with real playerXGMap */}
      {playerByGameStats && (
        <>
          <SectionDivider label="Player boxscore" />
          <BoxscorePanel
            homeAbbr={homeAbbr}
            awayAbbr={awayAbbr}
            homeColor={homeColor}
            awayColor={awayColor}
            playerByGameStats={playerByGameStats}
            playerXGMap={playerXG}
          />
        </>
      )}
    </div>
  );
}
