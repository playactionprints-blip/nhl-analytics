"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

function periodInfo(game) {
  const desc = game.periodDescriptor ?? {};
  const clock = game.clock ?? {};
  if (clock.inIntermission) return { label: "INT", color: "#f0c040" };
  const n = desc.number ?? 1;
  const time = clock.timeRemaining ?? "";
  if (desc.periodType === "OT" || n === 4) return { label: `OT ${time}`, color: "#eff8ff" };
  if (desc.periodType === "SO" || n > 4) return { label: "SO", color: "#eff8ff" };
  return { label: `P${n} ${time}`, color: "#eff8ff" };
}

function GameChip({ game, today }) {
  const away = game.awayTeam ?? {};
  const home = game.homeTeam ?? {};
  const awayScore = away.score ?? 0;
  const homeScore = home.score ?? 0;
  const tied = awayScore === homeScore;
  const awayWin = awayScore > homeScore;
  const period = periodInfo(game);
  const href = `/predictions/${today}/${game.id}`;

  return (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 999,
        background: "#0d1926",
        border: "1px solid #1e3048",
        textDecoration: "none",
        flexShrink: 0,
        fontSize: 12,
        fontFamily: "'DM Mono',monospace",
        letterSpacing: "0.03em",
        color: "#eff8ff",
        transition: "border-color 0.15s ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#2fb4ff")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#1e3048")}
    >
      <span style={{ color: tied || !awayWin ? "#4a6a88" : "#eff8ff" }}>
        {away.abbrev ?? "—"}
      </span>
      <span style={{ color: tied || !awayWin ? "#4a6a88" : "#eff8ff", fontWeight: 800 }}>
        {awayScore}
      </span>
      <span style={{ color: "#2e4a65" }}>–</span>
      <span style={{ color: tied || awayWin ? "#4a6a88" : "#eff8ff", fontWeight: 800 }}>
        {homeScore}
      </span>
      <span style={{ color: tied || awayWin ? "#4a6a88" : "#eff8ff" }}>
        {home.abbrev ?? "—"}
      </span>
      <span style={{ color: "#2e4a65", margin: "0 1px" }}>·</span>
      <span style={{ color: period.color, fontSize: 10, letterSpacing: "0.05em" }}>
        {period.label}
      </span>
    </Link>
  );
}

async function fetchLiveGames() {
  try {
    const res = await fetch("https://api-web.nhle.com/v1/schedule/now", { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const games = data.gameWeek?.[0]?.games ?? [];
    return games.filter((g) => ["LIVE", "CRIT"].includes(g.gameState));
  } catch {
    return [];
  }
}

export default function LiveScoresBanner() {
  const [liveGames, setLiveGames] = useState([]);
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date())
    );

    let cancelled = false;

    async function refresh() {
      const games = await fetchLiveGames();
      if (!cancelled) setLiveGames(games);
    }

    refresh();
    const id = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (liveGames.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
      <div
        style={{
          position: "sticky",
          top: 44,
          zIndex: 99,
          width: "100%",
          background: "#060d16",
          borderBottom: "1px solid #1a2d40",
          padding: "0 16px",
          height: 36,
          display: "flex",
          alignItems: "center",
          gap: 20,
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        {/* LIVE label */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#ff4444",
              animation: "livePulse 1.5s ease-in-out infinite",
            }}
          />
          <div
            style={{
              background: "rgba(255,68,68,0.15)",
              color: "#ff4444",
              fontSize: 10,
              fontFamily: "'DM Mono',monospace",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              padding: "3px 8px",
              borderRadius: 999,
            }}
          >
            Live
          </div>
        </div>

        {/* Game chips */}
        {liveGames.map((game) => (
          <GameChip key={game.id} game={game} today={today} />
        ))}
      </div>
    </>
  );
}
