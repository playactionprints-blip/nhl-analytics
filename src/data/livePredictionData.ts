import { DEFAULT_MODEL_CONFIG } from "./leagueConstants";
import type { GameContext, TeamSeasonStats } from "../types/types";

export interface StandingsTeamSnapshot {
  abbr: string;
  name: string;
  gamesPlayed: number;
  points: number;
  pointPct: number;
  wins: number;
  losses: number;
  otLosses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  homeRecord: {
    wins: number;
    losses: number;
    overtimeLosses: number;
    pointPct?: number;
  };
  awayRecord: {
    wins: number;
    losses: number;
    overtimeLosses: number;
    pointPct?: number;
  };
  last10: {
    wins: number;
    losses: number;
    overtimeLosses: number;
    pointPct: number;
    goalsForPerGame?: number;
    goalsAgainstPerGame?: number;
  };
}

export interface TeamSpecialTeamsSnapshot {
  ppPct?: number | null;
  pkPct?: number | null;
}

export interface TeamPlayerAggregate {
  teamId: string;
  teamName: string;
  avgOffRating: number;
  avgDefRating: number;
  avgOverallRating: number;
  avgXgfPct: number;
  avgCfPct: number;
  avgHomeCfPct?: number | null;
  avgAwayCfPct?: number | null;
  avgWarShooting: number;
  totalWAR: number;
  topGoalieSavePct: number;
  topGoalieGsaxPerGame: number;
  topGoalieGsaxPct: number;
}

export interface TeamSplitAggregate {
  teamId: string;
  avgCfPct: number | null;
  avgHomeCfPct: number | null;
  avgAwayCfPct: number | null;
}

export interface ScheduledGameSnapshot {
  id: string;
  gameState: string;
  startTimeUTC: string;
  homeTeam: { abbr: string; name: string };
  awayTeam: { abbr: string; name: string };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function recordPointPct(wins: number, losses: number, overtimeLosses: number): number {
  const gp = wins + losses + overtimeLosses;
  if (gp === 0) return 0.5;
  return (wins * 2 + overtimeLosses) / (gp * 2);
}

export function normalizeStandingsSnapshot(raw: any, teamNameLookup: Record<string, string>): StandingsTeamSnapshot | null {
  const abbr = typeof raw?.teamAbbrev === "object" ? raw.teamAbbrev.default : raw?.teamAbbrev;
  if (!abbr) return null;

  const homeWins = readNumber(raw.homeWins ?? raw.homeSequence?.wins);
  const homeLosses = readNumber(raw.homeLosses ?? raw.homeSequence?.losses);
  const homeOtLosses = readNumber(raw.homeOtLosses ?? raw.homeSequence?.otLosses);
  const awayWins = readNumber(raw.roadWins ?? raw.awayWins ?? raw.roadSequence?.wins);
  const awayLosses = readNumber(raw.roadLosses ?? raw.awayLosses ?? raw.roadSequence?.losses);
  const awayOtLosses = readNumber(raw.roadOtLosses ?? raw.awayOtLosses ?? raw.roadSequence?.otLosses);
  const l10Wins = readNumber(raw.l10Wins ?? raw.last10Wins ?? raw.l10Sequence?.wins);
  const l10Losses = readNumber(raw.l10Losses ?? raw.last10Losses ?? raw.l10Sequence?.losses);
  const l10OtLosses = readNumber(raw.l10OtLosses ?? raw.last10OtLosses ?? raw.l10Sequence?.otLosses);
  const goalsFor = readNumber(raw.goalFor ?? raw.goalsFor ?? raw.goalForTotal ?? raw.goalScored);
  const goalsAgainst = readNumber(raw.goalAgainst ?? raw.goalsAgainst ?? raw.goalAgainstTotal);

  return {
    abbr,
    name:
      teamNameLookup[abbr] ||
      (typeof raw?.teamName === "object" ? raw.teamName.default : raw?.teamName) ||
      abbr,
    gamesPlayed: readNumber(raw.gamesPlayed),
    points: readNumber(raw.points),
    pointPct: readNumber(raw.pointPctg ?? raw.pointPct, 0.5),
    wins: readNumber(raw.wins),
    losses: readNumber(raw.losses),
    otLosses: readNumber(raw.otLosses),
    goalsFor,
    goalsAgainst,
    goalDiff: readNumber(raw.goalDifferential, goalsFor - goalsAgainst),
    homeRecord: {
      wins: homeWins,
      losses: homeLosses,
      overtimeLosses: homeOtLosses,
      pointPct: recordPointPct(homeWins, homeLosses, homeOtLosses),
    },
    awayRecord: {
      wins: awayWins,
      losses: awayLosses,
      overtimeLosses: awayOtLosses,
      pointPct: recordPointPct(awayWins, awayLosses, awayOtLosses),
    },
    last10: {
      wins: l10Wins,
      losses: l10Losses,
      overtimeLosses: l10OtLosses,
      pointPct: recordPointPct(l10Wins, l10Losses, l10OtLosses),
      goalsForPerGame: l10Wins + l10Losses + l10OtLosses > 0 ? undefined : undefined,
      goalsAgainstPerGame: l10Wins + l10Losses + l10OtLosses > 0 ? undefined : undefined,
    },
  };
}

export function buildPlayerAggregates(
  players: Array<{
    team?: string | null;
    position?: string | null;
    off_rating?: number | null;
    def_rating?: number | null;
    overall_rating?: number | null;
    xgf_pct?: number | null;
    cf_pct?: number | null;
    war_shooting?: number | null;
    war_total?: number | null;
    gp?: number | null;
    save_pct?: number | null;
    gsax?: number | null;
    gsax_pct?: number | null;
    full_name?: string | null;
  }>,
  teamNameLookup: Record<string, string>
): Record<string, TeamPlayerAggregate> {
  const byTeam = new Map<string, any[]>();

  for (const player of players || []) {
    const team = player.team;
    if (!team) continue;
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team)!.push(player);
  }

