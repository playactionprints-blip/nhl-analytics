import {
  PLAYOFF_BRANCHES,
  PLAYOFF_MAX_LEAGUE_IMPACT_TEAMS,
  PLAYOFF_SERIES_HOME_ICE_EDGE,
  PLAYOFF_SERIES_STRENGTH_SCALE,
} from "@/app/lib/playoffs/playoffConfig";
import { buildPointDistribution, clamp } from "@/app/lib/playoffs/playoffUtils";

function branchProbabilitiesForGame(game) {
  const awayReg = Math.max(0, Number(game?.regulationAwayWinProb ?? 0));
  const homeReg = Math.max(0, Number(game?.regulationHomeWinProb ?? 0));
  const awayOt = Math.max(0, Number(game?.overtimeAwayWinProb ?? 0));
  const homeOt = Math.max(0, Number(game?.overtimeHomeWinProb ?? 0));
  const total = awayReg + homeReg + awayOt + homeOt;

  if (total <= 0) {
    return {
      away_reg: 0.375,
      away_ot: 0.125,
      home_ot: 0.125,
      home_reg: 0.375,
    };
  }

  return {
    away_reg: awayReg / total,
    away_ot: awayOt / total,
    home_ot: homeOt / total,
    home_reg: homeReg / total,
  };
}

function sampleBranch(game, random = Math.random) {
  const probs = branchProbabilitiesForGame(game);
  const roll = random();
  let cumulative = 0;
  for (const branch of PLAYOFF_BRANCHES) {
    cumulative += probs[branch.key];
    if (roll <= cumulative) return branch.key;
  }
  return "home_reg";
}

function applyBranch(teamStates, game, branchKey) {
  const away = teamStates[game.awayTeam.abbr];
  const home = teamStates[game.homeTeam.abbr];
  if (!away || !home) return;

  away.gamesPlayed += 1;
  home.gamesPlayed += 1;

  switch (branchKey) {
    case "away_reg":
      away.points += 2;
      away.wins += 1;
      away.regulationWins += 1;
      home.losses += 1;
      break;
    case "away_ot":
      away.points += 2;
      away.wins += 1;
      home.points += 1;
      home.otLosses += 1;
      break;
    case "home_ot":
      home.points += 2;
      home.wins += 1;
      away.points += 1;
      away.otLosses += 1;
      break;
    case "home_reg":
    default:
      home.points += 2;
      home.wins += 1;
      home.regulationWins += 1;
      away.losses += 1;
      break;
  }
}

function cloneTeamStates(teams) {
  return Object.fromEntries(
    Object.values(teams).map((team) => [
      team.abbr,
      {
        abbr: team.abbr,
        name: team.name,
        conference: team.conference,
        division: team.division,
        points: team.points,
        wins: team.wins,
        losses: team.losses,
        otLosses: team.otLosses,
        gamesPlayed: team.gamesPlayed,
        pointPct: team.pointPct,
        goalDiff: team.goalDiff,
        regulationWins: team.regulationWins || 0,
      },
    ])
  );
}

function teamSortValue(teamA, teamB) {
  return (
    teamB.points - teamA.points ||
    teamB.wins - teamA.wins ||
    teamB.regulationWins - teamA.regulationWins ||
    teamB.goalDiff - teamA.goalDiff ||
    teamB.pointPct - teamA.pointPct ||
    teamA.abbr.localeCompare(teamB.abbr)
  );
}

