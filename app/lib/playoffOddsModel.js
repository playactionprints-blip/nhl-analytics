/**
 * Shared NHL playoff-odds simulation helpers.
 * Depends on NHL standings rows shaped like the public standings API and is
 * reused by both the playoff-odds page and game-detail implication scenarios.
 */

function getAbbr(team) {
  return typeof team.teamAbbrev === "string"
    ? team.teamAbbrev
    : (team.teamAbbrev?.default ?? "");
}

function gaussianSample(mean, stddev) {
  if (stddev <= 0) return mean;
  let u1;
  do {
    u1 = Math.random();
  } while (u1 === 0);
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * Math.random());
  return mean + z * stddev;
}

export function simulatePlayoffOdds(standings, numSims = 20000) {
  const teamStats = standings.map((team) => {
    const remaining = Math.max(0, 82 - (team.gamesPlayed || 0));
    return {
      abbr: getAbbr(team),
      points: team.points || 0,
      remaining,
      meanExtra: (team.pointPctg || 0) * 2 * remaining,
      stddev: Math.sqrt(remaining) * 0.85,
      conf: team.conferenceName || "",
      div: team.divisionName || "",
    };
  });

  const confDivGroups = {};
  for (const t of teamStats) {
    if (!confDivGroups[t.conf]) confDivGroups[t.conf] = {};
    if (!confDivGroups[t.conf][t.div]) confDivGroups[t.conf][t.div] = [];
    confDivGroups[t.conf][t.div].push(t);
  }

  const confAllTeams = {};
  for (const [conf, divMap] of Object.entries(confDivGroups)) {
    confAllTeams[conf] = Object.values(divMap).flat();
  }

  const counters = Object.fromEntries(
    teamStats.map((t) => [t.abbr, { playoff: 0, divFinal: 0, confFinal: 0, cup: 0, totalPts: 0 }])
  );

  function simMatchup(a, b, pts) {
    const diff = pts[a] - pts[b];
    return Math.random() < 1 / (1 + Math.exp(-diff * 0.035)) ? a : b;
  }

  for (let sim = 0; sim < numSims; sim++) {
    const pts = {};
    for (const t of teamStats) {
      const extra =
        t.remaining > 0
          ? Math.max(0, Math.min(t.remaining * 2, gaussianSample(t.meanExtra, t.stddev)))
          : 0;
      pts[t.abbr] = t.points + extra;
      counters[t.abbr].totalPts += pts[t.abbr];
    }

    const confWinners = {};
    for (const [conf, divMap] of Object.entries(confDivGroups)) {
      const byDiv = [];
      for (const divTeams of Object.values(divMap)) {
        const sorted = [...divTeams].sort((a, b) => pts[b.abbr] - pts[a.abbr]);
        for (let i = 0; i < Math.min(3, sorted.length); i++) byDiv.push(sorted[i].abbr);
      }

      const byDivSet = new Set(byDiv);
      const wc = confAllTeams[conf]
        .filter((t) => !byDivSet.has(t.abbr))
        .sort((a, b) => pts[b.abbr] - pts[a.abbr])
        .slice(0, 2)
        .map((t) => t.abbr);

      const p8 = [...byDiv, ...wc];
      for (const abbr of p8) counters[abbr].playoff++;

      p8.sort((a, b) => pts[b] - pts[a]);

      const r1 = [
        simMatchup(p8[0], p8[7], pts),
        simMatchup(p8[1], p8[6], pts),
        simMatchup(p8[2], p8[5], pts),
        simMatchup(p8[3], p8[4], pts),
      ];
      for (const winner of r1) counters[winner].divFinal++;

      const r2 = [simMatchup(r1[0], r1[3], pts), simMatchup(r1[1], r1[2], pts)];
      for (const winner of r2) counters[winner].confFinal++;

      confWinners[conf] = simMatchup(r2[0], r2[1], pts);
    }

    const conferences = Object.keys(confWinners);
    if (conferences.length === 2) {
      const cupWinner = simMatchup(confWinners[conferences[0]], confWinners[conferences[1]], pts);
      counters[cupWinner].cup++;
    }
  }

  const results = {};
  for (const t of teamStats) {
    const counter = counters[t.abbr];
    results[t.abbr] = {
      playoffOdds: counter.playoff / numSims,
      divFinalOdds: counter.divFinal / numSims,
      confFinalOdds: counter.confFinal / numSims,
      cupOdds: counter.cup / numSims,
      projectedPoints: Math.round(counter.totalPts / numSims),
    };
  }
  return results;
}

function cloneStandingsRow(row) {
  return {
    ...row,
    teamAbbrev: typeof row.teamAbbrev === "string" ? row.teamAbbrev : { ...row.teamAbbrev },
  };
}

function refreshPointPctg(row) {
  const gp = Number(row.gamesPlayed || 0);
  const pts = Number(row.points || 0);
  row.pointPctg = gp > 0 ? pts / (gp * 2) : 0;
}

export function applyGameOutcomeToStandings(standings, awayAbbr, homeAbbr, outcome) {
  const next = standings.map(cloneStandingsRow);
  const away = next.find((team) => getAbbr(team) === awayAbbr);
  const home = next.find((team) => getAbbr(team) === homeAbbr);
  if (!away || !home) return next;

  away.gamesPlayed = Number(away.gamesPlayed || 0) + 1;
  home.gamesPlayed = Number(home.gamesPlayed || 0) + 1;

  switch (outcome) {
    case "away_reg":
      away.points = Number(away.points || 0) + 2;
      away.wins = Number(away.wins || 0) + 1;
      home.losses = Number(home.losses || 0) + 1;
      break;
    case "away_ot":
      away.points = Number(away.points || 0) + 2;
      away.wins = Number(away.wins || 0) + 1;
      home.points = Number(home.points || 0) + 1;
      home.otLosses = Number(home.otLosses || 0) + 1;
      break;
    case "home_ot":
      home.points = Number(home.points || 0) + 2;
      home.wins = Number(home.wins || 0) + 1;
      away.points = Number(away.points || 0) + 1;
      away.otLosses = Number(away.otLosses || 0) + 1;
      break;
    case "home_reg":
    default:
      home.points = Number(home.points || 0) + 2;
      home.wins = Number(home.wins || 0) + 1;
      away.losses = Number(away.losses || 0) + 1;
      break;
  }

  refreshPointPctg(away);
  refreshPointPctg(home);
  return next;
}