  const result: Record<string, TeamPlayerAggregate> = {};
  for (const [teamId, teamPlayers] of byTeam.entries()) {
    const skaters = teamPlayers
      .filter((player) => player.position !== "G")
      .sort((a, b) => (b.overall_rating || 0) - (a.overall_rating || 0))
      .slice(0, 12);
    const goalies = teamPlayers
      .filter((player) => player.position === "G")
      .sort((a, b) => (b.gp || 0) - (a.gp || 0));

    const avg = (values: number[], fallback: number) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;

    const starter = goalies[0];
    const totalWAR = teamPlayers
      .filter((player) => player.position !== "G")
      .reduce((sum, player) => sum + (player.war_total || 0), 0);

    result[teamId] = {
      teamId,
      teamName: teamNameLookup[teamId] || teamId,
      avgOffRating: avg(skaters.map((player) => player.off_rating || 75), 75),
      avgDefRating: avg(skaters.map((player) => player.def_rating || 75), 75),
      avgOverallRating: avg(skaters.map((player) => player.overall_rating || 75), 75),
      avgXgfPct: avg(skaters.map((player) => player.xgf_pct || 50), 50),
      avgCfPct: avg(skaters.map((player) => player.cf_pct || 50), 50),
      avgWarShooting: avg(skaters.map((player) => player.war_shooting || 0), 0),
      totalWAR,
      topGoalieSavePct: typeof starter?.save_pct === "number" ? starter.save_pct : DEFAULT_MODEL_CONFIG.leagueAverages.savePct,
      topGoalieGsaxPerGame:
        typeof starter?.gsax === "number" && typeof starter?.gp === "number" && starter.gp > 0
          ? starter.gsax / starter.gp
          : 0,
      topGoalieGsaxPct: typeof starter?.gsax_pct === "number" ? starter.gsax_pct : 50,
    };
  }

