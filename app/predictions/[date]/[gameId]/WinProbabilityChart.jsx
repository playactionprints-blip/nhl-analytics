"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { hexToRgba } from "./postgameAnalytics";

function TooltipCard({ active, payload, homeAbbr, awayAbbr, homeColor, awayColor }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point || point.marker) return null;
  const sec = point.x ?? 0;
  const period = Math.min(Math.floor(sec / 1200) + 1, 3);
  const minute = Math.floor((sec % 1200) / 60);
  const second = Math.floor(sec % 60);

  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid #1f344a",
        background: "#0b151f",
        padding: "10px 12px",
        fontSize: 11,
        fontFamily: "'DM Mono',monospace",
        boxShadow: "0 12px 24px rgba(0,0,0,0.24)",
      }}
    >
      <div style={{ color: "#6e8ba6", marginBottom: 6 }}>
        P{period} {String(minute).padStart(2, "0")}:{String(second).padStart(2, "0")}
      </div>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={{ color: entry.dataKey === "home" ? homeColor : awayColor }}>
          {entry.dataKey === "home" ? homeAbbr : awayAbbr}: {entry.value}%
        </div>
      ))}
    </div>
  );
}

export default function WinProbabilityChart({
  timeline,
  homeAbbr,
  awayAbbr,
  homeColor,
  awayColor,
  loading,
  error,
}) {
  if (loading) {
    return (
      <div style={{ minHeight: 320, display: "grid", placeItems: "center", color: "#6f879f", fontFamily: "'DM Mono',monospace" }}>
        Loading game flow...
      </div>
    );
  }

  const data = (timeline || []).filter((point) => !point.marker);
  if (error || data.length < 2) {
    return (
      <div style={{ minHeight: 320, display: "grid", placeItems: "center", color: "#6f879f", fontFamily: "'DM Mono',monospace" }}>
        Game flow chart unavailable
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Game Flow
          </div>
          <div style={{ color: "#eff8ff", fontSize: 28, fontWeight: 900, marginTop: 4 }}>Win probability over time</div>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {[
            { label: awayAbbr, color: awayColor, dashed: true },
            { label: homeAbbr, color: homeColor, dashed: false },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width={24} height={10}>
                <line
                  x1={1}
                  y1={5}
                  x2={23}
                  y2={5}
                  stroke={item.color}
                  strokeWidth={2}
                  strokeDasharray={item.dashed ? "5 3" : undefined}
                />
              </svg>
              <span style={{ color: "#9bb3c9", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="homeFlowFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={hexToRgba(homeColor, 0.32)} />
                <stop offset="100%" stopColor={hexToRgba(homeColor, 0.02)} />
              </linearGradient>
              <linearGradient id="awayFlowFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={hexToRgba(awayColor, 0.26)} />
                <stop offset="100%" stopColor={hexToRgba(awayColor, 0.02)} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="#142233" vertical={false} />
            <XAxis
              dataKey="x"
              type="number"
              domain={[0, 3600]}
              ticks={[0, 1200, 2400, 3600]}
              tickFormatter={(value) => (value === 0 ? "Start" : value === 1200 ? "P2" : value === 2400 ? "P3" : "Final")}
              tick={{ fill: "#66829d", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(value) => `${value}%`}
              tick={{ fill: "#66829d", fontSize: 10, fontFamily: "'DM Mono',monospace" }}
              axisLine={false}
              tickLine={false}
            />
            <ReferenceLine y={50} stroke="#22384d" strokeDasharray="4 4" />
            <ReferenceLine x={1200} stroke="#1b3045" strokeDasharray="4 4" />
            <ReferenceLine x={2400} stroke="#1b3045" strokeDasharray="4 4" />
            <Tooltip content={<TooltipCard homeAbbr={homeAbbr} awayAbbr={awayAbbr} homeColor={homeColor} awayColor={awayColor} />} />
            <Area type="monotone" dataKey="away" stroke="none" fill="url(#awayFlowFill)" fillOpacity={1} />
            <Area type="monotone" dataKey="home" stroke="none" fill="url(#homeFlowFill)" fillOpacity={1} />
            <Line type="monotone" dataKey="away" stroke={awayColor} strokeWidth={2.5} dot={false} strokeDasharray="5 3" />
            <Line type="monotone" dataKey="home" stroke={homeColor} strokeWidth={2.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

