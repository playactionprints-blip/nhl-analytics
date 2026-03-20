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
  Legend,
} from "recharts";

// ── Pure helpers ────────────────────────────────────────────────────────────

function computeXG(xCoord, yCoord, shotType) {
  // Normalize so we're always shooting toward positive x (net at x=89)
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

  // Build id → name map
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

    // For blocked shots: eventOwnerTeamId is the BLOCKING team, so attacker is the other team
    let isHome;
    if (typeKey === "blocked-shot") {
      isHome = teamId !== homeTeamId;
    } else {
      isHome = teamId === homeTeamId;
    }

    const xg = computeXG(xCoord, yCoord, shotType);
    const totalSec = periodSeconds(periodNum, timeInPeriod);

    // xG by period
    const pKey = periodType === "OT" || periodNum > 3 ? "OT" : periodNum;
    if (xgByPeriod[pKey]) {
      xgByPeriod[pKey][isHome ? "home" : "away"] += xg;
    }

    // Shot event for map
    shotEvents.push({
      x: xCoord,
      y: yCoord,
      xg,
      type: typeKey,
      isHome,
      period: periodNum,
    });

    // Player xG
    const shooterId = String(det.shootingPlayerId ?? det.playerId ?? "");
    if (shooterId && typeKey !== "blocked-shot") {
      if (!playerXG[shooterId]) {
        playerXG[shooterId] = { name: nameMap[shooterId] ?? shooterId, xg: 0, shots: 0, isHome };
      }
      playerXG[shooterId].xg += xg;
      if (typeKey === "shot-on-goal" || typeKey === "goal") playerXG[shooterId].shots += 1;
    }

    // Win prob at goals
    if (typeKey === "goal") {
      if (isHome) homeScore++; else awayScore++;
      const prob = computeWinProb(homeScore, awayScore, totalSec);
      winProbTimeline.push({ x: totalSec, home: Math.round(prob * 100), away: Math.round((1 - prob) * 100) });
    }
  }

  // Add period markers
  for (const [sec, label] of [[1200, "P2"], [2400, "P3"]]) {
    winProbTimeline.push({ x: sec, marker: label });
  }
  winProbTimeline.sort((a, b) => a.x - b.x);

  const totalHomeXG = Object.values(xgByPeriod).reduce((s, p) => s + p.home, 0);
  const totalAwayXG = Object.values(xgByPeriod).reduce((s, p) => s + p.away, 0);

  return { shotEvents, winProbTimeline, xgByPeriod, playerXG, totalHomeXG, totalAwayXG };
}

// ── SVG helpers ─────────────────────────────────────────────────────────────

// NHL coordinate system: x in [-100, 100], y in [-42.5, 42.5]
// SVG viewBox "0 0 500 210"
function toSvgX(x) { return (x + 100) * 2.5; }
function toSvgY(y) { return (y + 42.5) * 2.47; }

function IceRink({ shotEvents, homeColor, awayColor, homeAbbr, awayAbbr }) {
  return (
    <svg viewBox="0 0 500 210" style={{ width: "100%", maxWidth: 500, height: "auto", display: "block", margin: "0 auto" }}>
      {/* Ice surface */}
      <rect x={0} y={0} width={500} height={210} rx={20} fill="#071118" />
      {/* Center line */}
      <line x1={250} y1={0} x2={250} y2={210} stroke="#cc3333" strokeWidth={1.5} opacity={0.6} />
      {/* Blue lines */}
      <line x1={150} y1={0} x2={150} y2={210} stroke="#2255cc" strokeWidth={1.5} opacity={0.6} />
      <line x1={350} y1={0} x2={350} y2={210} stroke="#2255cc" strokeWidth={1.5} opacity={0.6} />
      {/* Goal lines */}
      <line x1={55} y1={20} x2={55} y2={190} stroke="#cc3333" strokeWidth={1} opacity={0.5} />
      <line x1={445} y1={20} x2={445} y2={190} stroke="#cc3333" strokeWidth={1} opacity={0.5} />
      {/* Nets */}
      <rect x={45} y={97} width={10} height={16} rx={2} fill="none" stroke="#aabbcc" strokeWidth={1} />
      <rect x={445} y={97} width={10} height={16} rx={2} fill="none" stroke="#aabbcc" strokeWidth={1} />
      {/* Team labels */}
      <text x={28} y={12} textAnchor="middle" fill={awayColor} fontSize={9} fontFamily="'DM Mono',monospace" fontWeight={700}>{awayAbbr}</text>
      <text x={472} y={12} textAnchor="middle" fill={homeColor} fontSize={9} fontFamily="'DM Mono',monospace" fontWeight={700}>{homeAbbr}</text>
      {/* Shot dots */}
      {shotEvents.map((ev, i) => {
        if (ev.x == null || ev.y == null) return null;
        const cx = toSvgX(ev.x);
        const cy = toSvgY(ev.y);
        const r = 3 + ev.xg * 8;
        const isGoal = ev.type === "goal";
        const isMissed = ev.type === "missed-shot";
        const isBlocked = ev.type === "blocked-shot";
        const opacity = isGoal ? 1.0 : isMissed ? 0.3 : isBlocked ? 0.2 : 0.65;
        const fill = ev.isHome ? homeColor : awayColor;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill={fill}
            opacity={opacity}
            stroke={isGoal ? "#ffffff" : "none"}
            strokeWidth={isGoal ? 1.5 : 0}
          />
        );
      })}
    </svg>
  );
}

