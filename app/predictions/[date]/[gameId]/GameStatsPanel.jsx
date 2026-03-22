"use client";
import { useState, useEffect, useId } from "react";
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

    // Normalize coordinates so home shots are always at positive x, away at negative x
    let plotX = xCoord ?? 0;
    let plotY = yCoord ?? 0;
    if (isHome && plotX < 0) { plotX = -plotX; plotY = -plotY; }
    else if (!isHome && plotX > 0) { plotX = -plotX; plotY = -plotY; }

    const xg = computeXG(xCoord, yCoord, shotType);
    const totalSec = periodSeconds(periodNum, timeInPeriod);

    const pKey = periodType === "OT" || periodNum > 3 ? "OT" : periodNum;
    if (xgByPeriod[pKey]) {
      xgByPeriod[pKey][isHome ? "home" : "away"] += xg;
    }

    shotEvents.push({
      x: xCoord, y: yCoord, plotX, plotY, xg, type: typeKey, isHome, period: periodNum, timeInPeriod,
      shooterName: nameMap[String(det.shootingPlayerId ?? det.scoringPlayerId ?? "")] ?? null,
    });

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

function simulateDeservedWin(shotEvents, numSims = 5000) {
  const scoringShots = shotEvents.filter(s => s.type !== "blocked-shot" && s.xg > 0);
  if (scoringShots.length === 0) return { home: 0.5, away: 0.5, sims: 0 };

  let homeWins = 0;
  let awayWins = 0;

  for (let sim = 0; sim < numSims; sim++) {
    let homeGoals = 0;
    let awayGoals = 0;
    for (const shot of scoringShots) {
      if (Math.random() < shot.xg) {
        if (shot.isHome) homeGoals++; else awayGoals++;
      }
    }
    if (homeGoals > awayGoals) homeWins++;
    else if (awayGoals > homeGoals) awayWins++;
    else { if (Math.random() < 0.5) homeWins++; else awayWins++; }
  }

  return { home: homeWins / numSims, away: awayWins / numSims, sims: numSims };
}

// ── SVG helpers ──────────────────────────────────────────────────────────────

const ICE_RECT = {
  x: 44,
  y: 14,
  width: 612,
  height: 272,
  rx: 20,
};

const NHL_COORDS = {
  minX: -100,
  maxX: 100,
  minY: -42.5,
  maxY: 42.5,
};

function rinkSvgX(x) {
  return ICE_RECT.x + ((x - NHL_COORDS.minX) / (NHL_COORDS.maxX - NHL_COORDS.minX)) * ICE_RECT.width;
}

