"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

function formatTorontoDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(date);
}

function formatDateBadge(dateString) {
  const date = new Date(`${dateString}T12:00:00-04:00`);
  return {
    month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "America/Toronto" }).format(date).toUpperCase(),
    day: new Intl.DateTimeFormat("en-US", { day: "2-digit", timeZone: "America/Toronto" }).format(date),
  };
}

function periodInfo(game) {
  const desc = game.periodDescriptor ?? {};
  const clock = game.clock ?? {};
  const state = game.gameState ?? "";
  const startTime = game.startTimeUTC ? new Date(game.startTimeUTC) : null;

  if (["PRE", "FUT"].includes(state)) {
    const label = startTime
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Toronto",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(startTime)
      : "UPCOMING";

    return { label, tone: "upcoming" };
  }

  if (["OFF", "FINAL"].includes(state)) {
    if (desc.periodType === "SO" || (desc.number ?? 0) > 4) return { label: "FINAL/SO", tone: "final" };
    if (desc.periodType === "OT" || (desc.number ?? 0) === 4) return { label: "FINAL/OT", tone: "final" };
    return { label: "FINAL", tone: "final" };
  }

  if (clock.inIntermission) return { label: "INT", tone: "live" };
  const n = desc.number ?? 1;
  const time = clock.timeRemaining ?? "";
  if (desc.periodType === "OT" || n === 4) return { label: `OT ${time}`.trim(), tone: "live" };
  if (desc.periodType === "SO" || n > 4) return { label: "SO", tone: "live" };
  return { label: `P${n} ${time}`.trim(), tone: "live" };
}

function isRelevantGame(game) {
  return ["LIVE", "CRIT", "OFF", "FINAL", "PRE", "FUT"].includes(game.gameState ?? "");
}

function sortGames(games) {
  const priority = {
    LIVE: 0,
    CRIT: 0,
    OFF: 1,
    FINAL: 1,
    PRE: 2,
    FUT: 2,
  };

  return [...games].sort((a, b) => {
    const stateDiff = (priority[a.gameState] ?? 9) - (priority[b.gameState] ?? 9);
    if (stateDiff !== 0) return stateDiff;
    const startA = new Date(a.startTimeUTC ?? 0).getTime();
    const startB = new Date(b.startTimeUTC ?? 0).getTime();
    return startA - startB;
  });
}

function winnerStyles(awayScore, homeScore) {
  const tied = awayScore === homeScore;
  return {
    away: tied || awayScore < homeScore ? "#6e8094" : "#f5fbff",
    home: tied || homeScore < awayScore ? "#6e8094" : "#f5fbff",
  };
}

function ScoreCard({ game, dateString }) {
  const away = game.awayTeam ?? {};
  const home = game.homeTeam ?? {};
  const awayScore = away.score ?? 0;
  const homeScore = home.score ?? 0;
  const colors = winnerStyles(awayScore, homeScore);
  const status = periodInfo(game);
  const href = `/predictions/${dateString}/${game.id}`;

  return (
    <Link
      href={href}
      className="live-score-card"
      style={{
        minWidth: 190,
        padding: "10px 14px",
        borderLeft: "1px solid #183149",
        textDecoration: "none",
        display: "grid",
        gap: 10,
        flexShrink: 0,
        background: "linear-gradient(180deg, rgba(12,21,32,0.98) 0%, rgba(10,17,27,0.96) 100%)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: status.tone === "final" ? "#35e3a0" : status.tone === "live" ? "#d8e8f7" : "#8fb5da",
          fontFamily: "'DM Mono',monospace",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        {status.label}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {[{ team: away, score: awayScore, color: colors.away }, { team: home, score: homeScore, color: colors.home }].map(({ team, score, color }) => (
          <div key={team.abbrev} style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 10, alignItems: "center" }}>
            <img
              src={`https://assets.nhle.com/logos/nhl/svg/${team.abbrev}_light.svg`}
              alt={team.abbrev}
              width={24}
              height={24}
              style={{ objectFit: "contain", opacity: color === "#6e8094" ? 0.55 : 1 }}
            />
            <div style={{ color, fontSize: 18, fontWeight: 800, lineHeight: 1, letterSpacing: "0.01em" }}>
              {team.abbrev ?? "—"}
            </div>
            <div style={{ color, fontSize: 18, fontWeight: 900, lineHeight: 1 }}>
              {score}
            </div>
          </div>
        ))}
      </div>
    </Link>
  );
}

async function fetchScoreboardForDate(dateString) {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/schedule/${dateString}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const games =
      data.games ||
      data.gameWeek?.find((day) => day.date === dateString)?.games ||
      [];
    return sortGames((games || []).filter(isRelevantGame));
  } catch {
    return [];
  }
}

export default function LiveScoresBanner() {
  const [games, setGames] = useState([]);
  const [dateString] = useState(() => formatTorontoDate(new Date()));

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const nextGames = await fetchScoreboardForDate(dateString);
      if (!cancelled) {
        setGames(nextGames);
      }
    }

    refresh();
    const id = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [dateString]);

  const liveCount = useMemo(
    () => games.filter((game) => ["LIVE", "CRIT"].includes(game.gameState ?? "")).length,
    [games]
  );
  const finalCount = useMemo(
    () => games.filter((game) => ["OFF", "FINAL"].includes(game.gameState ?? "")).length,
    [games]
  );
  const upcomingCount = useMemo(
    () => games.filter((game) => ["PRE", "FUT"].includes(game.gameState ?? "")).length,
    [games]
  );

  if (!dateString || games.length === 0) return null;

  const dateBadge = formatDateBadge(dateString);
  const statusLabel =
    liveCount > 0
      ? `${liveCount} live`
      : finalCount > 0 && upcomingCount === 0
        ? `${finalCount} final`
        : upcomingCount > 0 && finalCount === 0
          ? `${upcomingCount} upcoming`
          : `${games.length} games`;

  return (
    <>
      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @media (max-width: 640px) {
          .live-score-card {
            min-width: 160px !important;
            padding: 9px 11px !important;
          }
        }
      `}</style>
      <div
        className="live-scores-banner"
        style={{
          position: "sticky",
          top: "var(--top-nav-height)",
          zIndex: 99,
          width: "100%",
          background: "#101b29",
          borderBottom: "1px solid #183149",
          display: "flex",
          alignItems: "stretch",
          overflowX: "auto",
          scrollbarWidth: "none",
        }}
      >
        <div
          style={{
            minWidth: 96,
            padding: "10px 12px",
            borderRight: "1px solid #183149",
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(180deg, rgba(18,32,47,0.98) 0%, rgba(14,24,36,0.98) 100%)",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 12, color: "#64a7e3", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {dateBadge.month}
          </div>
          <div style={{ fontSize: 20, color: "#eef8ff", fontWeight: 900, lineHeight: 1.1 }}>
            {dateBadge.day}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            {liveCount > 0 && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#35e3a0",
                  animation: "livePulse 1.5s ease-in-out infinite",
                }}
              />
            )}
            <span style={{ fontSize: 10, color: "#7f9bb7", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {statusLabel}
            </span>
          </div>
        </div>

        {games.map((game) => (
          <ScoreCard key={game.id} game={game} dateString={dateString} />
        ))}
      </div>
      <style>{`
        @media (max-width: 860px) {
          .live-scores-banner {
            top: var(--top-nav-height);
          }
        }
        @media (max-width: 640px) {
          .live-scores-banner {
            position: static !important;
          }
        }
      `}</style>
    </>
  );
}
