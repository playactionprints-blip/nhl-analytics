import Link from "next/link";
import { notFound } from "next/navigation";
import { BreadcrumbSetter } from "@/Breadcrumbs";
import { TEAM_COLOR } from "@/app/lib/nhlTeams";
import {
  buildPredictionsForDate,
  formatHeadlineDate,
  formatStartTime,
  predictionHref,
} from "@/app/lib/predictionsData";
import { createServerClient } from "@/app/lib/supabase";
import { impliedProbabilityToAmericanOdds, removeOverroundFromMoneylines } from "@/src/utils/odds";
import GameHero, { buildHeroStatChips } from "./GameHero";
import GameTabs from "./GameTabs";
import PostgameDashboardClient from "./PostgameDashboardClient";

export const revalidate = 60;

function periodLabel(periodNumber) {
  if (periodNumber === 4) return "OT";
  if (periodNumber > 4) return `${periodNumber - 3}OT`;
  return ["1st", "2nd", "3rd"][periodNumber - 1] ?? `${periodNumber}`;
}

function headshotUrlForPlayer(playerId, headshot) {
  if (headshot) return headshot;
  if (!playerId) return null;
  return `https://assets.nhle.com/mugs/nhl/20252026/${playerId}.png`;
}

function elapsedSeconds(periodDescriptor, timeInPeriod) {
  const periodNum = periodDescriptor?.number ?? 1;
  if (!timeInPeriod) return (periodNum - 1) * 1200;
  const [mins, secs] = String(timeInPeriod).split(":").map(Number);
  return (periodNum - 1) * 1200 + (mins || 0) * 60 + (secs || 0);
}

function computeGameWinProb(homeScore, awayScore, totalSecondsElapsed) {
  const remaining = Math.max(3600 - totalSecondsElapsed, 0);
  const scoreDiff = homeScore - awayScore;
  const timeWeight = remaining / 3600;
  return Math.min(Math.max(0.5 + scoreDiff * 0.15 * (1 - timeWeight * 0.3), 0.02), 0.98);
}

function flattenKeyMoments(scoringSummary) {
  const goals = (scoringSummary || []).flatMap((period) =>
    (period.goals || []).map((goal) => {
      const isHome = Boolean(goal.isHome);
      const afterHome = Number(goal.homeScore || 0);
      const afterAway = Number(goal.awayScore || 0);
      const beforeHome = isHome ? afterHome - 1 : afterHome;
      const beforeAway = isHome ? afterAway : afterAway - 1;
      const timeElapsed = elapsedSeconds(period.periodDescriptor, goal.timeInPeriod);
      const beforeHomeProb = computeGameWinProb(beforeHome, beforeAway, timeElapsed);
      const afterHomeProb = computeGameWinProb(afterHome, afterAway, timeElapsed);
      const beforeTeamProb = isHome ? beforeHomeProb : 1 - beforeHomeProb;
      const afterTeamProb = isHome ? afterHomeProb : 1 - afterHomeProb;

      return {
        ...goal,
        periodDescriptor: period.periodDescriptor,
        displayName: goal.name?.default || [goal.firstName?.default, goal.lastName?.default].filter(Boolean).join(" "),
        scoreLine: `${afterAway}-${afterHome}`,
        headshotUrl: headshotUrlForPlayer(goal.playerId, goal.headshot),
        swing: afterTeamProb - beforeTeamProb,
      };
    })
  );

  return goals.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing)).slice(0, 4);
}

function formatStatus(landingData, gameState) {
  const periodType = landingData?.periodDescriptor?.periodType;
  const periodNumber = landingData?.periodDescriptor?.number;
  const clock = landingData?.clock?.timeRemaining;

  if (gameState === "LIVE" || gameState === "CRIT") {
    return `${periodLabel(periodNumber)} · ${clock || ""}`.trim();
  }
  if (["OFF", "FINAL"].includes(gameState)) {
    if (periodType === "SO") return "Final / SO";
    if (periodType === "OT" || (periodNumber ?? 0) > 3) return "Final / OT";
    return "Final";
  }
  return "Pregame";
}

function getArenaLabel(landingData) {
  return (
    landingData?.venue?.default ||
    landingData?.venue?.english ||
    landingData?.arena?.default ||
    landingData?.gameVenue?.default ||
    null
  );
}

