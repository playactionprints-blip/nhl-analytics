export const metadata = {
  title: "NHL Playoff Odds — NHL Analytics",
  description: "Live NHL standings with Monte Carlo playoff odds for all 32 teams.",
};

export const revalidate = 3600;

import PlayoffOddsClient from "./PlayoffOddsClient";

// ── Helpers (server-side only) ────────────────────────────────────────────────

function getAbbr(team) {
  return typeof team.teamAbbrev === "string"
    ? team.teamAbbrev
    : (team.teamAbbrev?.default ?? "");
}

function gaussianSample(mean, stddev) {
  if (stddev <= 0) return mean;
  let u1;
  do { u1 = Math.random(); } while (u1 === 0);
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * Math.random());
  return mean + z * stddev;
}

// ── Monte Carlo simulation ────────────────────────────────────────────────────
// Returns { [abbr]: { playoffOdds, divFinalOdds, confFinalOdds, cupOdds, projectedPoints } }
//
// Bracket: rank all 8 playoff teams per conference 1–8 by projected pts.
//   Round 1: 1v8, 2v7, 3v6, 4v5
//   Round 2 (Div Final): winner(1v8) vs winner(4v5), winner(2v7) vs winner(3v6)
//   Round 3 (Conf Final): 2 remaining per conference
//   Round 4 (Cup Final): East winner vs West winner
//
// Win probability: logistic on projected point differential * 0.035

function simulatePlayoffOdds(standings, numSims = 20000) {
  const teamStats = standings.map((team) => {
    const remaining = Math.max(0, 82 - (team.gamesPlayed || 0));
    return {
      abbr: getAbbr(team),
      points: team.points || 0,
      remaining,
      meanExtra: (team.pointPctg || 0) * 2 * remaining, // E[additional pts]
      stddev: Math.sqrt(remaining) * 0.85,
      conf: team.conferenceName || "",
      div: team.divisionName || "",
    };
  });

  // Pre-group by conference → division for fast inner-loop access
  const confDivGroups = {};
  for (const t of teamStats) {
    if (!confDivGroups[t.conf]) confDivGroups[t.conf] = {};
    if (!confDivGroups[t.conf][t.div]) confDivGroups[t.conf][t.div] = [];
    confDivGroups[t.conf][t.div].push(t);
  }
  // Pre-flatten each conference for wild card step
  const confAllTeams = {};
  for (const [conf, divMap] of Object.entries(confDivGroups)) {
    confAllTeams[conf] = Object.values(divMap).flat();
  }

  // Counters per team
  const C = Object.fromEntries(
    teamStats.map((t) => [t.abbr, { playoff: 0, divFinal: 0, confFinal: 0, cup: 0, totalPts: 0 }])
  );

  function simMatchup(a, b, pts) {
    const diff = pts[a] - pts[b];
    return Math.random() < 1 / (1 + Math.exp(-diff * 0.035)) ? a : b;
  }

  for (let sim = 0; sim < numSims; sim++) {
    // STEP 1 — Project final points
    const pts = {};
    for (const t of teamStats) {
      const extra =
        t.remaining > 0
          ? Math.max(0, Math.min(t.remaining * 2, gaussianSample(t.meanExtra, t.stddev)))
          : 0;
      pts[t.abbr] = t.points + extra;
      C[t.abbr].totalPts += pts[t.abbr];
    }

    // STEP 2 — Determine playoff qualifiers + STEP 3 — Simulate bracket
    const confWinners = {};

    for (const [conf, divMap] of Object.entries(confDivGroups)) {
      // Top 3 per division → 6 spots
      const byDiv = [];
      for (const divTeams of Object.values(divMap)) {
        const sorted = [...divTeams].sort((a, b) => pts[b.abbr] - pts[a.abbr]);
        for (let i = 0; i < Math.min(3, sorted.length); i++) byDiv.push(sorted[i].abbr);
      }

      // Wild cards: 2 best remaining by pts in conference
      const byDivSet = new Set(byDiv);
      const wc = confAllTeams[conf]
        .filter((t) => !byDivSet.has(t.abbr))
        .sort((a, b) => pts[b.abbr] - pts[a.abbr])
        .slice(0, 2)
        .map((t) => t.abbr);

      // 8 playoff teams for this conference
      const p8 = [...byDiv, ...wc];
      for (const a of p8) C[a].playoff++;

      // Seed 1–8 by projected points
      p8.sort((a, b) => pts[b] - pts[a]);

      // Round 1: 1v8, 2v7, 3v6, 4v5
      const r1 = [
        simMatchup(p8[0], p8[7], pts),
        simMatchup(p8[1], p8[6], pts),
        simMatchup(p8[2], p8[5], pts),
        simMatchup(p8[3], p8[4], pts),
      ];
      for (const w of r1) C[w].divFinal++; // won R1 → in Div Final

      // Round 2 (Div Finals): winner(1v8) vs winner(4v5), winner(2v7) vs winner(3v6)
      const r2 = [simMatchup(r1[0], r1[3], pts), simMatchup(r1[1], r1[2], pts)];
      for (const w of r2) C[w].confFinal++; // won R2 → in Conf Final

      // Round 3 (Conf Final)
      confWinners[conf] = simMatchup(r2[0], r2[1], pts);
    }

    // Round 4 (Cup Final)
    const cList = Object.keys(confWinners);
    if (cList.length === 2) {
      const cupWinner = simMatchup(confWinners[cList[0]], confWinners[cList[1]], pts);
      C[cupWinner].cup++;
    }
  }

  const results = {};
  for (const t of teamStats) {
    const c = C[t.abbr];
    results[t.abbr] = {
      playoffOdds: c.playoff / numSims,
      divFinalOdds: c.divFinal / numSims,
      confFinalOdds: c.confFinal / numSims,
      cupOdds: c.cup / numSims,
      projectedPoints: Math.round(c.totalPts / numSims),
    };
  }
  return results;
}

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
