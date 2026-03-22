"use client";

import { useEffect, useMemo, useState } from "react";
import GameStatsPanel from "./GameStatsPanel";
import AnalyticsPanel from "./AnalyticsPanel";
import TeamComparison from "./TeamComparison";
import KeyMomentsPanel from "./KeyMomentsPanel";
import ScoringSummary from "./ScoringSummary";
import PlayerLeaders from "./PlayerLeaders";
import ModelRecap from "./ModelRecap";
import { buildPlayerLeaders, parsePostgamePbp, simulateDeservedWin } from "./postgameAnalytics";

function SectionBlock({ id, label, title, children, noTitle = false }) {
  return (
    <section id={id} style={{ scrollMarginTop: 138, display: "grid", gap: 14 }}>
      {!noTitle ? (
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "center" }}>
          <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>{label}</div>
          <div style={{ height: 1, background: "linear-gradient(90deg, rgba(115,141,165,0.55) 0%, rgba(23,40,59,0.4) 100%)" }} />
          <div style={{ color: "#eff8ff", fontSize: 28, fontWeight: 900 }}>{title}</div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

export default function PostgameDashboardClient({
  gameId,
  gameState,
  homeTeamId,
  awayTeamId,
  homeAbbr,
  awayAbbr,
  homeColor,
  awayColor,
  playerByGameStats,
  scoringSummary,
  keyMoments,
  teamGameStats,
  modelRecap,
}) {
  const [pbp, setPbp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    async function fetchPbp() {
      try {
        setLoading(true);
        setError(false);
        const res = await fetch(`/api/nhl/pbp/${gameId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("PBP unavailable");
        const data = await res.json();
        if (!cancelled) {
          setPbp(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    }

    fetchPbp();
    let interval = null;
    if (gameState === "LIVE" || gameState === "CRIT") {
      interval = setInterval(fetchPbp, 60_000);
    }
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [gameId, gameState]);

  const analytics = useMemo(() => {
    if (!pbp) return null;
    return parsePostgamePbp(pbp, homeTeamId, awayTeamId);
  }, [pbp, homeTeamId, awayTeamId]);

  const playerLeaders = useMemo(() => buildPlayerLeaders(playerByGameStats, analytics?.playerXG || {}, homeAbbr, awayAbbr), [playerByGameStats, analytics, homeAbbr, awayAbbr]);
  const deserved = useMemo(() => (analytics ? simulateDeservedWin(analytics.shotEvents || []) : null), [analytics]);

  return (
    <div style={{ display: "grid", gap: 28 }}>
      <div className="postgame-layout-grid">
        <div style={{ display: "grid", gap: 28 }}>
          <SectionBlock id="overview" label="Postgame" title="Game analytics">
            <AnalyticsPanel
              analytics={analytics}
              deserved={deserved}
              teamGameStats={teamGameStats}
              homeAbbr={homeAbbr}
              awayAbbr={awayAbbr}
              homeColor={homeColor}
              awayColor={awayColor}
              loading={loading}
              error={error}
            />
          </SectionBlock>

          <SectionBlock id="game-flow" label="Game Flow" title="Detailed flow and shot-quality breakdown">
            <GameStatsPanel
              gameId={gameId}
              homeTeamId={homeTeamId}
              awayTeamId={awayTeamId}
              homeAbbr={homeAbbr}
              awayAbbr={awayAbbr}
              homeColor={homeColor}
              awayColor={awayColor}
              gameState={gameState}
              playerByGameStats={playerByGameStats}
            />
          </SectionBlock>

          <SectionBlock id="team-stats" label="Team Stats" title="Mirrored game comparison">
            <TeamComparison
              teamGameStats={teamGameStats}
              analytics={analytics}
              playerByGameStats={playerByGameStats}
              awayAbbr={awayAbbr}
              homeAbbr={homeAbbr}
              awayColor={awayColor}
              homeColor={homeColor}
              title="Team comparison"
            />
          </SectionBlock>

          <SectionBlock id="scoring" label="Scoring" title="Goal timeline and summary">
            <ScoringSummary periods={scoringSummary} />
          </SectionBlock>
        </div>

        <aside style={{ display: "grid", gap: 18, alignContent: "start" }}>
          <SectionBlock id="highlights" label="Highlights" title="Key moments">
            <KeyMomentsPanel moments={keyMoments} compact />
          </SectionBlock>

          <SectionBlock id="players" label="Players" title="Leaders and standouts">
            <PlayerLeaders leaders={playerLeaders} awayColor={awayColor} homeColor={homeColor} awayAbbr={awayAbbr} homeAbbr={homeAbbr} compact />
          </SectionBlock>

          <SectionBlock id="model" label="Model" title="Pregame recap">
            <ModelRecap recap={modelRecap} awayColor={awayColor} homeColor={homeColor} awayAbbr={awayAbbr} homeAbbr={homeAbbr} compact />
          </SectionBlock>

          <div style={{ borderRadius: 24, border: "1px solid #16283a", background: "#0a121c", padding: "18px 20px", display: "grid", gap: 8 }}>
            <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Resources
            </div>
            <div style={{ color: "#eff8ff", fontSize: 22, fontWeight: 900 }}>Game report tools</div>
            <div style={{ color: "#88a3bb", lineHeight: 1.6, fontSize: 14 }}>
              Use the sections above to move between the scoring log, flow charts, and postgame model recap. Highlight links appear on key moments when clips are available from the NHL feed.
            </div>
          </div>
        </aside>
      </div>

      <style>{`
        .postgame-layout-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.48fr) minmax(320px, 0.88fr);
          gap: 22px;
        }
        @media (max-width: 1024px) {
          .postgame-layout-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