function buildConferenceField(teamStates, conference) {
  const teams = Object.values(teamStates).filter((team) => team.conference === conference);
  const byDivision = teams.reduce((acc, team) => {
    if (!acc[team.division]) acc[team.division] = [];
    acc[team.division].push(team);
    return acc;
  }, {});

  const divisionWinners = [];
  const divisionSeeds = [];

  for (const divisionTeams of Object.values(byDivision)) {
    const sorted = [...divisionTeams].sort(teamSortValue);
    divisionWinners.push(sorted[0]);
    divisionSeeds.push(...sorted.slice(0, 3));
  }

  const divisionWinnerOrder = [...divisionWinners].sort(teamSortValue);
  const topDivisionWinner = divisionWinnerOrder[0];
  const secondDivisionWinner = divisionWinnerOrder[1];
  const seededSet = new Set(divisionSeeds.map((team) => team.abbr));
  const wildCards = [...teams]
    .filter((team) => !seededSet.has(team.abbr))
    .sort(teamSortValue)
    .slice(0, 2);

  const winnerOneWildcard = wildCards[1] || wildCards[0] || null;
  const winnerTwoWildcard = wildCards[0] || wildCards[1] || null;

  const topDivisionRunnerUp = [...(byDivision[topDivisionWinner?.division] || [])]
    .sort(teamSortValue)
    .slice(1, 3);
  const secondDivisionRunnerUp = [...(byDivision[secondDivisionWinner?.division] || [])]
    .sort(teamSortValue)
    .slice(1, 3);

  const matchups = [
    topDivisionWinner && winnerOneWildcard
      ? { topSeed: topDivisionWinner.abbr, opponent: winnerOneWildcard.abbr }
      : null,
    topDivisionRunnerUp.length === 2
      ? { topSeed: topDivisionRunnerUp[0].abbr, opponent: topDivisionRunnerUp[1].abbr }
      : null,
    secondDivisionWinner && winnerTwoWildcard
      ? { topSeed: secondDivisionWinner.abbr, opponent: winnerTwoWildcard.abbr }
      : null,
    secondDivisionRunnerUp.length === 2
      ? { topSeed: secondDivisionRunnerUp[0].abbr, opponent: secondDivisionRunnerUp[1].abbr }
      : null,
  ].filter(Boolean);

  const playoffTeams = [
    ...divisionSeeds.map((team) => team.abbr),
    ...wildCards.map((team) => team.abbr),
  ];

  const conferenceOrder = [...teams].sort(teamSortValue);

  return {
    conference,
    playoffTeams,
    conferenceOrder,
    divisionOrder: byDivision,
    matchups,
  };
}

function gameWinProbability(homeTeam, awayTeam) {
  const diff = (homeTeam.strengthIndex || 0) - (awayTeam.strengthIndex || 0);
  return clamp(1 / (1 + Math.exp(-(diff * PLAYOFF_SERIES_STRENGTH_SCALE + PLAYOFF_SERIES_HOME_ICE_EDGE))), 0.18, 0.82);
}

function simulateSeries(homeTeam, awayTeam, random = Math.random) {
  const homeAtHome = gameWinProbability(homeTeam, awayTeam);
  const homeOnRoad = clamp(homeAtHome - PLAYOFF_SERIES_HOME_ICE_EDGE * 2, 0.15, 0.78);
  const schedule = [true, true, false, false, true, false, true];
  let homeWins = 0;
  let awayWins = 0;

  for (const isHomeGame of schedule) {
    const homeWinProb = isHomeGame ? homeAtHome : homeOnRoad;
    if (random() < homeWinProb) {
      homeWins += 1;
    } else {
      awayWins += 1;
    }
    if (homeWins === 4) return homeTeam.abbr;
    if (awayWins === 4) return awayTeam.abbr;
  }

  return homeWins >= awayWins ? homeTeam.abbr : awayTeam.abbr;
}

function simulateConferenceBracket(field, teamMeta, counters, random = Math.random) {
  if (field.matchups.length !== 4) return null;
  const roundOne = field.matchups.map((matchup) => {
    const winner = simulateSeries(teamMeta[matchup.topSeed], teamMeta[matchup.opponent], random);
    counters[winner].playoffSeriesWins += 1;
    return winner;
  });

  const semis = [
    simulateSeries(teamMeta[roundOne[0]], teamMeta[roundOne[1]], random),
    simulateSeries(teamMeta[roundOne[2]], teamMeta[roundOne[3]], random),
  ];
  semis.forEach((winner) => { counters[winner].secondRound += 1; });

  const confWinner = simulateSeries(teamMeta[semis[0]], teamMeta[semis[1]], random);
  counters[confWinner].conferenceFinal += 1;
  return confWinner;
}

