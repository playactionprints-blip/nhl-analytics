import Link from "next/link";
import { BreadcrumbSetter } from "@/Breadcrumbs";
import { TEAM_COLOR, logoUrl } from "@/app/lib/nhlTeams";
import {
  buildPredictionsForDate,
  confidenceMeta,
  formatHeadlineDate,
  formatStartTime,
  formatRecord,
  getTorontoDateParts,
  formatDateString,
  hexToRgba,
  isValidDateString,
  parseDateString,
  percent,
  predictionHref,
  signedOdds,
  shiftDateParts,
} from "@/app/lib/predictionsData";

export const revalidate = 1800;

export const metadata = {
  title: "NHL Predictions — NHL Analytics",
  description: "Tonight's NHL game predictions with win odds, expected goals, and score distributions.",
};

const CONFIDENCE_TOOLTIP =
  "Confidence is based on available team data quality, recency of goaltender info, and home/away sample size. LOW = less reliable inputs.";

function formatQuickDateLabel(dateString, todayString) {
  if (dateString === todayString) return "Today";

  const today = parseDateString(todayString);
  const current = parseDateString(dateString);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  const currentUtc = Date.UTC(current.year, current.month - 1, current.day);
  const diffDays = Math.round((currentUtc - todayUtc) / (24 * 60 * 60 * 1000));
  if (diffDays === 1) return "Tomorrow";

  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(`${dateString}T12:00:00Z`));
  } catch {
    return dateString;
  }
}

function ConfidenceHelpIcon() {
  return (
    <span
      title={CONFIDENCE_TOOLTIP}
      aria-label={CONFIDENCE_TOOLTIP}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 16,
        height: 16,
        borderRadius: "50%",
        border: "1px solid #35506a",
        color: "#9fc3df",
        fontSize: 10,
        fontWeight: 900,
        lineHeight: 1,
        fontFamily: "'DM Mono',monospace",
        cursor: "help",
        background: "#101a25",
      }}
    >
      ?
    </span>
  );
}

export default async function PredictionsPage({ searchParams }) {
  const today = getTorontoDateParts();
  const todayString = formatDateString(today);
  const resolvedSearchParams = await searchParams;
  const selectedDateString = isValidDateString(resolvedSearchParams?.date)
    ? resolvedSearchParams.date
    : todayString;
  const selectedDateParts = parseDateString(selectedDateString);
  const previousDate = formatDateString(shiftDateParts(selectedDateParts, -1));
  const nextDate = formatDateString(shiftDateParts(selectedDateParts, 1));
  const quickDates = Array.from({ length: 7 }, (_, index) => {
    const dateString = formatDateString(shiftDateParts(today, index));
    return {
      dateString,
      label: formatQuickDateLabel(dateString, todayString),
      active: dateString === selectedDateString,
    };
  });
  const { predictions } = await buildPredictionsForDate(selectedDateString);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #0d2136 0%, #060a11 58%, #05090f 100%)",
        padding: "36px 20px 64px",
      }}
    >
      <BreadcrumbSetter items={[{ href: "/predictions", label: "Predictions" }]} />
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
                  {formatHeadlineDate(selectedDateString)} Predictions
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
                  {predictions.length} games on {selectedDateString}
                </div>
                <div style={{ fontSize: 12, color: "#6d859e", marginTop: 4 }}>
                  Times shown in America/Toronto
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
                border: "1px solid #172534",
                borderRadius: 18,
                background: "#0b1118",
                padding: 16,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Link
                  href={`/predictions?date=${previousDate}`}
                  style={{
                    textDecoration: "none",
                    borderRadius: 14,
                    border: "1px solid #1d3c56",
                    background: "#101a25",
                    padding: "10px 14px",
                    color: "#dff2ff",
                    fontSize: 12,
                    fontWeight: 800,
                    fontFamily: "'DM Mono',monospace",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Prev day
                </Link>
                <form action="/predictions" method="get" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <label
                    htmlFor="prediction-date"
                    style={{ color: "#6f879f", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}
                  >
                    Date
                  </label>
                  <input
                    id="prediction-date"
                    type="date"
                    name="date"
                    defaultValue={selectedDateString}
                    style={{
                      borderRadius: 14,
                      border: "1px solid #1d3c56",
                      background: "#101a25",
                      color: "#eaf7ff",
                      padding: "10px 12px",
                      fontSize: 14,
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      cursor: "pointer",
                      borderRadius: 14,
                      border: "1px solid #246da0",
                      background: "linear-gradient(180deg, #16324b 0%, #0f2234 100%)",
                      color: "#dff2ff",
                      padding: "10px 14px",
                      fontSize: 12,
                      fontWeight: 800,
                      fontFamily: "'DM Mono',monospace",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    Go
                  </button>
                </form>
                <Link
                  href={`/predictions?date=${nextDate}`}
                  style={{
                    textDecoration: "none",
                    borderRadius: 14,
                    border: "1px solid #1d3c56",
                    background: "#101a25",
                    padding: "10px 14px",
                    color: "#dff2ff",
                    fontSize: 12,
                    fontWeight: 800,
                    fontFamily: "'DM Mono',monospace",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Next day
                </Link>
              </div>
              <div style={{ color: "#87a3bb", fontSize: 13 }}>
                Viewing <span style={{ color: "#eff8ff", fontWeight: 800 }}>{formatHeadlineDate(selectedDateString)}</span>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div style={{ color: "#6f879f", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Quick jump
              </div>
              {quickDates.map((quickDate) => (
                <Link
                  key={quickDate.dateString}
                  href={`/predictions?date=${quickDate.dateString}`}
                  style={{
                    textDecoration: "none",
                    borderRadius: 999,
                    border: quickDate.active ? "1px solid #2fb4ff" : "1px solid #1d3c56",
                    background: quickDate.active ? "rgba(47,180,255,0.14)" : "#101a25",
                    padding: "8px 12px",
                    color: quickDate.active ? "#dff5ff" : "#a9c1d7",
                    fontSize: 11,
                    fontWeight: 800,
                    fontFamily: "'DM Mono',monospace",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  {quickDate.label}
                </Link>
              ))}
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
            No upcoming games were found for {selectedDateString}.
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
                    <Link
                      key={`overview-${game.id}`}
                      href={predictionHref(selectedDateString, game.id)}
                      style={{
                        textDecoration: "none",
                        borderRadius: 18,
                        border: "1px solid #1a2d40",
                        background: `linear-gradient(135deg, ${hexToRgba(awayColor, 0.18)} 0%, rgba(9,16,23,0.96) 36%, rgba(9,16,23,0.96) 64%, ${hexToRgba(homeColor, 0.18)} 100%)`,
                        padding: 14,
                        display: "grid",
                        gap: 10,
                        minHeight: 148,
                        transition: "transform 0.16s ease, border-color 0.16s ease",
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
                    </Link>
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
                <Link
                  key={game.id}
                  className="prediction-card"
                  href={predictionHref(selectedDateString, game.id)}
                  style={{
                    display: "block",
                    textDecoration: "none",
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
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          {prediction.modelDiagnostics.confidenceBand}
                          <ConfidenceHelpIcon />
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
                </Link>
              );
            })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
