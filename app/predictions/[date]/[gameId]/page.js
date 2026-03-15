import Link from "next/link";
import { notFound } from "next/navigation";
import { TEAM_COLOR, logoUrl } from "@/app/lib/nhlTeams";
import {
  buildPredictionsForDate,
  confidenceMeta,
  formatHeadlineDate,
  formatRecord,
  formatStartTime,
  hexToRgba,
  percent,
  predictionHref,
  signedOdds,
} from "@/app/lib/predictionsData";

export const revalidate = 1800;

function formatPct(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatGoalieValue(value, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function teamPillStyle(color) {
  return {
    borderRadius: 999,
    border: `1px solid ${hexToRgba(color, 0.4)}`,
    background: hexToRgba(color, 0.14),
    padding: "7px 10px",
    color,
    fontSize: 11,
    fontFamily: "'DM Mono',monospace",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };
}

function compareRow(label, awayValue, homeValue, awayColor, homeColor, suffix = "") {
  const awayWins = awayValue > homeValue;
  const homeWins = homeValue > awayValue;
  const maxValue = Math.max(awayValue, homeValue, 1);

  return (
    <div
      key={label}
      style={{
        display: "grid",
        gridTemplateColumns: "60px minmax(0, 1fr) 120px minmax(0, 1fr) 60px",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div style={{ color: awayWins ? awayColor : "#9ab2c8", fontWeight: 900, fontSize: 20 }}>
        {awayValue.toFixed(1)}{suffix}
      </div>
      <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div
          style={{
            width: `${(awayValue / maxValue) * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${hexToRgba(awayColor, 0.42)} 0%, ${awayColor} 100%)`,
          }}
        />
      </div>
      <div style={{ color: "#6d8aa6", fontSize: 11, fontFamily: "'DM Mono',monospace", textAlign: "center", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
        <div
          style={{
            marginLeft: "auto",
            width: `${(homeValue / maxValue) * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${hexToRgba(homeColor, 0.42)} 0%, ${homeColor} 100%)`,
          }}
        />
      </div>
      <div style={{ color: homeWins ? homeColor : "#9ab2c8", fontWeight: 900, fontSize: 20, textAlign: "right" }}>
        {homeValue.toFixed(1)}{suffix}
      </div>
    </div>
  );
}

function renderLeaderList(title, players, color, valueKey) {
  return (
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
      <div style={{ color, fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {title}
      </div>
      {players.length === 0 ? (
        <div style={{ color: "#7e98b2", fontSize: 14 }}>No player data available.</div>
      ) : (
        players.map((player) => (
          <div key={`${title}-${player.full_name}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#eaf6ff", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {player.full_name}
              </div>
              <div style={{ color: "#7390ab", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                {player.position || "—"}
              </div>
            </div>
            <div style={{ color, fontWeight: 900, fontSize: 18 }}>
              {typeof player[valueKey] === "number" ? player[valueKey].toFixed(1) : "—"}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default async function GamePredictionDetailPage({ params }) {
  const { date, gameId } = await params;
  const { predictions } = await buildPredictionsForDate(date);
  const matchup = predictions.find((item) => item.game.id === gameId);

  if (!matchup) notFound();

  const {
    game,
    prediction,
    context,
    homeTeam,
    awayTeam,
    homeRatings,
    awayRatings,
    homeLeaders,
    awayLeaders,
    projectedHomeGoalie,
    projectedAwayGoalie,
    market,
  } = matchup;

  const awayColor = TEAM_COLOR[game.awayTeam.abbr] || "#4d82af";
  const homeColor = TEAM_COLOR[game.homeTeam.abbr] || "#4d82af";
  const favoriteIsHome = prediction.homeWinPct >= prediction.awayWinPct;
  const confidence = confidenceMeta(prediction.modelDiagnostics.confidenceBand);

  const comparisonRows = [
    ["Offense", awayRatings.offenseRating, homeRatings.offenseRating],
    ["Defense", awayRatings.defenseRating, homeRatings.defenseRating],
    ["Finishing", awayRatings.finishingRating, homeRatings.finishingRating],
    ["Goalies", awayRatings.goaltendingRating, homeRatings.goaltendingRating],
    ["Special teams", awayRatings.specialTeamsRating, homeRatings.specialTeamsRating],
    ["Form", awayRatings.formRating, homeRatings.formRating],
  ];

  const teamContextCards = [
    {
      team: game.awayTeam.abbr,
      color: awayColor,
      splitLabel: "Away split",
      splitRecord: formatRecord(awayTeam.awayRecord),
      splitPct: formatPct(awayTeam.awayRecord?.pointPct ?? 0.5),
      recentLabel: "Last 10",
      recentValue: `${Math.round((awayTeam.recent10.pointsPct || 0.5) * 100)} pts%`,
      restValue: context.awayBackToBack ? "Back-to-back" : `${context.awayRestDays} day rest`,
      goalieName: projectedAwayGoalie.starterName,
      goalieSv: formatGoalieValue(projectedAwayGoalie.savePct, 3),
      goalieGsax: formatGoalieValue(projectedAwayGoalie.gsax, 2),
      goalieProjectionLabel: projectedAwayGoalie.projectionLabel,
    },
    {
      team: game.homeTeam.abbr,
      color: homeColor,
      splitLabel: "Home split",
      splitRecord: formatRecord(homeTeam.homeRecord),
      splitPct: formatPct(homeTeam.homeRecord?.pointPct ?? 0.5),
      recentLabel: "Last 10",
      recentValue: `${Math.round((homeTeam.recent10.pointsPct || 0.5) * 100)} pts%`,
      restValue: context.homeBackToBack ? "Back-to-back" : `${context.homeRestDays} day rest`,
      goalieName: projectedHomeGoalie.starterName,
      goalieSv: formatGoalieValue(projectedHomeGoalie.savePct, 3),
      goalieGsax: formatGoalieValue(projectedHomeGoalie.gsax, 2),
      goalieProjectionLabel: projectedHomeGoalie.projectionLabel,
    },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #0d2136 0%, #060a11 58%, #05090f 100%)",
        padding: "28px 20px 64px",
      }}
    >
      <style>{`
        .detail-grid {
          display: grid;
          grid-template-columns: 1.2fr 0.9fr;
          gap: 18px;
        }
        .detail-stack {
          display: grid;
          gap: 18px;
        }
        .dual-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        @media (max-width: 1024px) {
          .detail-grid,
          .dual-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gap: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href="/predictions"
            style={{
              ...teamPillStyle("#7cc7ff"),
              textDecoration: "none",
            }}
          >
            Back to predictions
          </Link>
          <div style={{ color: "#6f879f", fontFamily: "'DM Mono',monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {formatHeadlineDate(date)} · {formatStartTime(game.startTimeUTC)}
          </div>
        </div>

        <section
          style={{
            border: "1px solid #18304a",
            borderRadius: 28,
            background: `linear-gradient(135deg, ${hexToRgba(awayColor, 0.26)} 0%, rgba(8,14,21,0.98) 35%, rgba(8,14,21,0.98) 65%, ${hexToRgba(homeColor, 0.26)} 100%)`,
            boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
            overflow: "hidden",
            padding: 28,
          }}
        >
          <div className="detail-grid">
            <div style={{ display: "grid", gap: 22 }}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", gap: 16, alignItems: "center" }}>
                {[
                  {
                    side: "away",
                    team: game.awayTeam,
                    pct: prediction.awayWinPct,
                    color: awayColor,
                    record: formatRecord(awayTeam.awayRecord),
                  },
                  {
                    side: "home",
                    team: game.homeTeam,
                    pct: prediction.homeWinPct,
                    color: homeColor,
                    record: formatRecord(homeTeam.homeRecord),
                  },
                ].map((row) => (
                  <div
                    key={row.side}
                    style={{
                      textAlign: row.side === "home" ? "right" : "left",
                      display: "grid",
                      gap: 10,
                      justifyItems: row.side === "home" ? "end" : "start",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoUrl(row.team.abbr)} alt={row.team.abbr} width={76} height={76} style={{ width: 76, height: 76, objectFit: "contain" }} />
                    <div style={{ color: "#f1fbff", fontSize: 38, fontWeight: 900, lineHeight: 0.95 }}>{Math.round(row.pct * 100)}%</div>
                    <div style={{ color: row.color, fontSize: 12, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {row.side} win chance
                    </div>
                    <div>
                      <div style={{ color: "#eff8ff", fontSize: 28, fontWeight: 900 }}>{row.team.name}</div>
                      <div style={{ color: "#8da7bf", fontSize: 12, fontFamily: "'DM Mono',monospace", marginTop: 4 }}>
                        {row.side === "home" ? "Home split" : "Away split"} {row.record}
                      </div>
                    </div>
                  </div>
                ))}

                <div style={{ display: "grid", gap: 10, justifyItems: "center" }}>
                  <div
                    style={{
                      padding: "7px 12px",
                      borderRadius: 999,
                      background: confidence.bg,
                      color: confidence.color,
                      fontWeight: 800,
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontFamily: "'DM Mono',monospace",
                    }}
                  >
                    {prediction.modelDiagnostics.confidenceBand} confidence
                  </div>
                  <div style={{ color: "#7d98b1", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {prediction.modelDiagnostics.simulationCount.toLocaleString()} sims
                  </div>
                  <div style={{ color: "#eaf6ff", fontSize: 22, fontWeight: 900, textAlign: "center" }}>
                    {game.awayTeam.abbr} at {game.homeTeam.abbr}
                  </div>
                </div>
              </div>

              <div className="dual-grid">
                {[
                  {
                    label: "Projected away attack",
                    color: awayColor,
                    goals: prediction.expectedAwayGoals,
                    shots: prediction.expectedAwayShots,
                    fair: prediction.fairOdds.awayMoneyline,
                  },
                  {
                    label: "Projected home attack",
                    color: homeColor,
                    goals: prediction.expectedHomeGoals,
                    shots: prediction.expectedHomeShots,
                    fair: prediction.fairOdds.homeMoneyline,
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    style={{
                      borderRadius: 18,
                      border: `1px solid ${hexToRgba(row.color, 0.3)}`,
                      background: hexToRgba(row.color, 0.1),
                      padding: "16px 18px",
                      display: "grid",
                      gap: 12,
                    }}
                  >
                    <div style={{ color: row.color, fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {row.label}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div style={{ color: "#738da5", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Expected goals</div>
                        <div style={{ color: "#eff8ff", fontSize: 34, fontWeight: 900, marginTop: 4 }}>{row.goals.toFixed(2)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: "#738da5", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Expected shots</div>
                        <div style={{ color: "#eff8ff", fontSize: 34, fontWeight: 900, marginTop: 4 }}>{row.shots.toFixed(1)}</div>
                      </div>
                    </div>
                    <div style={{ color: "#dfefff", fontSize: 14 }}>
                      Fair price <span style={{ fontWeight: 900 }}>{signedOdds(row.fair)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="detail-stack">
              <div
                style={{
                  borderRadius: 20,
                  background: "#0b121a",
                  border: "1px solid #17283b",
                  padding: "18px 20px",
                  display: "grid",
                  gap: 14,
                }}
              >
                <div style={{ color: "#8db9dc", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Matchup snapshot
                </div>
                <div className="dual-grid" style={{ gap: 12 }}>
                  {[
                    ["Regulation tie", percent(prediction.regulationTiePct)],
                    ["Overtime rate", percent(prediction.overtimePct)],
                    ["Favorite", favoriteIsHome ? game.homeTeam.abbr : game.awayTeam.abbr],
                    ["Win gap", percent(Math.abs(prediction.homeWinPct - prediction.awayWinPct))],
                  ].map(([label, value]) => (
                    <div key={label} style={{ borderRadius: 16, background: "#0f1924", border: "1px solid #182736", padding: "12px 14px" }}>
                      <div style={{ color: "#738da5", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {label}
                      </div>
                      <div style={{ color: "#eff8ff", fontSize: 22, fontWeight: 900, marginTop: 6 }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ color: "#89a6be", fontSize: 14, lineHeight: 1.5 }}>
                  {favoriteIsHome ? game.homeTeam.name : game.awayTeam.name} enters as the model favorite, driven by the stronger blend of team ratings, context, and simulated scoring environment.
                </div>
              </div>

              <div
                style={{
                  borderRadius: 20,
                  background: "#0b121a",
                  border: "1px solid #17283b",
                  padding: "18px 20px",
                  display: "grid",
                  gap: 14,
                }}
              >
                <div style={{ color: "#8db9dc", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Most likely score outcomes
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {prediction.mostLikelyScores.map((score) => (
                    <div
                      key={`${score.home}-${score.away}`}
                      style={{
                        borderRadius: 999,
                        padding: "9px 12px",
                        background: "#111c28",
                        border: "1px solid #1d3146",
                        color: "#eff8ff",
                        fontWeight: 800,
                      }}
                    >
                      {game.awayTeam.abbr} {score.away} - {score.home} {game.homeTeam.abbr}
                      <span style={{ color: "#7cc7ff", fontFamily: "'DM Mono',monospace", fontSize: 11, marginLeft: 8 }}>
                        {percent(score.probability)}
                      </span>
                    </div>
                  ))}
                </div>
                <Link
                  href="/predictions"
                  style={{ color: "#7cc7ff", fontSize: 12, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", textDecoration: "none" }}
                >
                  Back to full slate
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="dual-grid">
          <div
            style={{
              border: "1px solid #17283b",
              borderRadius: 24,
              background: "#091017",
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div style={{ color: "#8db9dc", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Projected goalies
            </div>
            <div className="dual-grid">
              {[
                { team: game.awayTeam, color: awayColor, goalie: projectedAwayGoalie },
                { team: game.homeTeam, color: homeColor, goalie: projectedHomeGoalie },
              ].map((row) => (
                <div
                  key={`${row.team.abbr}-goalie`}
                  style={{
                    borderRadius: 20,
                    border: `1px solid ${hexToRgba(row.color, 0.28)}`,
                    background: hexToRgba(row.color, 0.1),
                    padding: "16px 18px",
                    display: "grid",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div style={{ color: row.color, fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {row.team.abbr} {row.goalie.projectionLabel}
                    </div>
                    <div style={teamPillStyle(row.color)}>
                      {row.goalie.confidence} confidence
                    </div>
                  </div>
                  <div style={{ color: "#eff8ff", fontSize: 28, fontWeight: 900 }}>
                    {row.goalie.starterName}
                  </div>
                  <div className="dual-grid" style={{ gap: 10 }}>
                    {[
                      ["Save %", formatGoalieValue(row.goalie.savePct, 3)],
                      ["GSAx", formatGoalieValue(row.goalie.gsax, 2)],
                    ].map(([label, value]) => (
                      <div key={`${row.team.abbr}-${label}`} style={{ borderRadius: 14, background: "#111c28", border: "1px solid #1c3044", padding: "10px 12px" }}>
                        <div style={{ color: "#738da5", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                          {label}
                        </div>
                        <div style={{ color: "#eaf6ff", fontSize: 20, fontWeight: 900, marginTop: 6 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {row.goalie.notes?.length ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      {row.goalie.notes.map((note) => (
                        <div key={`${row.team.abbr}-${note}`} style={{ color: "#8ea9c2", fontSize: 13 }}>
                          {note}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              border: "1px solid #17283b",
              borderRadius: 24,
              background: "#091017",
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div style={{ color: "#8db9dc", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Market odds comparison
            </div>
            {market ? (
              <>
                <div style={{ color: "#9fb7cc", fontSize: 14, lineHeight: 1.5 }}>
                  Using <span style={{ color: "#eff8ff", fontWeight: 800 }}>{market.sourceLabel}</span> for the current consensus moneyline.
                </div>
                <div className="dual-grid">
                  {[
                    {
                      label: game.awayTeam.abbr,
                      color: awayColor,
                      marketOdds: market.awayMoneyline,
                      marketProb: market.awayProbability,
                      fairOdds: prediction.fairOdds.awayMoneyline,
                      modelProb: prediction.awayWinPct,
                      edge: market.awayEdge,
                    },
                    {
                      label: game.homeTeam.abbr,
                      color: homeColor,
                      marketOdds: market.homeMoneyline,
                      marketProb: market.homeProbability,
                      fairOdds: prediction.fairOdds.homeMoneyline,
                      modelProb: prediction.homeWinPct,
                      edge: market.homeEdge,
                    },
                  ].map((row) => (
                    <div
                      key={`${row.label}-market`}
                      style={{
                        borderRadius: 18,
                        border: `1px solid ${hexToRgba(row.color, 0.3)}`,
                        background: hexToRgba(row.color, 0.1),
                        padding: "16px 18px",
                        display: "grid",
                        gap: 12,
                      }}
                    >
                      <div style={{ color: row.color, fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {row.label} market vs model
                      </div>
                      <div className="dual-grid" style={{ gap: 10 }}>
                        {[
                          ["Market line", signedOdds(row.marketOdds)],
                          ["Fair line", signedOdds(row.fairOdds)],
                          ["Market win %", formatPct(row.marketProb)],
                          ["Model win %", formatPct(row.modelProb)],
                        ].map(([label, value]) => (
                          <div key={`${row.label}-${label}`} style={{ borderRadius: 14, background: "#111c28", border: "1px solid #1c3044", padding: "10px 12px" }}>
                            <div style={{ color: "#738da5", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                              {label}
                            </div>
                            <div style={{ color: "#eaf6ff", fontSize: 20, fontWeight: 900, marginTop: 6 }}>{value}</div>
                          </div>
                        ))}
                      </div>
                      <div
                        style={{
                          borderRadius: 14,
                          padding: "10px 12px",
                          background: row.edge >= 0 ? "rgba(53,227,160,0.14)" : "rgba(255,111,123,0.14)",
                          color: row.edge >= 0 ? "#35e3a0" : "#ff8d9b",
                          fontWeight: 800,
                        }}
                      >
                        Model edge {row.edge >= 0 ? "+" : ""}{(row.edge * 100).toFixed(1)} pts
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div
                style={{
                  borderRadius: 18,
                  border: "1px solid #1b2c3f",
                  background: "#0d1620",
                  padding: "16px 18px",
                  color: "#8ea8c1",
                  lineHeight: 1.5,
                }}
              >
                No live market odds are available yet. Add `THE_ODDS_API_KEY` or `ODDS_API_KEY` to enable consensus moneyline comparison on this page.
              </div>
            )}
          </div>
        </section>

        <section className="dual-grid">
          <div
            style={{
              border: "1px solid #17283b",
              borderRadius: 24,
              background: "#091017",
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div style={{ color: "#8db9dc", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Team context
            </div>
            {teamContextCards.map((row) => (
              <div key={row.team} style={{ borderRadius: 18, background: "#0d1620", border: "1px solid #182736", padding: "14px 16px", display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div style={teamPillStyle(row.color)}>{row.team}</div>
                  <div style={{ color: "#738da5", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {row.restValue}
                  </div>
                </div>
                <div className="dual-grid" style={{ gap: 10 }}>
                  {[
                    [row.splitLabel, `${row.splitRecord} · ${row.splitPct}`],
                    [row.recentLabel, row.recentValue],
                    ["Goalie proxy", row.goalieName],
                    ["Starter signal", `SV% ${row.goalieSv} · GSAx/G ${row.goalieGsax}`],
                  ].map(([label, value]) => (
                    <div key={`${row.team}-${label}`} style={{ borderRadius: 14, background: "#111c28", border: "1px solid #1c3044", padding: "10px 12px" }}>
                      <div style={{ color: "#738da5", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {label}
                      </div>
                      <div style={{ color: "#eaf6ff", fontSize: 16, fontWeight: 800, marginTop: 6 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              border: "1px solid #17283b",
              borderRadius: 24,
              background: "#091017",
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div style={{ color: "#8db9dc", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Team ratings matchup
            </div>
            {comparisonRows.map(([label, awayValue, homeValue]) =>
              compareRow(label, awayValue, homeValue, awayColor, homeColor)
            )}
          </div>
        </section>

        <section className="dual-grid">
          <div
            style={{
              border: `1px solid ${hexToRgba(awayColor, 0.34)}`,
              borderRadius: 24,
              background: "#091017",
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ color: awayColor, fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {game.awayTeam.abbr} player backbone
                </div>
                <div style={{ color: "#eff8ff", fontSize: 28, fontWeight: 900, marginTop: 4 }}>{game.awayTeam.name}</div>
              </div>
              <Link href={`/team/${game.awayTeam.abbr}`} style={{ ...teamPillStyle(awayColor), textDecoration: "none" }}>
                Team page
              </Link>
            </div>
            {renderLeaderList("Top skaters", awayLeaders.topSkaters, awayColor, "overall_rating")}
            {renderLeaderList("Offensive drivers", awayLeaders.topOffense, awayColor, "off_rating")}
            {renderLeaderList("Defensive drivers", awayLeaders.topDefense, awayColor, "def_rating")}
          </div>

          <div
            style={{
              border: `1px solid ${hexToRgba(homeColor, 0.34)}`,
              borderRadius: 24,
              background: "#091017",
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ color: homeColor, fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {game.homeTeam.abbr} player backbone
                </div>
                <div style={{ color: "#eff8ff", fontSize: 28, fontWeight: 900, marginTop: 4 }}>{game.homeTeam.name}</div>
              </div>
              <Link href={`/team/${game.homeTeam.abbr}`} style={{ ...teamPillStyle(homeColor), textDecoration: "none" }}>
                Team page
              </Link>
            </div>
            {renderLeaderList("Top skaters", homeLeaders.topSkaters, homeColor, "overall_rating")}
            {renderLeaderList("Offensive drivers", homeLeaders.topOffense, homeColor, "off_rating")}
            {renderLeaderList("Defensive drivers", homeLeaders.topDefense, homeColor, "def_rating")}
          </div>
        </section>
      </div>
    </div>
  );
}
