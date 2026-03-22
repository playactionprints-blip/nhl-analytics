import { createServerClient } from "@/app/lib/supabase";
import { TEAM_COLOR } from "@/app/lib/nhlTeams";
import {
  buildPredictionsForDate,
  confidenceMeta,
  formatDateString,
  formatHeadlineDate,
  formatStartTime,
  getTorontoDateParts,
  predictionHref,
} from "@/app/lib/predictionsData";
import DailyInsights from "@/app/components/home/DailyInsights";
import FeatureGrid from "@/app/components/home/FeatureGrid";
import FeaturedPlayersPreview from "@/app/components/home/FeaturedPlayersPreview";
import HomeCTA from "@/app/components/home/HomeCTA";
import HomeHero from "@/app/components/home/HomeHero";
import TrustSection from "@/app/components/home/TrustSection";

export const metadata = {
  title: "NHL Analytics — Predictions, player value, and team insights",
  description: "Model-driven NHL predictions, player WAR rankings, comparison tools, team insights, playoff odds, lottery simulations, and roster-building tools.",
};

export const revalidate = 300;

function getQuickLinks() {
  return [
    {
      href: "/compare",
      kicker: "Tool",
      title: "Compare Players",
      description: "Put skaters side by side across WAR, RAPM, ratings, and percentile context.",
      accent: "#7fd5ff",
    },
    {
      href: "/teams",
      kicker: "Team view",
      title: "Teams",
      description: "Open team dashboards, roster context, and season-level trends without leaving the app.",
      accent: "#56e0a8",
    },
    {
      href: "/playoff-odds",
      kicker: "Simulation",
      title: "Playoff Odds",
      description: "Track live Monte Carlo playoff outcomes, projected points, and round-by-round chances.",
      accent: "#ffc857",
    },
    {
      href: "/roster-builder",
      kicker: "Builder",
      title: "Roster Builder",
      description: "Assemble a cap-compliant lineup, share it by URL, and pressure-test roster ideas quickly.",
      accent: "#ff8ba7",
    },
  ];
}

function getFeatureItems() {
  return [
    {
      href: "/predictions",
      title: "Predictions",
      description: "Model-driven game forecasts, matchup detail pages, market context, and postgame recaps.",
      kicker: "Daily slate",
      icon: "WP",
      accent: "#2fb4ff",
      accentBg: "rgba(47,180,255,0.14)",
    },
    {
      href: "/players",
      title: "Players",
      description: "Search WAR leaders, percentile cards, ratings, and deep player profiles by season.",
      kicker: "Player value",
      icon: "WAR",
      accent: "#56e0a8",
      accentBg: "rgba(86,224,168,0.14)",
    },
    {
      href: "/teams",
      title: "Teams",
      description: "View roster construction, team analytics, and season context in one place.",
      kicker: "Team view",
      icon: "TM",
      accent: "#7fd5ff",
      accentBg: "rgba(127,213,255,0.14)",
    },
    {
      href: "/compare",
      title: "Compare",
      description: "Run side-by-side player evaluations across WAR, RAPM, ratings, and usage.",
      kicker: "Head to head",
      icon: "VS",
      accent: "#ffc857",
      accentBg: "rgba(255,200,87,0.14)",
    },
    {
      href: "/playoff-odds",
      title: "Playoff Odds",
      description: "Monte Carlo playoff chances, projected points, and round-by-round outlooks.",
      kicker: "Simulation",
      icon: "MC",
      accent: "#ff8ba7",
      accentBg: "rgba(255,139,167,0.14)",
    },
    {
      href: "/roster-builder",
      title: "Roster Builder",
      description: "Build shareable cap sheets and test line combinations with real contract data.",
      kicker: "Front office",
      icon: "GM",
      accent: "#8bb8ff",
      accentBg: "rgba(139,184,255,0.14)",
    },
    {
      href: "/lottery",
      title: "NHL Lottery",
      description: "Simulate lottery outcomes, traded picks, protections, and final first-round order.",
      kicker: "Draft tool",
      icon: "1OA",
      accent: "#e59cff",
      accentBg: "rgba(229,156,255,0.14)",
    },
  ];
}