  return result;
}

export function buildTeamSplitAggregates(
  seasonRows: Array<{
    team?: string | null;
    gp?: number | null;
    cf_pct?: number | null;
    home_cf_pct?: number | null;
    away_cf_pct?: number | null;
  }>
): Record<string, TeamSplitAggregate> {
  const totals = new Map<
    string,
    {
      cfSum: number;
      cfWeight: number;
      homeCfSum: number;
      homeCfWeight: number;
      awayCfSum: number;
      awayCfWeight: number;
    }
  >();

  for (const row of seasonRows || []) {
    const teamId = row.team;
    if (!teamId) continue;
    if (!totals.has(teamId)) {
      totals.set(teamId, {
        cfSum: 0,
        cfWeight: 0,
        homeCfSum: 0,
        homeCfWeight: 0,
        awayCfSum: 0,
        awayCfWeight: 0,
      });
    }

    const bucket = totals.get(teamId)!;
    const weight = Math.max(1, readNumber(row.gp, 0));

    if (typeof row.cf_pct === "number") {
      bucket.cfSum += row.cf_pct * weight;
      bucket.cfWeight += weight;
    }
    if (typeof row.home_cf_pct === "number") {
      bucket.homeCfSum += row.home_cf_pct * weight;
      bucket.homeCfWeight += weight;
    }
    if (typeof row.away_cf_pct === "number") {
      bucket.awayCfSum += row.away_cf_pct * weight;
      bucket.awayCfWeight += weight;
    }
  }

  const result: Record<string, TeamSplitAggregate> = {};
  for (const [teamId, bucket] of totals.entries()) {
    result[teamId] = {
      teamId,
      avgCfPct: bucket.cfWeight > 0 ? bucket.cfSum / bucket.cfWeight : null,
      avgHomeCfPct: bucket.homeCfWeight > 0 ? bucket.homeCfSum / bucket.homeCfWeight : null,
      avgAwayCfPct: bucket.awayCfWeight > 0 ? bucket.awayCfSum / bucket.awayCfWeight : null,
    };
  }

  return result;
}

export function normalizeScheduleGame(raw: any, teamNameLookup: Record<string, string>): ScheduledGameSnapshot | null {
  const awayAbbr = raw?.awayTeam?.abbrev || raw?.awayTeam?.abbrev?.default || raw?.awayTeam?.placeName?.default;
  const homeAbbr = raw?.homeTeam?.abbrev || raw?.homeTeam?.abbrev?.default || raw?.homeTeam?.placeName?.default;
  if (!awayAbbr || !homeAbbr) return null;

  return {
    id: String(raw.id ?? raw.gameId ?? `${awayAbbr}-${homeAbbr}-${raw.startTimeUTC || ""}`),
    gameState: raw.gameState || raw.gameScheduleState || "FUT",
    startTimeUTC: raw.startTimeUTC || raw.startTime || raw.gameDate || "",
    awayTeam: {
      abbr: awayAbbr,
      name: teamNameLookup[awayAbbr] || awayAbbr,
    },
    homeTeam: {
      abbr: homeAbbr,
      name: teamNameLookup[homeAbbr] || homeAbbr,
    },
  };
}