function PuckLuckMeter({ homeXG, awayXG, homeAbbr, awayAbbr, homeColor, awayColor }) {
  const total = homeXG + awayXG;
  const homeXGPct = total > 0 ? homeXG / total : 0.5;
  // Semicircle gauge: left=away, right=home
  // Needle angle: theta=0 → pure away (left), theta=π → pure home (right)
  // homeXGPct=0.5 → needle at top (θ=π/2)
  const theta = Math.PI * homeXGPct;
  const cx = 150, cy = 140, r = 110;
  const nx = cx + r * Math.cos(Math.PI - theta);
  const ny = cy - r * Math.sin(Math.PI - theta);

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ color: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
        Puck luck (xG share)
      </div>
      <svg viewBox="0 0 300 160" style={{ width: "100%", maxWidth: 300, height: "auto", display: "block", margin: "0 auto" }}>
        {/* Away arc (left half) */}
        <path d={`M 40,140 A 110,110 0 0,1 150,30`} fill="none" stroke={awayColor} strokeWidth={16} strokeLinecap="round" opacity={0.4} />
        {/* Home arc (right half) */}
        <path d={`M 150,30 A 110,110 0 0,1 260,140`} fill="none" stroke={homeColor} strokeWidth={16} strokeLinecap="round" opacity={0.4} />
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#eff8ff" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={5} fill="#eff8ff" />
        {/* Labels */}
        <text x={28} y={155} textAnchor="middle" fill={awayColor} fontSize={11} fontFamily="'DM Mono',monospace" fontWeight={700}>{awayAbbr}</text>
        <text x={272} y={155} textAnchor="middle" fill={homeColor} fontSize={11} fontFamily="'DM Mono',monospace" fontWeight={700}>{homeAbbr}</text>
        {/* xG values */}
        <text x={28} y={140} textAnchor="middle" fill={awayColor} fontSize={10} fontFamily="'DM Mono',monospace">{awayXG.toFixed(2)}</text>
        <text x={272} y={140} textAnchor="middle" fill={homeColor} fontSize={10} fontFamily="'DM Mono',monospace">{homeXG.toFixed(2)}</text>
      </svg>
    </div>
  );
}

// ── Custom tooltip ──────────────────────────────────────────────────────────

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

// ── Main component ──────────────────────────────────────────────────────────

const SECTION_LABEL = {
  color: "#5a7a96",
  fontSize: 10,
  fontFamily: "'DM Mono',monospace",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 8,
};

