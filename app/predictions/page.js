import { createServerClient } from "@/app/lib/supabase";
import { TEAM_COLOR, TEAM_FULL, logoUrl } from "@/app/lib/nhlTeams";
import { predictGame } from "@/src/models/predictGame";
import {
  buildGameContextFromTeams,
  buildPlayerAggregates,
  buildTeamSeasonStatsFromLiveData,
  normalizeScheduleGame,
  normalizeStandingsSnapshot,
} from "@/src/data/livePredictionData";

export const revalidate = 1800;

export const metadata = {
  title: "NHL Predictions — NHL Analytics",
  description: "Tonight's NHL game predictions with win odds, expected goals, and score distributions.",
};

function getTorontoDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  return { year, month, day };
}

function formatDateString({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDateParts(parts, deltaDays) {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + deltaDays));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

async function fetchScheduleForDate(dateString) {
  try {
    const res = await fetch(`https://api-web.nhle.com/v1/schedule/${dateString}`, {
      next: { revalidate: 1800 },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const gameWeekGames = (data.gameWeek || []).flatMap((day) => day.games || []);
    return (data.games || gameWeekGames || []);
  } catch {
    return [];
  }
}

async function fetchStandingsMap() {
  try {
    const res = await fetch("https://api-web.nhle.com/v1/standings/now", {
      next: { revalidate: 1800 },
    });
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const raw of data.standings || []) {
      const row = normalizeStandingsSnapshot(raw, TEAM_FULL);
      if (!row) continue;
      map[row.abbr] = row;
    }
    return map;
  } catch {
    return {};
  }
}

async function fetchSpecialTeamsMap() {
  try {
    const seasonExpr = "seasonId=20252026";
    const [ppRes, pkRes] = await Promise.all([
      fetch(`https://api.nhle.com/stats/rest/en/team/powerplay?cayenneExp=${seasonExpr}`, {
        next: { revalidate: 1800 },
      }),
      fetch(`https://api.nhle.com/stats/rest/en/team/penaltykill?cayenneExp=${seasonExpr}`, {
        next: { revalidate: 1800 },
      }),
    ]);

    const map = {};
    if (ppRes.ok) {
      const data = await ppRes.json();
      for (const row of data.data || []) {
        const abbr = Object.entries(TEAM_FULL).find(([, name]) => name === row.teamFullName)?.[0];
        if (!abbr) continue;
        map[abbr] = {
          ...(map[abbr] || {}),
          ppPct: row.powerPlayPct != null ? row.powerPlayPct : null,
        };
      }
    }
    if (pkRes.ok) {
      const data = await pkRes.json();
      for (const row of data.data || []) {
        const abbr = Object.entries(TEAM_FULL).find(([, name]) => name === row.teamFullName)?.[0];
        if (!abbr) continue;
        map[abbr] = {
          ...(map[abbr] || {}),
          pkPct: row.penaltyKillPct != null ? row.penaltyKillPct : null,
        };
      }
    }
    return map;
  } catch {
    return {};
  }
}

function formatStartTime(utcString) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(utcString));
  } catch {
    return utcString || "TBD";
  }
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function signedOdds(value) {
  return value > 0 ? `+${value}` : `${value}`;
}

function confidenceMeta(band) {
  if (band === "high") return { color: "#35e3a0", bg: "rgba(53,227,160,0.14)" };
  if (band === "medium") return { color: "#f0c040", bg: "rgba(240,192,64,0.14)" };
  return { color: "#ff8d9b", bg: "rgba(255,111,123,0.14)" };
}