export function buildTeamSeasonStatsFromLiveData(
  teamId: string,
  standingsByTeam: Record<string, StandingsTeamSnapshot>,
  specialTeamsByTeam: Record<string, TeamSpecialTeamsSnapshot>,
  aggregatesByTeam: Record<string, TeamPlayerAggregate>,
  splitAggregatesByTeam: Record<string, TeamSplitAggregate> = {}
): TeamSeasonStats | null {
  const standings = standingsByTeam[teamId];
  if (!standings) return null;

  const aggregate = aggregatesByTeam[teamId] || {
    teamId,
    teamName: standings.name,
    avgOffRating: 75,
    avgDefRating: 75,
    avgOverallRating: 75,
    avgXgfPct: 50,
    avgCfPct: 50,
    avgWarShooting: 0,
    topGoalieSavePct: DEFAULT_MODEL_CONFIG.leagueAverages.savePct,
    topGoalieGsaxPerGame: 0,
  };
  const splitAggregate = splitAggregatesByTeam[teamId];
  const specialTeams = specialTeamsByTeam[teamId] || {};

  const offenseFactor = clamp((aggregate.avgOffRating - 75) / 22, -0.25, 0.35);
  const defenseFactor = clamp((aggregate.avgDefRating - 75) / 22, -0.25, 0.35);
  const xgfPctFactor = clamp((aggregate.avgXgfPct - 50) / 50, -0.12, 0.12);
  const finishingFactor = clamp(aggregate.avgWarShooting / 4, -0.08, 0.08);

  const shootingPct = clamp(
    DEFAULT_MODEL_CONFIG.leagueAverages.shootingPct * (1 + finishingFactor + offenseFactor * 0.3),
    0.082,
    0.122
  );
  const savePct = clamp(aggregate.topGoalieSavePct, 0.885, 0.925);

  const goalsForPerGame = standings.gamesPlayed > 0
    ? standings.goalsFor / standings.gamesPlayed
    : DEFAULT_MODEL_CONFIG.leagueAverages.goalsPerTeamGame;
  const goalsAgainstPerGame = standings.gamesPlayed > 0
    ? standings.goalsAgainst / standings.gamesPlayed
    : DEFAULT_MODEL_CONFIG.leagueAverages.goalsPerTeamGame;

  const shotsForPerGame = clamp(
    goalsForPerGame / Math.max(0.075, shootingPct),
    22,
    38
  );
  const shotsAgainstPerGame = clamp(
    goalsAgainstPerGame / Math.max(0.06, 1 - savePct),
    22,
    38
  );

  return {
    teamId,
    teamName: standings.name,
    gamesPlayed: standings.gamesPlayed,
    goalsForPerGame,
    goalsAgainstPerGame,
    shotsForPerGame,
    shotsAgainstPerGame,
    xgfPer60: clamp(
      DEFAULT_MODEL_CONFIG.leagueAverages.xgfPer60 *
        (1 + offenseFactor * 0.45 + xgfPctFactor * 0.8 + finishingFactor * 0.1),
      2.0,
      3.6
    ),
    xgaPer60: clamp(
      DEFAULT_MODEL_CONFIG.leagueAverages.xgaPer60 *
        (1 - defenseFactor * 0.35 - xgfPctFactor * 0.5 + (goalsAgainstPerGame - DEFAULT_MODEL_CONFIG.leagueAverages.goalsPerTeamGame) * 0.08),
      2.0,
      3.6
    ),
    fiveOnFiveXgfPct: clamp(aggregate.avgXgfPct, 44, 58),
    homeCfPct: splitAggregate?.avgHomeCfPct ?? splitAggregate?.avgCfPct ?? aggregate.avgCfPct,
    awayCfPct: splitAggregate?.avgAwayCfPct ?? splitAggregate?.avgCfPct ?? aggregate.avgCfPct,
    shootingPct,
    savePct,
    powerPlayPct: specialTeams.ppPct ?? DEFAULT_MODEL_CONFIG.leagueAverages.powerPlayPct,
    penaltyKillPct: specialTeams.pkPct ?? DEFAULT_MODEL_CONFIG.leagueAverages.penaltyKillPct,
    recent10: {
      pointsPct: standings.last10.pointPct,
      goalsForPerGame: standings.last10.goalsForPerGame,
      goalsAgainstPerGame: standings.last10.goalsAgainstPerGame,
    },
    homeRecord: standings.homeRecord,
    awayRecord: standings.awayRecord,
  };
}