export default function GameStatsPanel({
  gameId,
  homeTeamId,
  awayTeamId,
  homeAbbr,
  awayAbbr,
  homeColor,
  awayColor,
  gameState,
}) {
  const [pbp, setPbp] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchPBP() {
      try {
        const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`, {
          cache: "no-store",
        });
        if (!res.ok) { setError(true); return; }
        const data = await res.json();
        if (!cancelled) setPbp(data);
      } catch {
        if (!cancelled) setError(true);
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

  if (error || !pbp) return null;

  const { shotEvents, winProbTimeline, xgByPeriod, playerXG, totalHomeXG, totalAwayXG } =
    parsePBP(pbp, homeTeamId, awayTeamId);

  const totalXG = totalHomeXG + totalAwayXG;
  if (totalXG < 0.01) return null;

  const homeXGPct = totalXG > 0 ? totalHomeXG / totalXG : 0.5;
  const awayXGPct = 1 - homeXGPct;

  // xG by period chart data
  const periodLabels = { 1: "P1", 2: "P2", 3: "P3", OT: "OT" };
  const xgPeriodData = Object.entries(xgByPeriod)
    .filter(([, v]) => v.home > 0 || v.away > 0)
    .map(([k, v]) => ({ period: periodLabels[k] ?? k, home: +v.home.toFixed(2), away: +v.away.toFixed(2) }));

  // Top players by xG
  const topPlayers = Object.entries(playerXG)
    .sort(([, a], [, b]) => b.xg - a.xg)
    .slice(0, 12)
    .map(([, v]) => ({ name: v.name.split(" ").slice(-1)[0], xg: +v.xg.toFixed(2), isHome: v.isHome }));

  const CARD = {
    borderRadius: 20,
    border: "1px solid #17283b",
    background: "#091017",
    padding: "16px 20px",
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Win probability bar */}
      <div style={CARD}>
        <div style={SECTION_LABEL}>Expected goals share</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: awayColor, fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700, minWidth: 32 }}>{awayAbbr}</span>
          <div style={{ flex: 1, height: 10, borderRadius: 999, background: "#1a2d40", overflow: "hidden", display: "flex" }}>
            <div style={{ width: `${awayXGPct * 100}%`, background: awayColor, transition: "width 0.4s ease" }} />
            <div style={{ flex: 1, background: homeColor }} />
          </div>
          <span style={{ color: homeColor, fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 700, minWidth: 32, textAlign: "right" }}>{homeAbbr}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ color: awayColor, fontFamily: "'DM Mono',monospace", fontSize: 11 }}>{(awayXGPct * 100).toFixed(1)}% · {totalAwayXG.toFixed(2)} xG</span>
          <span style={{ color: homeColor, fontFamily: "'DM Mono',monospace", fontSize: 11 }}>{totalHomeXG.toFixed(2)} xG · {(homeXGPct * 100).toFixed(1)}%</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Puck luck meter */}
        <div style={CARD}>
          <PuckLuckMeter
            homeXG={totalHomeXG}
            awayXG={totalAwayXG}
            homeAbbr={homeAbbr}
            awayAbbr={awayAbbr}
            homeColor={homeColor}
            awayColor={awayColor}
          />
        </div>

        {/* xG by period */}
        {xgPeriodData.length > 0 && (
          <div style={CARD}>
            <div style={SECTION_LABEL}>xG by period</div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={xgPeriodData} barGap={2} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#141f2d" vertical={false} />
                <XAxis dataKey="period" tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
                <Tooltip content={<XGBarTooltip homeAbbr={homeAbbr} awayAbbr={awayAbbr} />} />
                <Bar dataKey="away" fill={awayColor} opacity={0.75} radius={[3, 3, 0, 0]} />
                <Bar dataKey="home" fill={homeColor} opacity={0.75} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Win probability over time */}
      {winProbTimeline.length > 2 && (
        <div style={CARD}>
          <div style={SECTION_LABEL}>Win probability over time</div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={winProbTimeline} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#141f2d" vertical={false} />
              <XAxis dataKey="x" type="number" domain={[0, 3600]} tickCount={5}
                tickFormatter={(v) => `P${Math.min(Math.floor(v / 1200) + 1, 3)}`}
                tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
                axisLine={false} tickLine={false}
              />
              <YAxis domain={[0, 100]} tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
              <ReferenceLine y={50} stroke="#1e3349" strokeDasharray="4 4" />
              <ReferenceLine x={1200} stroke="#1e3349" strokeDasharray="4 4" />
              <ReferenceLine x={2400} stroke="#1e3349" strokeDasharray="4 4" />
              <Tooltip content={<WinProbTooltip homeAbbr={homeAbbr} awayAbbr={awayAbbr} homeColor={homeColor} awayColor={awayColor} />} />
              <Line dataKey="away" stroke={awayColor} dot={false} strokeWidth={2} connectNulls />
              <Line dataKey="home" stroke={homeColor} dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Shot map */}
      {shotEvents.length > 0 && (
        <div style={CARD}>
          <div style={SECTION_LABEL}>Shot map</div>
          <IceRink shotEvents={shotEvents} homeColor={homeColor} awayColor={awayColor} homeAbbr={homeAbbr} awayAbbr={awayAbbr} />
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
            {[
              { label: "Goal", opacity: 1.0, stroke: true },
              { label: "Shot on goal", opacity: 0.65 },
              { label: "Missed", opacity: 0.3 },
              { label: "Blocked", opacity: 0.2 },
            ].map(({ label, opacity, stroke }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <svg width={10} height={10}>
                  <circle cx={5} cy={5} r={4} fill="#8db9dc" opacity={opacity} stroke={stroke ? "#ffffff" : "none"} strokeWidth={stroke ? 1 : 0} />
                </svg>
                <span style={{ color: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* xG per player */}
      {topPlayers.length > 0 && (
        <div style={CARD}>
          <div style={SECTION_LABEL}>xG per player (top 12)</div>
          <ResponsiveContainer width="100%" height={topPlayers.length * 24 + 16}>
            <BarChart data={topPlayers} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: "#5a7a96", fontSize: 10, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={70} tick={{ fill: "#b8d4e8", fontSize: 11, fontFamily: "'DM Mono',monospace" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => [`${Number(v).toFixed(2)} xG`]} contentStyle={{ background: "#0d1926", border: "1px solid #1e3349", borderRadius: 8, fontFamily: "'DM Mono',monospace", fontSize: 11 }} />
              <Bar dataKey="xg" radius={[0, 3, 3, 0]}
                fill="#2fb4ff"
                label={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
