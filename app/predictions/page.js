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

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(255,255,255,${alpha})`;
  const normalized = hex.replace("#", "");
  const safe = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const value = Number.parseInt(safe, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatHeadlineDate(dateString) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(`${dateString}T12:00:00Z`));
  } catch {
    return dateString;
  }
}

function formatRecord(record) {
  if (!record) return "—";
  return `${record.wins}-${record.losses}-${record.overtimeLosses}`;
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
        homeTeam,
        awayTeam,
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
      <style>{`
        .predictions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
          gap: 18px;
        }
        .prediction-card {
          position: relative;
          overflow: hidden;
        }
        .prediction-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 42px rgba(0,0,0,0.28);
        }
        .slate-scroll {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: minmax(240px, 1fr);
          gap: 12px;
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .slate-scroll::-webkit-scrollbar {
          height: 8px;
        }
        .slate-scroll::-webkit-scrollbar-thumb {
          background: #183247;
          border-radius: 999px;
        }
        @media (max-width: 900px) {
          .predictions-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
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
                  {formatHeadlineDate(todayString)} Predictions
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
          <>
            <section
              style={{
                border: "1px solid #17283b",
                borderRadius: 24,
                background: "#091017",
                padding: 18,
                display: "grid",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: "#5e7b98", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    Slate overview
                  </div>
                  <div style={{ fontSize: 26, color: "#eff8ff", fontWeight: 900, marginTop: 4 }}>
                    Tonight&apos;s edge board
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#6f879f", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Win odds · xG · score distribution
                </div>
              </div>

              <div className="slate-scroll">
                {predictions.map(({ game, prediction }) => {
                  const homeColor = TEAM_COLOR[game.homeTeam.abbr] || "#1f5b85";
                  const awayColor = TEAM_COLOR[game.awayTeam.abbr] || "#1f5b85";
                  const favoriteIsHome = prediction.homeWinPct >= prediction.awayWinPct;
                  return (
                    <div
                      key={`overview-${game.id}`}
                      style={{
                        borderRadius: 18,
                        border: "1px solid #1a2d40",
                        background: `linear-gradient(135deg, ${hexToRgba(awayColor, 0.18)} 0%, rgba(9,16,23,0.96) 36%, rgba(9,16,23,0.96) 64%, ${hexToRgba(homeColor, 0.18)} 100%)`,
                        padding: 14,
                        display: "grid",
                        gap: 10,
                        minHeight: 148,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div style={{ color: "#7bcfff", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          {formatStartTime(game.startTimeUTC)}
                        </div>
                        <div style={{ color: "#617b96", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>
                          {favoriteIsHome ? "home edge" : "away edge"}
                        </div>
                      </div>
                      {[
                        {
                          abbr: game.awayTeam.abbr,
                          team: game.awayTeam.name,
                          pct: prediction.awayWinPct,
                        },
                        {
                          abbr: game.homeTeam.abbr,
                          team: game.homeTeam.name,
                          pct: prediction.homeWinPct,
                        },
                      ].map((row) => (
                        <div key={`${game.id}-${row.abbr}`} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto", gap: 10, alignItems: "center" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={logoUrl(row.abbr)} alt={row.abbr} width={28} height={28} style={{ width: 28, height: 28, objectFit: "contain" }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: "#e9f6ff", fontSize: 16, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {row.abbr}
                            </div>
                          </div>
                          <div
                            style={{
                              padding: "5px 8px",
                              borderRadius: 10,
                              background: row.pct >= 0.5 ? "rgba(83, 177, 255, 0.2)" : "rgba(255, 111, 123, 0.18)",
                              color: row.pct >= 0.5 ? "#9dd8ff" : "#ff9aa4",
                              fontWeight: 900,
                              fontSize: 18,
                              lineHeight: 1,
                            }}
                          >
                            {Math.round(row.pct * 100)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="predictions-grid">
            {predictions.map(({ game, prediction, homeTeam, awayTeam }) => {
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
              const homeColor = TEAM_COLOR[game.homeTeam.abbr] || "#1f5b85";
              const awayColor = TEAM_COLOR[game.awayTeam.abbr] || "#1f5b85";
              const winGap = Math.abs(prediction.homeWinPct - prediction.awayWinPct);
              const tieColor = confidenceMeta(
                prediction.regulationTiePct > 0.24 ? "high" : prediction.regulationTiePct > 0.2 ? "medium" : "low"
              );

              return (
                <section
                  key={game.id}
                  className="prediction-card"
                  style={{
                    border: "1px solid #17283b",
                    borderRadius: 24,
                    background: "#091017",
                    overflow: "hidden",
                    transition: "transform 0.18s ease, box-shadow 0.18s ease",
                  }}
                >
                  <div
                    style={{
                      padding: 18,
                      borderBottom: "1px solid #132131",
                      background: `linear-gradient(135deg, ${hexToRgba(awayColor, 0.22)} 0%, rgba(9,16,23,0.94) 38%, rgba(9,16,23,0.94) 62%, ${hexToRgba(homeColor, 0.22)} 100%)`,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 16 }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#7db8e5", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                          {formatStartTime(game.startTimeUTC)} · {game.gameState}
                        </div>
                        <div style={{ fontSize: 22, color: "#eff8ff", fontWeight: 900, marginTop: 4 }}>
                          {game.awayTeam.abbr} at {game.homeTeam.abbr}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: "#6f879f", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          model confidence
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            display: "inline-flex",
                            padding: "7px 10px",
                            borderRadius: 999,
                            background: winGap > 0.16 ? "rgba(53,227,160,0.14)" : winGap > 0.08 ? "rgba(240,192,64,0.14)" : "rgba(255,111,123,0.14)",
                            color: winGap > 0.16 ? "#35e3a0" : winGap > 0.08 ? "#f0c040" : "#ff8d9b",
                            fontSize: 11,
                            fontWeight: 800,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            fontFamily: "'DM Mono',monospace",
                          }}
                        >
                          {prediction.modelDiagnostics.confidenceBand}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                        gap: 16,
                        alignItems: "center",
                      }}
                    >
                      {[
                        {
                          side: "away",
                          abbr: game.awayTeam.abbr,
                          name: game.awayTeam.name,
                          record: formatRecord(awayTeam.awayRecord),
                          winPct: prediction.awayWinPct,
                          expectedGoals: prediction.expectedAwayGoals,
                          expectedShots: prediction.expectedAwayShots,
                          fairOdds: prediction.fairOdds.awayMoneyline,
                          meta: awayMeta,
                          align: "left",
                        },
                        {
                          side: "home",
                          abbr: game.homeTeam.abbr,
                          name: game.homeTeam.name,
                          record: formatRecord(homeTeam.homeRecord),
                          winPct: prediction.homeWinPct,
                          expectedGoals: prediction.expectedHomeGoals,
                          expectedShots: prediction.expectedHomeShots,
                          fairOdds: prediction.fairOdds.homeMoneyline,
                          meta: homeMeta,
                          align: "right",
                        },
                      ].map((teamRow, index) => (
                        <div
                          key={`${game.id}-${teamRow.side}`}
                          style={{
                            display: "grid",
                            gap: 12,
                            justifyItems: teamRow.align === "right" ? "end" : "start",
                            textAlign: teamRow.align,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 12, flexDirection: teamRow.align === "right" ? "row-reverse" : "row" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={logoUrl(teamRow.abbr)}
                              alt={teamRow.abbr}
                              width={56}
                              height={56}
                              style={{ width: 56, height: 56, objectFit: "contain" }}
                            />
                            <div>
                              <div style={{ color: "#eff8ff", fontSize: 28, fontWeight: 900, lineHeight: 0.95 }}>{Math.round(teamRow.winPct * 100)}%</div>
                              <div style={{ color: teamRow.meta.color, fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 4 }}>
                                {teamRow.side} win probability
                              </div>
                            </div>
                          </div>
                          <div>
                            <div style={{ color: "#ecf7ff", fontSize: 20, fontWeight: 900 }}>{teamRow.name}</div>
                            <div style={{ color: "#7f9ab5", fontSize: 11, fontFamily: "'DM Mono',monospace", marginTop: 4 }}>
                              {teamRow.align === "right" ? "home" : "away"} split {teamRow.record}
                            </div>
                          </div>
                          <div style={{ width: "100%", maxWidth: 240, height: 10, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${teamRow.winPct * 100}%`,
                                height: "100%",
                                background: `linear-gradient(90deg, ${hexToRgba(teamRow.align === "right" ? homeColor : awayColor, 0.7)} 0%, ${teamRow.align === "right" ? homeColor : awayColor} 100%)`,
                              }}
                            />
                          </div>
                        </div>
                      ))}

                      <div
                        style={{
                          display: "grid",
                          gap: 10,
                          justifyItems: "center",
                          alignContent: "center",
                          minWidth: 120,
                        }}
                      >
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: tieColor.bg,
                            color: tieColor.color,
                            fontSize: 11,
                            fontWeight: 800,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            fontFamily: "'DM Mono',monospace",
                          }}
                        >
                          Tie {percent(prediction.regulationTiePct)}
                        </div>
                        <div style={{ color: "#89a8c1", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          {prediction.modelDiagnostics.simulationCount.toLocaleString()} sims
                        </div>
                        <div style={{ color: "#eff8ff", fontSize: 16, fontWeight: 900 }}>
                          xG {prediction.expectedAwayGoals.toFixed(2)} - {prediction.expectedHomeGoals.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: 18, display: "grid", gap: 16 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                        gap: 12,
                      }}
                    >
                      {[
                        ["Away fair", signedOdds(prediction.fairOdds.awayMoneyline)],
                        ["Home fair", signedOdds(prediction.fairOdds.homeMoneyline)],
                        ["Overtime", percent(prediction.overtimePct)],
                        ["Win gap", percent(winGap)],
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
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 10,
                      }}
                    >
                      {[
                        {
                          label: game.awayTeam.abbr,
                          color: awayColor,
                          xg: prediction.expectedAwayGoals,
                          shots: prediction.expectedAwayShots,
                        },
                        {
                          label: game.homeTeam.abbr,
                          color: homeColor,
                          xg: prediction.expectedHomeGoals,
                          shots: prediction.expectedHomeShots,
                        },
                      ].map((row) => (
                        <div key={`${game.id}-${row.label}-metrics`} style={{ borderRadius: 14, background: hexToRgba(row.color, 0.1), border: `1px solid ${hexToRgba(row.color, 0.28)}`, padding: "12px 14px" }}>
                          <div style={{ color: row.color, fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            {row.label} attack outlook
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 10 }}>
                            <div>
                              <div style={{ color: "#6f879f", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Expected goals</div>
                              <div style={{ color: "#eff8ff", fontSize: 26, fontWeight: 900, marginTop: 4 }}>{row.xg.toFixed(2)}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ color: "#6f879f", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Expected shots</div>
                              <div style={{ color: "#eff8ff", fontSize: 26, fontWeight: 900, marginTop: 4 }}>{row.shots.toFixed(1)}</div>
                            </div>
                          </div>
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
          </>
        )}
      </div>
    </div>
  );
}