function computeBlendedLineupAdj(
  team: TeamSeasonStats,
  aggregate: TeamPlayerAggregate | undefined,
  leagueAvgWAR: number
): number {
  // Compute overall point pct from combined home+away record
  const totalGames =
    team.homeRecord.wins + team.homeRecord.losses + team.homeRecord.overtimeLosses +
    team.awayRecord.wins + team.awayRecord.losses + team.awayRecord.overtimeLosses;
  const totalWins = team.homeRecord.wins + team.awayRecord.wins;
  const totalOtl = team.homeRecord.overtimeLosses + team.awayRecord.overtimeLosses;
  const overallPtPct = totalGames > 0 ? (totalWins * 2 + totalOtl) / (totalGames * 2) : 0.5;

  // Three-component team strength blend:
  // 50% standings (current results), 30% WAR (underlying quality), 20% ratings (3yr model)
  const standingsStrength = overallPtPct / 0.5;                                    // 1.0 = avg
  const warStrength = (aggregate?.totalWAR || leagueAvgWAR) / leagueAvgWAR;       // 1.0 = avg
  const ratingsStrength = (aggregate?.avgOverallRating || 75) / 75;                // 1.0 = avg

  const blended = standingsStrength * 0.50 + warStrength * 0.30 + ratingsStrength * 0.20;
  return clamp((blended - 1) * 0.12, -0.07, 0.08);
}

export function buildGameContextFromTeams(
  homeTeam: TeamSeasonStats,
  awayTeam: TeamSeasonStats,
  aggregatesByTeam: Record<string, TeamPlayerAggregate>
): GameContext {
  const homeAggregate = aggregatesByTeam[homeTeam.teamId];
  const awayAggregate = aggregatesByTeam[awayTeam.teamId];

  // Compute league-average WAR from all teams with data
  const allWARValues = Object.values(aggregatesByTeam)
    .map((a) => a.totalWAR || 0)
    .filter((w) => w > 0);
  const leagueAvgWAR = allWARValues.length > 0
    ? allWARValues.reduce((a, b) => a + b, 0) / allWARValues.length
    : 24;

  return {
    homeTeam,
    awayTeam,
    homeRestDays: 1,
    awayRestDays: 1,
    homeBackToBack: false,
    awayBackToBack: false,
    homeTravelDisadvantage: false,
    awayTravelDisadvantage: false,
    homeStartingGoalie: homeAggregate
      ? {
          goalieName: `${homeTeam.teamName} starter`,
          savePct: homeAggregate.topGoalieSavePct,
          gsaxPct: homeAggregate.topGoalieGsaxPct,
          gsaxPer60: homeAggregate.topGoalieGsaxPerGame / 60,
          qualityAdjustment: clamp(homeAggregate.topGoalieGsaxPerGame / 30, -0.04, 0.06),
          confidence: "projected",
        }
      : undefined,
    awayStartingGoalie: awayAggregate
      ? {
          goalieName: `${awayTeam.teamName} starter`,
          savePct: awayAggregate.topGoalieSavePct,
          gsaxPct: awayAggregate.topGoalieGsaxPct,
          gsaxPer60: awayAggregate.topGoalieGsaxPerGame / 60,
          qualityAdjustment: clamp(awayAggregate.topGoalieGsaxPerGame / 30, -0.04, 0.06),
          confidence: "projected",
        }
      : undefined,
    homeInjuryAdjustment: 0,
    awayInjuryAdjustment: 0,
    homeLineupStrengthAdjustment: computeBlendedLineupAdj(homeTeam, homeAggregate, leagueAvgWAR),
    awayLineupStrengthAdjustment: computeBlendedLineupAdj(awayTeam, awayAggregate, leagueAvgWAR),
    homeWarTotal: homeAggregate?.totalWAR ?? 0,
    awayWarTotal: awayAggregate?.totalWAR ?? 0,
  };
}