export default async function PredictionsPage() {
  const today = getTorontoDateParts();
  const yesterday = shiftDateParts(today, -1);
  const todayString = formatDateString(today);
  const yesterdayString = formatDateString(yesterday);

  const supabase = createServerClient();
  const [
    todayGamesRaw,
    yesterdayGamesRaw,
    standingsByTeam,
    specialTeamsByTeam,
    { data: players },
  ] = await Promise.all([
    fetchScheduleForDate(todayString),
    fetchScheduleForDate(yesterdayString),
    fetchStandingsMap(),
    fetchSpecialTeamsMap(),
    supabase
      .from("players")
      .select("team,position,off_rating,def_rating,overall_rating,xgf_pct,war_shooting,gp,save_pct,gsax,full_name"),
  ]);

  const playerAggregates = buildPlayerAggregates(players || [], TEAM_FULL);
  const yesterdayTeams = new Set(
    (yesterdayGamesRaw || [])
      .flatMap((game) => {
        const normalized = normalizeScheduleGame(game, TEAM_FULL);
        return normalized ? [normalized.homeTeam.abbr, normalized.awayTeam.abbr] : [];
      })
  );

  const normalizedGames = (todayGamesRaw || [])
    .map((game) => normalizeScheduleGame(game, TEAM_FULL))
    .filter(Boolean)
    .filter((game) => !["FINAL", "OFF"].includes(game.gameState));

  const predictions = normalizedGames
    .map((game) => {
      const homeTeam = buildTeamSeasonStatsFromLiveData(
        game.homeTeam.abbr,
        standingsByTeam,
        specialTeamsByTeam,
        playerAggregates
      );
      const awayTeam = buildTeamSeasonStatsFromLiveData(
        game.awayTeam.abbr,
        standingsByTeam,
        specialTeamsByTeam,
        playerAggregates
      );

      if (!homeTeam || !awayTeam) return null;

      const context = buildGameContextFromTeams(homeTeam, awayTeam, playerAggregates);
      context.homeBackToBack = yesterdayTeams.has(homeTeam.teamId);
      context.awayBackToBack = yesterdayTeams.has(awayTeam.teamId);
      context.homeRestDays = context.homeBackToBack ? 0 : 1;
      context.awayRestDays = context.awayBackToBack ? 0 : 1;
      context.homeTravelDisadvantage = false;
      context.awayTravelDisadvantage = context.awayBackToBack;

      const prediction = predictGame(context);
      return {
        game,
        prediction,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.game.startTimeUTC).getTime() - new Date(b.game.startTimeUTC).getTime());

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #0d2136 0%, #060a11 58%, #05090f 100%)",
        padding: "36px 20px 64px",
      }}
    >
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gap: 18 }}>
        <section
          style={{
            border: "1px solid #18304a",
            borderRadius: 28,
            background: "linear-gradient(180deg, rgba(10,20,32,0.98) 0%, rgba(7,11,18,0.98) 100%)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "28px 28px 24px", display: "grid", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 11, color: "#4d82af", fontFamily: "'DM Mono',monospace", letterSpacing: "0.16em", textTransform: "uppercase" }}>
                  NHL Analytics · Game Model
                </div>
                <h1 style={{ margin: 0, color: "#eff8ff", fontSize: 46, lineHeight: 0.95, letterSpacing: "-0.04em", fontWeight: 900 }}>
                  Tonight&apos;s NHL Predictions
                </h1>
                <p style={{ margin: 0, maxWidth: 860, color: "#86a5c0", fontSize: 18, lineHeight: 1.35 }}>
                  A first-pass game model combining team scoring environment, shot quality proxies, finishing, goaltending, special teams, and 10,000-game Monte Carlo simulation.
                </p>
              </div>
              <div
                style={{
                  border: "1px solid #1f5b85",
                  borderRadius: 18,
                  padding: "14px 18px",
                  minWidth: 220,
                  background: "rgba(10, 35, 56, 0.45)",
                }}
              >
                <div style={{ fontSize: 11, color: "#6cbef1", fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
                  Slate snapshot
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#eaf7ff", marginTop: 4 }}>
                  {predictions.length} games on {todayString}
                </div>
                <div style={{ fontSize: 12, color: "#6d859e", marginTop: 4 }}>
                  Times shown in America/Toronto
                </div>
              </div>
            </div>

            <div
              style={{
                border: "1px solid #172534",
                borderRadius: 18,
                background: "#0b1118",
                padding: 18,
                color: "#cfe4f6",
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              This v1 board uses live standings, special teams, and your current player/goaltender data to build team-level inputs. It is intentionally transparent and editable, not a black-box model yet.
            </div>
          </div>
        </section>

        {predictions.length === 0 ? (
          <section
            style={{
              border: "1px solid #17283b",
              borderRadius: 24,
              background: "#091017",
              padding: 24,
              color: "#86a5c0",
            }}
          >
            No upcoming games were found for {todayString}.
          </section>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              gap: 16,
            }}
          >
            {predictions.map(({ game, prediction }) => {
              const homeMeta = confidenceMeta(
                prediction.homeWinPct >= prediction.awayWinPct
                  ? prediction.modelDiagnostics.confidenceBand
                  : "low"
              );
              const awayMeta = confidenceMeta(
                prediction.awayWinPct > prediction.homeWinPct
                  ? prediction.modelDiagnostics.confidenceBand
                  : "low"
              );

              return (
                <section
                  key={game.id}
                  style={{
                    border: "1px solid #17283b",
                    borderRadius: 24,
                    background: "#091017",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ padding: 18, borderBottom: "1px solid #132131", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#5e7b98", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                        {formatStartTime(game.startTimeUTC)}
                      </div>
                      <div style={{ fontSize: 22, color: "#eff8ff", fontWeight: 900, marginTop: 4 }}>
                        {game.awayTeam.name} at {game.homeTeam.name}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#6f879f", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {prediction.modelDiagnostics.simulationCount.toLocaleString()} sims
                    </div>
                  </div>

                  <div style={{ padding: 18, display: "grid", gap: 16 }}>
                    {[
                      {
                        side: "Away",
                        abbr: game.awayTeam.abbr,
                        team: prediction.awayTeam,
                        winPct: prediction.awayWinPct,
                        fairOdds: prediction.fairOdds.awayMoneyline,
                        expectedGoals: prediction.expectedAwayGoals,
                        expectedShots: prediction.expectedAwayShots,
                        meta: awayMeta,
                      },
                      {
                        side: "Home",
                        abbr: game.homeTeam.abbr,
                        team: prediction.homeTeam,
                        winPct: prediction.homeWinPct,
                        fairOdds: prediction.fairOdds.homeMoneyline,
                        expectedGoals: prediction.expectedHomeGoals,
                        expectedShots: prediction.expectedHomeShots,
                        meta: homeMeta,
                      },
                    ].map((teamRow) => (
                      <div
                        key={teamRow.side}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr) auto",
                          gap: 12,
                          alignItems: "center",
                          padding: "14px 16px",
                          borderRadius: 18,
                          background: "#0d1620",
                          border: "1px solid #182736",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={logoUrl(teamRow.abbr)}
                            alt={teamRow.abbr}
                            width={38}
                            height={38}
                            style={{ width: 38, height: 38, objectFit: "contain" }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: "#eff8ff", fontSize: 18, fontWeight: 900 }}>{teamRow.team}</div>
                            <div style={{ color: "#6f879f", fontSize: 11, fontFamily: "'DM Mono',monospace", marginTop: 4 }}>
                              xG {teamRow.expectedGoals.toFixed(2)} · shots {teamRow.expectedShots.toFixed(1)} · fair {signedOdds(teamRow.fairOdds)}
                            </div>
                          </div>
                        </div>
                        <div
                          style={{
                            minWidth: 88,
                            textAlign: "right",
                            padding: "8px 10px",
                            borderRadius: 14,
                            background: teamRow.meta.bg,
                            color: teamRow.meta.color,
                          }}
                        >
                          <div style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            {teamRow.side} win
                          </div>
                          <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1 }}>{percent(teamRow.winPct)}</div>
                        </div>
                      </div>
                    ))}

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                        gap: 12,
                      }}
                    >
                      {[
                        ["Regulation tie", percent(prediction.regulationTiePct)],
                        ["Overtime rate", percent(prediction.overtimePct)],
                        ["Confidence", prediction.modelDiagnostics.confidenceBand],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          style={{
                            borderRadius: 16,
                            background: "#0d1620",
                            border: "1px solid #182736",
                            padding: "12px 14px",
                          }}
                        >
                          <div style={{ color: "#6f879f", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            {label}
                          </div>
                          <div style={{ color: "#eff8ff", fontSize: 20, fontWeight: 900, marginTop: 6 }}>{value}</div>
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        borderRadius: 18,
                        background: "#0d1620",
                        border: "1px solid #182736",
                        padding: "14px 16px",
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div style={{ color: "#89a8c1", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        Most likely score outcomes
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {prediction.mostLikelyScores.map((score) => (
                          <div
                            key={`${score.home}-${score.away}`}
                            style={{
                              borderRadius: 999,
                              padding: "8px 10px",
                              background: "#121f2d",
                              border: "1px solid #1e3145",
                              color: "#eaf6ff",
                              fontWeight: 800,
                              fontSize: 14,
                            }}
                          >
                            {game.awayTeam.abbr} {score.away} - {score.home} {game.homeTeam.abbr}
                            <span style={{ color: "#7bcfff", fontFamily: "'DM Mono',monospace", fontSize: 11, marginLeft: 8 }}>
                              {percent(score.probability)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