async function fetchGameLanding(gameId) {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/landing`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchGameBoxscore(gameId) {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function buildTeamGameStatMap(teamGameStats = []) {
  return Object.fromEntries((teamGameStats || []).map((row) => [row.category, { away: row.awayValue, home: row.homeValue }]));
}

function buildModelRecap({ livePrediction, market, logRow, landingData, game }) {
  const homeScore = landingData?.homeTeam?.score ?? logRow?.home_score ?? null;
  const awayScore = landingData?.awayTeam?.score ?? logRow?.away_score ?? null;
  const actualWinner =
    homeScore != null && awayScore != null
      ? homeScore > awayScore
        ? game.homeTeam.abbr
        : game.awayTeam.abbr
      : logRow?.actual_winner ?? null;

  const base = livePrediction
    ? {
        source: "live",
        homeWinProb: livePrediction.homeWinPct,
        awayWinProb: livePrediction.awayWinPct,
        fairHomeOdds: livePrediction.fairOdds.homeMoneyline,
        fairAwayOdds: livePrediction.fairOdds.awayMoneyline,
        predictedWinner: livePrediction.homeWinPct >= livePrediction.awayWinPct ? game.homeTeam.abbr : game.awayTeam.abbr,
        confidenceBand: livePrediction.modelDiagnostics?.confidenceBand ?? null,
        simulations: livePrediction.modelDiagnostics?.simulationCount ?? null,
        marketHomeOdds: market?.homeMoneyline ?? null,
        marketAwayOdds: market?.awayMoneyline ?? null,
      }
    : logRow
      ? {
          source: "logged",
          homeWinProb: logRow.home_win_prob,
          awayWinProb: logRow.away_win_prob,
          fairHomeOdds: impliedProbabilityToAmericanOdds(logRow.home_win_prob),
          fairAwayOdds: impliedProbabilityToAmericanOdds(logRow.away_win_prob),
          predictedWinner: logRow.predicted_winner,
          confidenceBand: logRow.model_confidence ?? null,
          simulations: null,
          marketHomeOdds: logRow.home_odds ?? null,
          marketAwayOdds: logRow.away_odds ?? null,
        }
      : null;

  if (!base) return null;

  const normalizedMarket =
    typeof base.marketHomeOdds === "number" && typeof base.marketAwayOdds === "number"
      ? removeOverroundFromMoneylines(base.marketHomeOdds, base.marketAwayOdds)
      : null;

  return {
    ...base,
    finalResult:
      homeScore != null && awayScore != null
        ? `${game.awayTeam.abbr} ${awayScore} - ${homeScore} ${game.homeTeam.abbr}`
        : null,
    actualWinner,
    wasCorrect:
      typeof logRow?.correct === "boolean"
        ? logRow.correct
        : actualWinner && base.predictedWinner
          ? actualWinner === base.predictedWinner
          : null,
    marketHomeProb: normalizedMarket?.home ?? null,
    marketAwayProb: normalizedMarket?.away ?? null,
    marketHomeEdge: normalizedMarket ? base.homeWinProb - normalizedMarket.home : null,
    marketAwayEdge: normalizedMarket ? base.awayWinProb - normalizedMarket.away : null,
  };
}

export default async function GamePredictionDetailPage({ params }) {
  const { date, gameId } = await params;
  const [{ predictions }, landingData, boxscoreData] = await Promise.all([
    buildPredictionsForDate(date),
    fetchGameLanding(gameId),
    fetchGameBoxscore(gameId),
  ]);

  const matchup = predictions.find((item) => item.game.id === gameId);
  if (!matchup) notFound();

  const supabase = createServerClient();
  let logRow = null;
  try {
    const { data } = await supabase
      .from("predictions_log")
      .select("game_id,home_win_prob,away_win_prob,predicted_winner,model_confidence,home_odds,away_odds,actual_winner,home_score,away_score,correct")
      .eq("game_id", String(gameId))
      .maybeSingle();
    logRow = data ?? null;
  } catch {
    logRow = null;
  }

  const { game } = matchup;
  const livePrediction = matchup.prediction ?? null;
  const market = matchup.market ?? null;
  const awayColor = TEAM_COLOR[game.awayTeam.abbr] || "#4d82af";
  const homeColor = TEAM_COLOR[game.homeTeam.abbr] || "#4d82af";
  const gameState = landingData?.gameState ?? "FUT";
  const playerByGameStats = boxscoreData?.playerByGameStats ?? landingData?.playerByGameStats ?? null;
  const scoringSummary = landingData?.summary?.scoring ?? [];
  const teamGameStats = boxscoreData?.teamGameStats ?? [];
  const statMap = buildTeamGameStatMap(teamGameStats);
  const heroStatChips = buildHeroStatChips(statMap);
  const keyMoments = flattenKeyMoments(scoringSummary);
  const modelRecap = buildModelRecap({
    livePrediction,
    market,
    logRow,
    landingData,
    game,
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #0d2136 0%, #060a11 58%, #05090f 100%)",
        padding: "28px 20px 64px",
      }}
    >
      <BreadcrumbSetter
        items={[
          { href: "/predictions", label: "Predictions" },
          { href: predictionHref(date, game.id), label: `${game.awayTeam.abbr} at ${game.homeTeam.abbr}` },
        ]}
      />

      <div style={{ maxWidth: 1380, margin: "0 auto", display: "grid", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href="/predictions"
            style={{
              borderRadius: 999,
              border: "1px solid #294964",
              background: "rgba(47,180,255,0.12)",
              color: "#9fd8ff",
              padding: "8px 12px",
              textDecoration: "none",
              fontSize: 11,
              fontFamily: "'DM Mono',monospace",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            Back to predictions
          </Link>
          <div style={{ color: "#6f879f", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Game report · postgame first
          </div>
        </div>

        <GameHero
          awayTeam={game.awayTeam}
          homeTeam={game.homeTeam}
          awayScore={landingData?.awayTeam?.score ?? "—"}
          homeScore={landingData?.homeTeam?.score ?? "—"}
          statusLabel={formatStatus(landingData, gameState)}
          metaLabel={`${formatHeadlineDate(date)} · ${formatStartTime(game.startTimeUTC)} ET`}
          arenaLabel={getArenaLabel(landingData)}
          gameId={gameId}
          reportLabel="Game report"
          awayColor={awayColor}
          homeColor={homeColor}
          statChips={heroStatChips}
        />

        <GameTabs />

        <PostgameDashboardClient
          gameId={gameId}
          gameState={gameState}
          homeTeamId={landingData?.homeTeam?.id}
          awayTeamId={landingData?.awayTeam?.id}
          homeAbbr={game.homeTeam.abbr}
          awayAbbr={game.awayTeam.abbr}
          homeColor={homeColor}
          awayColor={awayColor}
          playerByGameStats={playerByGameStats}
          scoringSummary={scoringSummary}
          keyMoments={keyMoments}
          teamGameStats={teamGameStats}
          modelRecap={modelRecap}
        />
      </div>
    </div>
  );
}