function buildTeamSummary(team, counter, numSims) {
  const projectedPoints = counter.totalPoints / numSims;
  const pointDistribution = buildPointDistribution(counter.pointFrequencies);
  const likelyOpponents = Object.entries(counter.firstRoundOpponents)
    .map(([abbr, count]) => ({ abbr, probability: count / Math.max(counter.playoff, 1) }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 4);

  const divisionFinish = Object.entries(counter.divisionFinish)
    .map(([rank, count]) => ({ rank: Number(rank), probability: count / numSims }))
    .sort((a, b) => a.rank - b.rank);
  const conferenceFinish = Object.entries(counter.conferenceFinish)
    .map(([rank, count]) => ({ rank: Number(rank), probability: count / numSims }))
    .sort((a, b) => a.rank - b.rank);

  return {
    team: team.abbr,
    teamName: team.name,
    conference: team.conference,
    division: team.division,
    projectedPoints,
    projectedPointsRounded: Math.round(projectedPoints * 10) / 10,
    playoffProbability: counter.playoff / numSims,
    cupProbability: counter.cup / numSims,
    projectedDivisionRank: divisionFinish.sort((a, b) => b.probability - a.probability)[0]?.rank ?? null,
    projectedConferenceRank: conferenceFinish.sort((a, b) => b.probability - a.probability)[0]?.rank ?? null,
    likelyFirstRoundOpponents: likelyOpponents,
    pointDistribution,
    divisionFinish,
    conferenceFinish,
    averagePlayoffSeed: counter.playoffSeedTotal / Math.max(counter.playoff, 1),
    playoffDelta: 0,
  };
}

export function simulatePlayoffRace({
  teams,
  games,
  numSims,
  forcedOutcome = null,
  includeCup = true,
}) {
  const teamMeta = teams;
  const counters = Object.fromEntries(
    Object.values(teamMeta).map((team) => [
      team.abbr,
      {
        playoff: 0,
        cup: 0,
        secondRound: 0,
        conferenceFinal: 0,
        playoffSeriesWins: 0,
        totalPoints: 0,
        pointFrequencies: {},
        firstRoundOpponents: {},
        divisionFinish: {},
        conferenceFinish: {},
        playoffSeedTotal: 0,
      },
    ])
  );

  for (let sim = 0; sim < numSims; sim += 1) {
    const teamStates = cloneTeamStates(teamMeta);

    for (const game of games) {
      const branch = forcedOutcome && forcedOutcome.gameId === game.id
        ? forcedOutcome.branch
        : sampleBranch(game);
      applyBranch(teamStates, game, branch);
    }

    const conferences = ["Eastern", "Western"];
    const conferenceFields = conferences.map((conference) => buildConferenceField(teamStates, conference));

    for (const field of conferenceFields) {
      const conferenceOrder = field.conferenceOrder;
      conferenceOrder.forEach((team, index) => {
        counters[team.abbr].conferenceFinish[index + 1] = (counters[team.abbr].conferenceFinish[index + 1] || 0) + 1;
      });

      for (const [division, divisionTeams] of Object.entries(field.divisionOrder)) {
        [...divisionTeams].sort(teamSortValue).forEach((team, index) => {
          counters[team.abbr].divisionFinish[index + 1] = (counters[team.abbr].divisionFinish[index + 1] || 0) + 1;
        });
      }

      for (const abbr of field.playoffTeams) {
        counters[abbr].playoff += 1;
      }

      field.matchups.forEach((matchup, index) => {
        const seedSlot = index + 1;
        counters[matchup.topSeed].playoffSeedTotal += seedSlot;
        counters[matchup.opponent].playoffSeedTotal += seedSlot;
        counters[matchup.topSeed].firstRoundOpponents[matchup.opponent] = (counters[matchup.topSeed].firstRoundOpponents[matchup.opponent] || 0) + 1;
        counters[matchup.opponent].firstRoundOpponents[matchup.topSeed] = (counters[matchup.opponent].firstRoundOpponents[matchup.topSeed] || 0) + 1;
      });
    }

    if (includeCup) {
      const winners = conferenceFields
        .map((field) => simulateConferenceBracket(field, teamMeta, counters))
        .filter(Boolean);
      if (winners.length === 2) {
        const cupWinner = simulateSeries(teamMeta[winners[0]], teamMeta[winners[1]]);
        counters[cupWinner].cup += 1;
      }
    }

    for (const team of Object.values(teamStates)) {
      counters[team.abbr].totalPoints += team.points;
      counters[team.abbr].pointFrequencies[team.points] = (counters[team.abbr].pointFrequencies[team.points] || 0) + 1;
    }
  }

  const teamsOut = Object.values(teamMeta)
    .map((team) => buildTeamSummary(team, counters[team.abbr], numSims))
    .sort((a, b) => b.playoffProbability - a.playoffProbability || b.projectedPoints - a.projectedPoints || a.team.localeCompare(b.team));

  return {
    numSims,
    teams: teamsOut,
    teamMap: Object.fromEntries(teamsOut.map((team) => [team.team, team])),
  };
}

export function calculateDailyMovers(currentResults, previousResults) {
  const currentMap = currentResults?.teamMap || {};
  const previousMap = previousResults?.teamMap || {};
  const teams = Object.values(currentMap)
    .map((team) => {
      const previous = previousMap[team.team];
      const delta = previous ? team.playoffProbability - previous.playoffProbability : 0;
      const cupDelta = previous ? team.cupProbability - previous.cupProbability : 0;
      return {
        ...team,
        previousPlayoffProbability: previous?.playoffProbability ?? null,
        previousCupProbability: previous?.cupProbability ?? null,
        playoffDelta: delta,
        cupDelta,
      };
    })
    .sort((a, b) => b.playoffProbability - a.playoffProbability || b.projectedPoints - a.projectedPoints);

  return {
    biggestRiser: [...teams].sort((a, b) => b.playoffDelta - a.playoffDelta)[0] || null,
    biggestFaller: [...teams].sort((a, b) => a.playoffDelta - b.playoffDelta)[0] || null,
    teams,
  };
}

function summarizeTeamBranch(teamSummary, baselineSummary) {
  return {
    playoffProbability: teamSummary?.playoffProbability ?? 0,
    projectedPoints: teamSummary?.projectedPointsRounded ?? null,
    playoffDelta: baselineSummary && teamSummary
      ? teamSummary.playoffProbability - baselineSummary.playoffProbability
      : 0,
    projectedPointsDelta: baselineSummary && teamSummary && baselineSummary.projectedPointsRounded != null
      ? Number((teamSummary.projectedPointsRounded - baselineSummary.projectedPointsRounded).toFixed(1))
      : 0,
  };
}

function combineBranchSummaries(summaries, weights) {
  const valid = summaries
    .map((summary, index) => ({
      summary,
      weight: Number(weights?.[index] ?? 0),
    }))
    .filter((entry) => entry.summary);

  if (!valid.length) {
    return {
      playoffProbability: 0,
      projectedPoints: null,
      playoffDelta: 0,
      projectedPointsDelta: 0,
    };
  }

  const totalWeight = valid.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  const normalized = totalWeight > 0
    ? valid.map((entry) => ({ ...entry, weight: Math.max(0, entry.weight) / totalWeight }))
    : valid.map((entry) => ({ ...entry, weight: 1 / valid.length }));

  const weightedValue = (key, fallback = 0) => {
    const numericEntries = normalized.filter(({ summary }) => Number.isFinite(summary?.[key]));
    if (!numericEntries.length) return fallback;
    const numericWeight = numericEntries.reduce((sum, entry) => sum + entry.weight, 0);
    return numericEntries.reduce((sum, entry) => {
      const share = numericWeight > 0 ? entry.weight / numericWeight : 1 / numericEntries.length;
      return sum + summaryValue(entry.summary[key]) * share;
    }, 0);
  };

  const projectedPointsEntries = normalized.filter(({ summary }) => Number.isFinite(summary?.projectedPoints));
  const projectedPoints = projectedPointsEntries.length
    ? projectedPointsEntries.reduce((sum, entry) => sum + entry.summary.projectedPoints * entry.weight, 0)
    : null;

  return {
    playoffProbability: weightedValue("playoffProbability", 0),
    projectedPoints,
    playoffDelta: weightedValue("playoffDelta", 0),
    projectedPointsDelta: weightedValue("projectedPointsDelta", 0),
  };
}

function summaryValue(value) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function buildOutcomeWeights(game) {
  const awayReg = Number(game?.regulationAwayWinProb ?? 0);
  const awayOt = Number(game?.overtimeAwayWinProb ?? 0);
  const homeReg = Number(game?.regulationHomeWinProb ?? 0);
  const homeOt = Number(game?.overtimeHomeWinProb ?? 0);

  const awayTotal = awayReg + awayOt;
  const homeTotal = homeReg + homeOt;

  return {
    awayWin: awayTotal > 0 ? [awayReg / awayTotal, awayOt / awayTotal] : [0.5, 0.5],
    homeWin: homeTotal > 0 ? [homeReg / homeTotal, homeOt / homeTotal] : [0.5, 0.5],
  };
}

export function calculateGameImpacts({
  baselineResults,
  conditionalResultsByGame,
  selectedDate,
}) {
  const baselineMap = baselineResults?.teamMap || {};
  const games = conditionalResultsByGame.map((entry) => {
    const teamBranches = {};

    for (const branch of PLAYOFF_BRANCHES) {
      const result = entry.branches[branch.key];
      const map = result?.teamMap || {};
      teamBranches[branch.key] = {
        away: summarizeTeamBranch(map[entry.game.awayTeam.abbr], baselineMap[entry.game.awayTeam.abbr]),
        home: summarizeTeamBranch(map[entry.game.homeTeam.abbr], baselineMap[entry.game.homeTeam.abbr]),
      };
    }

    const outcomeWeights = buildOutcomeWeights(entry.game);
    const awayWinSummary = combineBranchSummaries(
      [teamBranches.away_reg.away, teamBranches.away_ot.away],
      outcomeWeights.awayWin
    );
    const homeWinSummary = combineBranchSummaries(
      [teamBranches.home_reg.home, teamBranches.home_ot.home],
      outcomeWeights.homeWin
    );

    const leagueImpacts = Object.values(baselineMap)
      .filter((team) => ![entry.game.awayTeam.abbr, entry.game.homeTeam.abbr].includes(team.team))
      .map((team) => {
        const awayWin = combineBranchSummaries(
          [
            summarizeTeamBranch(entry.branches.away_reg?.teamMap?.[team.team], baselineMap[team.team]),
            summarizeTeamBranch(entry.branches.away_ot?.teamMap?.[team.team], baselineMap[team.team]),
          ],
          outcomeWeights.awayWin
        );
        const homeWin = combineBranchSummaries(
          [
            summarizeTeamBranch(entry.branches.home_reg?.teamMap?.[team.team], baselineMap[team.team]),
            summarizeTeamBranch(entry.branches.home_ot?.teamMap?.[team.team], baselineMap[team.team]),
          ],
          outcomeWeights.homeWin
        );
        const maxSwing = awayWin && homeWin
          ? awayWin.playoffProbability - homeWin.playoffProbability
          : 0;
        return {
          team: team.team,
          teamName: team.teamName,
          awayWinPlayoffProbability: awayWin.playoffProbability ?? team.playoffProbability,
          homeWinPlayoffProbability: homeWin.playoffProbability ?? team.playoffProbability,
          maxSwing,
        };
      })
      .sort((a, b) => Math.abs(b.maxSwing) - Math.abs(a.maxSwing))
      .slice(0, PLAYOFF_MAX_LEAGUE_IMPACT_TEAMS);

    return {
      date: selectedDate,
      gameId: entry.game.id,
      game: entry.game,
      currentWinProbabilities: {
        home: entry.game.homeWinProbability,
        away: entry.game.awayWinProbability,
        overtime: entry.game.regulationTieProbability,
      },
      branches: teamBranches,
      outcomes: {
        away: {
          win: awayWinSummary,
          loseOt: teamBranches.home_ot.away,
          loseReg: teamBranches.home_reg.away,
        },
        home: {
          win: homeWinSummary,
          loseOt: teamBranches.away_ot.home,
          loseReg: teamBranches.away_reg.home,
        },
      },
      leagueImpacts,
    };
  });

  return {
    date: selectedDate,
    games,
  };
}