function rinkSvgY(y) {
  return ICE_RECT.y + ((y - NHL_COORDS.minY) / (NHL_COORDS.maxY - NHL_COORDS.minY)) * ICE_RECT.height;
}

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
  const [hoveredShot, setHoveredShot] = useState(null);
  const clipId = useId().replace(/:/g, "");
  const displayShots = shotEvents.filter(s => s.type !== "blocked-shot");
  const homeShots = displayShots.filter(s => s.isHome).length;
  const awayShots = displayShots.filter(s => !s.isHome).length;

  const goalLineLeft = rinkSvgX(-89);
  const goalLineRight = rinkSvgX(89);
  const blueLineLeft = rinkSvgX(-25);
  const blueLineRight = rinkSvgX(25);
  const centerX = rinkSvgX(0);
  const centerY = rinkSvgY(0);
  const iceTop = ICE_RECT.y;
  const iceBottom = ICE_RECT.y + ICE_RECT.height;

  const handleShotEnter = (e, shot) => {
    const rect = e.currentTarget.closest("svg").getBoundingClientRect();
    setHoveredShot({ ...shot, tooltipX: e.clientX - rect.left, tooltipY: e.clientY - rect.top });
  };

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
      <div style={{ position: "relative", width: "100%" }}>
        <svg viewBox="0 0 700 300" style={{ width: "100%", height: "auto", display: "block" }}>
          <defs>
            <clipPath id={clipId}>
              <rect
                x={ICE_RECT.x}
                y={ICE_RECT.y}
                width={ICE_RECT.width}
                height={ICE_RECT.height}
                rx={ICE_RECT.rx}
              />
            </clipPath>
          </defs>
          {/* Boards */}
          <rect x={30} y={8} width={640} height={284} rx={28} fill="#071118" stroke="#1a3a5a" strokeWidth={2.5} />
          {/* Ice surface */}
          <rect x={ICE_RECT.x} y={ICE_RECT.y} width={ICE_RECT.width} height={ICE_RECT.height} rx={ICE_RECT.rx} fill="#e8f4f8" stroke="#b0ccd8" strokeWidth={1.5} />
          {/* Center ice circle */}
          <circle cx={centerX} cy={centerY} r={37} fill="none" stroke="rgba(50,100,220,0.4)" strokeWidth={1.5} />
          {/* Center line */}
          <line x1={centerX} y1={iceTop} x2={centerX} y2={iceBottom} stroke="rgba(220,50,50,0.7)" strokeWidth={2} />
          {/* Blue lines */}
          <line x1={blueLineLeft} y1={iceTop} x2={blueLineLeft} y2={iceBottom} stroke="rgba(50,100,220,0.7)" strokeWidth={2.5} />
          <line x1={blueLineRight} y1={iceTop} x2={blueLineRight} y2={iceBottom} stroke="rgba(50,100,220,0.7)" strokeWidth={2.5} />
          {/* Goal lines */}
          <line x1={goalLineLeft} y1={iceTop} x2={goalLineLeft} y2={iceBottom} stroke="rgba(220,50,50,0.5)" strokeWidth={1.5} />
          <line x1={goalLineRight} y1={iceTop} x2={goalLineRight} y2={iceBottom} stroke="rgba(220,50,50,0.5)" strokeWidth={1.5} />
          {/* Goal creases */}
          <path
            d={`M ${goalLineLeft},${centerY - 26} Q ${goalLineLeft + 28},${centerY} ${goalLineLeft},${centerY + 26}`}
            fill="rgba(50,100,220,0.15)" stroke="rgba(50,100,220,0.5)" strokeWidth={1}
          />
          <path
            d={`M ${goalLineRight},${centerY - 26} Q ${goalLineRight - 28},${centerY} ${goalLineRight},${centerY + 26}`}
            fill="rgba(50,100,220,0.15)" stroke="rgba(50,100,220,0.5)" strokeWidth={1}
          />
          {/* Nets */}
          <rect x={goalLineLeft - 10} y={centerY - 10.5} width={10} height={21} rx={2} fill="none" stroke="#8899aa" strokeWidth={1} />
          <rect x={goalLineRight} y={centerY - 10.5} width={10} height={21} rx={2} fill="none" stroke="#8899aa" strokeWidth={1} />
          {/* Team labels */}
          <text x={goalLineLeft - 28} y={22} textAnchor="middle" fill={awayColor} fontSize={9} fontFamily="'DM Mono',monospace" fontWeight={700}>{awayAbbr}</text>
          <text x={goalLineRight + 28} y={22} textAnchor="middle" fill={homeColor} fontSize={9} fontFamily="'DM Mono',monospace" fontWeight={700}>{homeAbbr}</text>
          {/* Shot dots */}
          <g clipPath={`url(#${clipId})`}>
            {displayShots.map((ev, i) => {
              const px = ev.plotX ?? ev.x;
              const py = ev.plotY ?? ev.y;
              if (px == null || py == null) return null;
              const cx = rinkSvgX(px);
              const cy = rinkSvgY(py);
              const baseR = Math.min(ev.xg * 10 + 4, 12);
              const isGoal = ev.type === "goal";
              const isMissed = ev.type === "missed-shot";
              const r = isGoal ? Math.min(baseR + 3, 17) : baseR;
              const color = ev.isHome ? homeColor : awayColor;

              if (isGoal) {
                return (
                  <g key={i} style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => handleShotEnter(e, ev)}
                    onMouseLeave={() => setHoveredShot(null)}>
                    <circle cx={cx + 1} cy={cy + 1} r={r} fill={color} opacity={0.2} />
                    <circle cx={cx} cy={cy} r={r + 4} fill={color} opacity={0.28} />
                    <circle cx={cx} cy={cy} r={r} fill={color} opacity={1.0} stroke="#1a1a1a" strokeWidth={2} />
                  </g>
                );
              }
              if (isMissed) {
                return (
                  <g key={i} style={{ cursor: "pointer" }}
                    onMouseEnter={(e) => handleShotEnter(e, ev)}
                    onMouseLeave={() => setHoveredShot(null)}>
                    <circle cx={cx + 1} cy={cy + 1} r={baseR} fill={color} opacity={0.2} />
                    <circle cx={cx} cy={cy} r={baseR} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} />
                  </g>
                );
              }
              return (
                <g key={i} style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => handleShotEnter(e, ev)}
                  onMouseLeave={() => setHoveredShot(null)}>
                  <circle cx={cx + 1} cy={cy + 1} r={baseR} fill={color} opacity={0.2} />
                  <circle cx={cx} cy={cy} r={baseR} fill={color} opacity={0.8} />
                </g>
              );
            })}
          </g>
        </svg>
        {hoveredShot && (
          <div style={{
            position: "absolute",
            left: hoveredShot.tooltipX > 400
              ? hoveredShot.tooltipX - 180
              : hoveredShot.tooltipX + 12,
            top: hoveredShot.tooltipY - 10,
            background: "#0a1520",
            border: "1px solid #1e3347",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 12,
            fontFamily: "'DM Mono',monospace",
            color: "#eff8ff",
            pointerEvents: "none",
            zIndex: 10,
            minWidth: 160,
            maxWidth: 220,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}>
            <div style={{
              color: hoveredShot.isHome ? homeColor : awayColor,
              fontWeight: 900, fontSize: 11, textTransform: "uppercase",
              letterSpacing: "0.08em", marginBottom: 6,
            }}>
              {hoveredShot.isHome ? homeAbbr : awayAbbr} · {hoveredShot.type === "goal" ? "GOAL" : hoveredShot.type === "shot-on-goal" ? "SHOT ON GOAL" : hoveredShot.type === "missed-shot" ? "MISSED" : "BLOCKED"}
            </div>
            {hoveredShot.shooterName && (
              <div style={{ color: "#eff8ff", fontWeight: 700, marginBottom: 4 }}>
                {hoveredShot.shooterName}
              </div>
            )}
            <div style={{ color: "#5e7b98", fontSize: 11 }}>
              Period {hoveredShot.period} · {hoveredShot.timeInPeriod}
            </div>
            <div style={{
              marginTop: 6, paddingTop: 6,
              borderTop: "1px solid #1e3347",
              color: "#2fb4ff", fontWeight: 900, fontSize: 13,
            }}>
              xG: {hoveredShot.xg.toFixed(3)}
            </div>
          </div>
        )}
      </div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 8, flexWrap: "wrap" }}>
        {[
          { label: "Goal", fillOpacity: 1.0, stroke: "#1a1a1a", sw: 1.5 },
          { label: "Shot", fillOpacity: 0.8, stroke: "none", sw: 0 },
          { label: "Missed", fillOpacity: 0, stroke: "#8db9dc", sw: 1.5 },
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

function DeservedToWinMeter({ homeDeserve, awayDeserve, homeAbbr, awayAbbr, homeColor, awayColor, sims }) {
  const W = 320;
  const H = 175;
  const cx = 160;
  const cy = 148;
  const R = 110;

  // The semicircle reads left-to-right from away to home, so the boundary
  // position is driven by the away share, not the home share.
  const boundaryAngleDeg = 180 - awayDeserve * 180;
  const needleAngleRad = (boundaryAngleDeg * Math.PI) / 180;
  const needleX = cx + R * Math.cos(needleAngleRad);
  const needleY = cy - R * Math.sin(needleAngleRad);

  function pt(deg) {
    const rad = (deg * Math.PI) / 180;
    return [cx + R * Math.cos(rad), cy - R * Math.sin(rad)];
  }
  function bgArc() {
    // Two 90° segments to avoid the degenerate 180° case
    const [lx, ly] = pt(180), [tx, ty] = pt(90), [rx, ry] = pt(0);
    return `M ${lx.toFixed(2)} ${ly.toFixed(2)} A ${R} ${R} 0 0 1 ${tx.toFixed(2)} ${ty.toFixed(2)} A ${R} ${R} 0 0 1 ${rx.toFixed(2)} ${ry.toFixed(2)}`;
  }
  function coloredArc(startDeg, endDeg) {
    if (Math.abs(startDeg - endDeg) < 0.5) return "";
    const [x1, y1] = pt(startDeg), [x2, y2] = pt(endDeg);
    const largeArc = Math.abs(startDeg - endDeg) > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  const bgArcPath = bgArc();
  const awayArcPath = boundaryAngleDeg < 179.5 ? coloredArc(180, boundaryAngleDeg) : null;
  const homeArcPath = boundaryAngleDeg > 0.5 ? coloredArc(boundaryAngleDeg, 0) : null;

  const leader = homeDeserve >= awayDeserve ? homeAbbr : awayAbbr;
  const leaderPct = Math.max(homeDeserve, awayDeserve);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, height: "auto", display: "block", margin: "0 auto", overflow: "visible" }}>
        {/* Background arc */}
        <path d={bgArcPath} fill="none" stroke="#1a2d40" strokeWidth={18} strokeLinecap="butt" />
        {/* Away colored arc */}
        {awayArcPath && (
          <path d={awayArcPath} fill="none" stroke={awayColor} strokeWidth={18} strokeLinecap="round" opacity={0.85} />
        )}
        {/* Home colored arc */}
        {homeArcPath && (
          <path d={homeArcPath} fill="none" stroke={homeColor} strokeWidth={18} strokeLinecap="round" opacity={0.85} />
        )}
        {/* Needle */}
        <line x1={cx} y1={cy} x2={needleX} y2={needleY} stroke="#ffffff" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={6} fill="#ffffff" opacity={0.9} />
        {/* Center text */}
        <text x={cx} y={cy - 18} fill="#eff8ff" fontSize={20} fontWeight={900} fontFamily="'DM Mono',monospace" textAnchor="middle">
          {(leaderPct * 100).toFixed(1)}%
        </text>
        <text x={cx} y={cy - 4} fill="#5e7b98" fontSize={9} fontFamily="'DM Mono',monospace" textAnchor="middle">
          {leader} deserved
        </text>
        {/* Away label — bottom left */}
        <text x={20} y={H - 8} fill={awayColor} fontSize={11} fontWeight={700} fontFamily="'DM Mono',monospace">
          {awayAbbr} {(awayDeserve * 100).toFixed(1)}%
        </text>
        {/* Home label — bottom right */}
        <text x={W - 20} y={H - 8} fill={homeColor} fontSize={11} fontWeight={700} fontFamily="'DM Mono',monospace" textAnchor="end">
          {homeAbbr} {(homeDeserve * 100).toFixed(1)}%
        </text>
      </svg>
      {sims > 0 && (
        <div style={{ textAlign: "center", fontSize: 10, color: "#3a5570", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em" }}>
          {sims.toLocaleString()} game simulations · each shot rolled independently
        </div>
      )}
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
    const resetTimer = setTimeout(() => {
      if (!cancelled) {
        setLoading(true);
        setError(false);
        setPbp(null);
      }
    }, 0);

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
      clearTimeout(resetTimer);
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
  const deserved = simulateDeservedWin(shotEvents);

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
          <div style={SECTION_LABEL}>Deserved to win</div>
          <DeservedToWinMeter
            homeDeserve={deserved.home}
            awayDeserve={deserved.away}
            homeAbbr={homeAbbr}
            awayAbbr={awayAbbr}
            homeColor={homeColor}
            awayColor={awayColor}
            sims={deserved.sims}
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
