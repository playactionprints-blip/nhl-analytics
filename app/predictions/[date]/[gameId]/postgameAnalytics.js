export function hexToRgba(hex, alpha) {
  const normalized = String(hex || "#ffffff").replace("#", "");
  const safe = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const value = Number.parseInt(safe, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function computeXG(xCoord, yCoord, shotType) {
  let nx = xCoord ?? 0;
  let ny = yCoord ?? 0;
  if (nx < 0) {
    nx = -nx;
    ny = -ny;
  }
  const dist = Math.sqrt((89 - nx) ** 2 + ny ** 2);
  const angle = Math.abs(Math.atan2(Math.abs(ny), Math.max(89 - nx, 1)) * (180 / Math.PI));
  const typeBase = {
    wrist: 0.085,
    snap: 0.094,
    slap: 0.072,
    backhand: 0.06,
    "tip-in": 0.145,
    deflected: 0.138,
    bat: 0.05,
    "between-legs": 0.08,
    poke: 0.04,
  };
  const base = typeBase[String(shotType || "").toLowerCase()] ?? 0.075;
  return Math.min(Math.max(base * Math.exp(-dist / 35) * Math.cos((angle * Math.PI) / 180) * 3.2, 0.005), 0.95);
}

export function computeWinProb(homeScore, awayScore, totalSecondsElapsed) {
  const remaining = Math.max(3600 - totalSecondsElapsed, 0);
  const scoreDiff = homeScore - awayScore;
  const timeWeight = remaining / 3600;
  return Math.min(Math.max(0.5 + scoreDiff * 0.15 * (1 - timeWeight * 0.3), 0.02), 0.98);
}

export function periodSeconds(periodNum, timeInPeriod) {
  if (!timeInPeriod) return (periodNum - 1) * 1200;
  const [m, s] = String(timeInPeriod).split(":").map(Number);
  return (periodNum - 1) * 1200 + (m || 0) * 60 + (s || 0);
}

function toiToSeconds(toi) {
  if (!toi) return 0;
  const [m, s] = String(toi).split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
}

export function parsePostgamePbp(data, homeTeamId, awayTeamId) {
  const plays = data?.plays ?? [];
  const rosterSpots = data?.rosterSpots ?? [];

  const nameMap = {};
  for (const r of rosterSpots) {
    const pid = String(r.playerId);
    const fn = r.firstName?.default ?? "";
    const ln = r.lastName?.default ?? "";
    nameMap[pid] = `${fn} ${ln}`.trim() || pid;
  }

  const shotEvents = [];
  const winProbTimeline = [{ x: 0, home: 50, away: 50 }];
  const xgByPeriod = { 1: { home: 0, away: 0 }, 2: { home: 0, away: 0 }, 3: { home: 0, away: 0 }, OT: { home: 0, away: 0 } };
  const playerXG = {};
  const highDanger = { home: 0, away: 0 };

  let homeScore = 0;
  let awayScore = 0;

  const SHOT_TYPES = new Set(["shot-on-goal", "missed-shot", "blocked-shot", "goal"]);

  for (const play of plays) {
    const typeKey = play.typeDescKey;
    if (!SHOT_TYPES.has(typeKey)) continue;

    const det = play.details ?? {};
    const xCoord = det.xCoord;
    const yCoord = det.yCoord;
    const shotType = det.shotType ?? "wrist";
    const teamId = det.eventOwnerTeamId ?? play.eventOwnerTeamId;
    const periodNum = play.periodDescriptor?.number ?? 1;
    const periodType = play.periodDescriptor?.periodType ?? "REG";
    const timeInPeriod = play.timeInPeriod;

    let isHome;
    if (typeKey === "blocked-shot") {
      isHome = teamId !== homeTeamId;
    } else {
      isHome = teamId === homeTeamId;
    }

    let plotX = xCoord ?? 0;
    let plotY = yCoord ?? 0;
    if (isHome && plotX < 0) {
      plotX = -plotX;
      plotY = -plotY;
    } else if (!isHome && plotX > 0) {
      plotX = -plotX;
      plotY = -plotY;
    }

    const xg = computeXG(xCoord, yCoord, shotType);
    const totalSec = periodSeconds(periodNum, timeInPeriod);
    const pKey = periodType === "OT" || periodNum > 3 ? "OT" : periodNum;

    if (xgByPeriod[pKey]) {
      xgByPeriod[pKey][isHome ? "home" : "away"] += xg;
    }

    if (typeKey !== "blocked-shot" && xg >= 0.12) {
      highDanger[isHome ? "home" : "away"] += 1;
    }

    shotEvents.push({
      x: xCoord,
      y: yCoord,
      plotX,
      plotY,
      xg,
      type: typeKey,
      isHome,
      period: periodNum,
      timeInPeriod,
      shooterName: nameMap[String(det.shootingPlayerId ?? det.scoringPlayerId ?? "")] ?? null,
    });

    const shooterId = String(det.shootingPlayerId ?? det.playerId ?? det.scoringPlayerId ?? "");
    if (shooterId && typeKey !== "blocked-shot") {
      if (!playerXG[shooterId]) {
        playerXG[shooterId] = {
          id: shooterId,
          name: nameMap[shooterId] ?? shooterId,
          xg: 0,
          shots: 0,
          isHome,
        };
      }
      playerXG[shooterId].xg += xg;
      if (typeKey === "shot-on-goal" || typeKey === "goal") playerXG[shooterId].shots += 1;
    }

    if (typeKey === "goal") {
      if (isHome) homeScore += 1;
      else awayScore += 1;
      const prob = computeWinProb(homeScore, awayScore, totalSec);
      winProbTimeline.push({
        x: totalSec,
        home: Math.round(prob * 100),
        away: Math.round((1 - prob) * 100),
        scorerId: shooterId,
      });
    }
  }

  winProbTimeline.push({ x: 1200, marker: true });
  winProbTimeline.push({ x: 2400, marker: true });
  winProbTimeline.sort((a, b) => a.x - b.x);

  const totalHomeXG = Object.values(xgByPeriod).reduce((sum, period) => sum + period.home, 0);
  const totalAwayXG = Object.values(xgByPeriod).reduce((sum, period) => sum + period.away, 0);

  return {
    shotEvents,
    winProbTimeline,
    xgByPeriod,
    playerXG,
    totalHomeXG,
    totalAwayXG,
    highDanger,
  };
}

export function simulateDeservedWin(shotEvents, numSims = 5000) {
  const scoringShots = shotEvents.filter((shot) => shot.type !== "blocked-shot" && shot.xg > 0);
  if (!scoringShots.length) return { home: 0.5, away: 0.5, sims: 0 };

  let homeWins = 0;
  let awayWins = 0;

  for (let sim = 0; sim < numSims; sim += 1) {
    let homeGoals = 0;
    let awayGoals = 0;
    for (const shot of scoringShots) {
      if (Math.random() < shot.xg) {
        if (shot.isHome) homeGoals += 1;
        else awayGoals += 1;
      }
    }
    if (homeGoals > awayGoals) homeWins += 1;
    else if (awayGoals > homeGoals) awayWins += 1;
    else if (Math.random() < 0.5) homeWins += 1;
    else awayWins += 1;
  }

  return { home: homeWins / numSims, away: awayWins / numSims, sims: numSims };
}

export function buildPlayerLeaders(playerByGameStats, playerXG, homeAbbr, awayAbbr) {
  const home = playerByGameStats?.homeTeam ?? {};
  const away = playerByGameStats?.awayTeam ?? {};
  const allSkaters = [
    ...(away.forwards || []),
    ...(away.defense || []),
    ...(home.forwards || []),
    ...(home.defense || []),
  ].map((player) => ({
    id: String(player.playerId),
    name: player.name?.default ?? "—",
    position: player.position ?? "—",
    points: player.points ?? 0,
    goals: player.goals ?? 0,
    assists: player.assists ?? 0,
    toi: player.toi ?? "0:00",
    toiSeconds: toiToSeconds(player.toi),
    teamAbbr: (home.forwards || []).includes(player) || (home.defense || []).includes(player) ? homeAbbr : awayAbbr,
    isHome: (home.forwards || []).includes(player) || (home.defense || []).includes(player),
  }));

  const points = [...allSkaters]
    .sort((a, b) => (b.points - a.points) || (b.goals - a.goals) || (b.toiSeconds - a.toiSeconds))
    .slice(0, 5);

  const goals = [...allSkaters]
    .sort((a, b) => (b.goals - a.goals) || (b.points - a.points) || (b.toiSeconds - a.toiSeconds))
    .slice(0, 5);

  const toi = [...allSkaters]
    .sort((a, b) => b.toiSeconds - a.toiSeconds)
    .slice(0, 5);

  const xg = Object.values(playerXG || {})
    .map((entry) => ({
      name: entry.name ?? "—",
      teamAbbr: entry.isHome ? homeAbbr : awayAbbr,
      xg: entry.xg ?? 0,
      shots: entry.shots ?? 0,
    }))
    .sort((a, b) => b.xg - a.xg)
    .slice(0, 5);

  const goalieSummary = [
    ...(away.goalies || []).map((goalie) => ({ ...goalie, teamAbbr: awayAbbr })),
    ...(home.goalies || []).map((goalie) => ({ ...goalie, teamAbbr: homeAbbr })),
  ]
    .sort((a, b) => toiToSeconds(b.toi) - toiToSeconds(a.toi))
    .slice(0, 2)
    .map((goalie) => {
      const shotsAgainst = goalie.shotsAgainst ?? 0;
      const saves = goalie.saves ?? 0;
      const savePct = goalie.savePctg ?? (shotsAgainst > 0 ? saves / shotsAgainst : null);
      return {
        name: goalie.name?.default ?? "—",
        teamAbbr: goalie.teamAbbr,
        toi: goalie.toi ?? "—",
        saves,
        shotsAgainst,
        goalsAgainst: goalie.goalsAgainst ?? 0,
        savePct,
      };
    });

  return { points, goals, toi, xg, goalieSummary };
}