function mapInsightCards(predictions = []) {
  return predictions
    .filter((entry) => entry?.prediction && entry?.game)
    .sort((a, b) => {
      const edgeA = Math.max(Math.abs(a.market?.homeEdge || 0), Math.abs(a.market?.awayEdge || 0), Math.abs((a.prediction?.homeWinPct || 0.5) - 0.5));
      const edgeB = Math.max(Math.abs(b.market?.homeEdge || 0), Math.abs(b.market?.awayEdge || 0), Math.abs((b.prediction?.homeWinPct || 0.5) - 0.5));
      return edgeB - edgeA;
    })
    .slice(0, 3)
    .map((entry) => {
      const homePct = entry.prediction?.homeWinPct ?? 0.5;
      const awayPct = entry.prediction?.awayWinPct ?? 0.5;
      const favorite = homePct >= awayPct ? entry.game.homeTeam.abbr : entry.game.awayTeam.abbr;
      const favoritePct = Math.max(homePct, awayPct);
      const confidence = confidenceMeta(entry.prediction?.modelDiagnostics?.confidenceBand || "medium");
      const marketEdge = favorite === entry.game.homeTeam.abbr ? entry.market?.homeEdge : entry.market?.awayEdge;

      return {
        href: predictionHref(entry.game.dateString, entry.game.id),
        kicker: entry.game.gameState === "LIVE" ? "Live edge" : "Today",
        awayTeam: entry.game.awayTeam.abbr,
        homeTeam: entry.game.homeTeam.abbr,
        favorite,
        favoriteWinPct: `${Math.round(favoritePct * 100)}%`,
        leanLabel: `${entry.game.awayTeam.abbr} ${Math.round(awayPct * 100)} · ${entry.game.homeTeam.abbr} ${Math.round(homePct * 100)}`,
        edgeLabel:
          typeof marketEdge === "number"
            ? `${marketEdge >= 0 ? "+" : ""}${(marketEdge * 100).toFixed(1)} pts`
            : entry.market
              ? "Market aligned"
              : "Model only",
        edgePositive: typeof marketEdge === "number" ? marketEdge > 0 : false,
        time: formatStartTime(entry.game.startTimeUTC),
        accent: confidence.color || TEAM_COLOR[favorite] || "#2fb4ff",
      };
    });
}

async function fetchFeaturedPlayers() {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("players")
    .select("player_id,full_name,team,position,war_total,overall_rating,gp")
    .order("war_total", { ascending: false, nullsFirst: false })
    .limit(5);

  return data || [];
}

export default async function HomePage() {
  const todayString = formatDateString(getTorontoDateParts());

  const [predictionResult, featuredPlayers] = await Promise.all([
    buildPredictionsForDate(todayString).catch(() => ({ predictions: [] })),
    fetchFeaturedPlayers().catch(() => []),
  ]);

  const insightCards = mapInsightCards(predictionResult?.predictions || []);

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top center, rgba(17,61,94,0.24) 0%, rgba(5,9,15,0) 32%), linear-gradient(180deg, #05090f 0%, #04070d 100%)",
        padding: "32px 22px 72px",
      }}
    >
      <div
        style={{
          width: "min(1360px, 100%)",
          margin: "0 auto",
          display: "grid",
          gap: 28,
        }}
      >
        <HomeHero quickLinks={getQuickLinks()} />
        <DailyInsights
          dateLabel={formatHeadlineDate(todayString)}
          cards={insightCards}
        />
        <FeatureGrid items={getFeatureItems()} />
        <FeaturedPlayersPreview players={featuredPlayers} />
        <TrustSection />
        <HomeCTA />
      </div>
    </main>
  );
}
