export const metadata = {
  title: "NHL Playoff Odds — NHL Analytics",
  description: "Live NHL standings with Monte Carlo playoff odds for all 32 teams.",
};

export const revalidate = 3600;

import PlayoffOddsClient from "./PlayoffOddsClient";
import { simulatePlayoffOdds } from "@/app/lib/playoffOddsModel";

// ── NHL API fetch ─────────────────────────────────────────────────────────────
async function fetchStandings() {
  try {
    const res = await fetch("https://api-web.nhle.com/v1/standings/now", {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.standings) && data.standings.length ? data.standings : null;
  } catch {
    return null;
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default async function PlayoffOddsPage() {
  const standings = await fetchStandings();

  if (!standings) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#05090f",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#5e7b98",
          fontFamily: "'DM Mono',monospace",
          fontSize: 13,
        }}
      >
        Unable to load standings — NHL API unavailable. Please try again later.
      </div>
    );
  }

  const simResults = simulatePlayoffOdds(standings);
  return <PlayoffOddsClient standings={standings} simResults={simResults} />;
}
