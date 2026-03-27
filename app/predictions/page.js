import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { BreadcrumbSetter } from "@/Breadcrumbs";
import { TEAM_COLOR, logoUrl } from "@/app/lib/nhlTeams";
import {
  buildPredictionsForDate,
  confidenceMeta,
  fetchPredictionAccuracy,
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
  updatePredictionResults,
} from "@/app/lib/predictionsData";

export const revalidate = 3600; // future dates; past dates opt out below; today gets ~3600

export const metadata = {
  title: "NHL Predictions — NHL Analytics",
  description: "Tonight's NHL game predictions with win odds, expected goals, and score distributions.",
};

const DEFAULT_CONFIDENCE_TOOLTIP =
  "Confidence is based on available team data quality, recency of goaltender info, and home/away sample size. LOW = less reliable inputs.";

const SECTION_STYLE = { border: "1px solid var(--border-strong)", borderRadius: 24, background: "var(--bg-card)", padding: 20, display: "grid", gap: 14 };

function ModelAccuracySection({ accuracy }) {
  if (!accuracy) {
    return (
      <section style={SECTION_STYLE}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Model accuracy
          </div>
          <div style={{ fontSize: 22, color: "var(--text-primary)", fontWeight: 900, marginTop: 4 }}>
            Historical performance
          </div>
        </div>
        <div style={{ borderRadius: 16, background: "var(--bg-card)", border: "1px solid var(--border-strong)", padding: "16px 18px", color: "#7f9ab5", fontSize: 14, lineHeight: 1.5 }}>
          Accuracy tracking started today — check back after tonight&apos;s games complete.
        </div>
      </section>
    );
  }
  const { overall, byConfidence, rolling7, last10, units } = accuracy;
  const pctLabel = (v) => (v != null ? `${Math.round(v * 100)}%` : "—");
  const bandColors = { high: "#35e3a0", medium: "#f0c040", low: "#ff8d9b" };
  return (
    <section style={SECTION_STYLE}>
      <div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Model accuracy
        </div>
        <div style={{ fontSize: 22, color: "var(--text-primary)", fontWeight: 900, marginTop: 4 }}>
          Historical performance
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        {[
          ["Overall", pctLabel(overall?.pct), `${overall?.correct ?? 0}/${overall?.total ?? 0} games`],
          ["Last 7 days", pctLabel(rolling7?.pct), `${rolling7?.correct ?? 0}/${rolling7?.total ?? 0} games`],
        ].map(([label, value, sub]) => (
          <div key={label} style={{ borderRadius: 16, background: "var(--bg-card)", border: "1px solid var(--border-strong)", padding: "12px 14px" }}>
            <div style={{ color: "#6f879f", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
            <div style={{ color: "var(--text-primary)", fontSize: 26, fontWeight: 900, marginTop: 4 }}>{value}</div>
            <div style={{ color: "#567894", fontSize: 11, marginTop: 2 }}>{sub}</div>
          </div>
        ))}
        {["high", "medium", "low"].map((band) => {
          const s = byConfidence?.[band] || { correct: 0, total: 0, pct: null };
          return (
            <div key={band} style={{ borderRadius: 16, background: "var(--bg-card)", border: "1px solid var(--border-strong)", padding: "12px 14px" }}>
              <div style={{ color: bandColors[band], fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{band} conf.</div>
              <div style={{ color: "var(--text-primary)", fontSize: 26, fontWeight: 900, marginTop: 4 }}>{pctLabel(s.pct)}</div>
              <div style={{ color: "#567894", fontSize: 11, marginTop: 2 }}>{s.correct}/{s.total} games</div>
            </div>
          );
        })}
      </div>
      {units?.bets > 0 && (
        <div style={{ borderRadius: 16, background: "var(--bg-card)", border: "1px solid var(--border-strong)", padding: "16px 18px" }}>
          <div style={{ color: "#6f879f", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
            Unit tracker · 1u flat per predicted game at book odds
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ color: "#567894", fontSize: 11 }}>P&amp;L</div>
              <div style={{ color: units.total >= 0 ? "#35e3a0" : "#ff8d9b", fontSize: 26, fontWeight: 900, marginTop: 2 }}>
                {units.total >= 0 ? "+" : ""}{units.total.toFixed(2)}u
              </div>
              <div style={{ color: "#567894", fontSize: 11, marginTop: 2 }}>{units.bets} tracked bets</div>
            </div>
            <div>
              <div style={{ color: "#567894", fontSize: 11 }}>ROI</div>
              <div style={{ color: (units.roi ?? 0) >= 0 ? "#35e3a0" : "#ff8d9b", fontSize: 26, fontWeight: 900, marginTop: 2 }}>
                {units.roi != null ? `${units.roi >= 0 ? "+" : ""}${units.roi.toFixed(1)}%` : "—"}
              </div>
              <div style={{ color: "#567894", fontSize: 11, marginTop: 2 }}>per unit risked</div>
            </div>
          </div>
        </div>
      )}
      {last10?.length > 0 && (
        <div style={{ borderRadius: 16, background: "var(--bg-card)", border: "1px solid var(--border-strong)", padding: "12px 14px" }}>
          <div style={{ color: "#6f879f", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Last 10 tracked games</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {last10.map((row) => (
              <div
                key={`${row.game_date}-${row.game_id}`}
                style={{
                  borderRadius: 999,
                  padding: "5px 10px",
                  background: row.correct ? "rgba(53,227,160,0.12)" : "rgba(255,111,123,0.12)",
                  border: `1px solid ${row.correct ? "rgba(53,227,160,0.3)" : "rgba(255,111,123,0.3)"}`,
                  color: row.correct ? "#35e3a0" : "#ff8d9b",
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: "'DM Mono',monospace",
                }}
              >
                {row.away_team} @ {row.home_team}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

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

function ConfidenceHelpIcon({ tooltip }) {
  const tip = tooltip || DEFAULT_CONFIDENCE_TOOLTIP;
  return (
    <span
      title={tip}
      aria-label={tip}
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
  // Past dates: always fetch fresh — games are final and results should never be stale.
  // Future/today: fall through to the module-level ISR revalidate (3600s).
  if (selectedDateString < todayString) {
    noStore();
  }

  const selectedDateParts = parseDateString(selectedDateString);
  const previousDate = formatDateString(shiftDateParts(selectedDateParts, -1));
  const nextDate = formatDateString(shiftDateParts(selectedDateParts, 1));
  const yesterdayDateString = formatDateString(shiftDateParts(today, -1));
  const quickDates = [
    { dateString: yesterdayDateString, label: "Yesterday", active: yesterdayDateString === selectedDateString },
    ...Array.from({ length: 7 }, (_, index) => {
      const dateString = formatDateString(shiftDateParts(today, index));
      return {
        dateString,
        label: formatQuickDateLabel(dateString, todayString),
        active: dateString === selectedDateString,
      };
    }),
  ];
  const [{ predictions }, accuracy] = await Promise.all([
    buildPredictionsForDate(selectedDateString),
    fetchPredictionAccuracy(),
  ]);
  updatePredictionResults(yesterdayDateString).catch(() => null);
  console.log("[PredictionsPage] accuracy data:", accuracy ? `${accuracy.overall?.total} games tracked` : "null — table may not exist or no completed games yet");

  return (
    <div
      className="predictions-page-shell"
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #0d2136 0%, var(--bg-primary) 58%, var(--bg-primary) 100%)",
        padding: "36px 20px 64px",
      }}
    >
      <BreadcrumbSetter items={[{ href: "/predictions", label: "Predictions" }]} />
      <style>{`
        .predictions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(620px, 1fr));
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
        @media (max-width: 860px) {
          .predictions-page-shell {
            padding: 20px 14px 40px !important;
          }
          .predictions-hero-content {
            padding: 22px 16px 18px !important;
          }
          .predictions-hero-headline {
            font-size: 34px !important;
          }
          .predictions-date-controls {
            padding: 14px !important;
          }
        }
        @media (max-width: 640px) {
          .predictions-grid {
            gap: 14px !important;
          }
          .predictions-date-controls {
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .predictions-date-controls > div,
          .predictions-date-controls form {
            width: 100%;
          }
          .predictions-hero-headline {
            font-size: 28px !important;
          }
          .predictions-hero-copy {
            font-size: 15px !important;
          }
          .predictions-date-controls,
          .predictions-quick-jump {
            gap: 8px !important;
          }
          .slate-scroll {
            grid-auto-columns: minmax(216px, 1fr);
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
          <div className="predictions-hero-content" style={{ padding: "28px 28px 24px", display: "grid", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start", flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 11, color: "#4d82af", fontFamily: "'DM Mono',monospace", letterSpacing: "0.16em", textTransform: "uppercase" }}>
                  NHL Analytics · Game Model
                </div>
                <h1 className="predictions-hero-headline" style={{ margin: 0, color: "var(--text-primary)", fontSize: 46, lineHeight: 0.95, letterSpacing: "-0.04em", fontWeight: 900 }}>
                  {formatHeadlineDate(selectedDateString)} Predictions
                </h1>
                <p className="predictions-hero-copy" style={{ margin: 0, maxWidth: 860, color: "#86a5c0", fontSize: 18, lineHeight: 1.35 }}>
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
              className="predictions-date-controls"
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
                    border: "1px solid var(--border-strong)",
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
                      border: "1px solid var(--border-strong)",
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
                    border: "1px solid var(--border-strong)",
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
                Viewing <span style={{ color: "var(--text-primary)", fontWeight: 800 }}>{formatHeadlineDate(selectedDateString)}</span>
              </div>
            </div>

            <div
              className="predictions-quick-jump"
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
                    border: quickDate.active ? "1px solid #2fb4ff" : "1px solid var(--border-strong)",
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
              border: "1px solid var(--border-strong)",
              borderRadius: 24,
              background: "var(--bg-card)",
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
                border: "1px solid var(--border-strong)",
                borderRadius: 24,
                background: "var(--bg-card)",
                padding: 18,
                display: "grid",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    Slate overview
                  </div>
                  <div style={{ fontSize: 26, color: "var(--text-primary)", fontWeight: 900, marginTop: 4 }}>
                    Tonight&apos;s edge board
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#6f879f", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Win odds · xG · score distribution
                </div>
              </div>

              <div className="slate-scroll">
                {predictions.map(({ game, prediction, isCompleted, homeScore, awayScore }) => {
                  const homeColor = TEAM_COLOR[game.homeTeam.abbr] || "#1f5b85";
                  const awayColor = TEAM_COLOR[game.awayTeam.abbr] || "#1f5b85";
                  const cardStyle = {
                    textDecoration: "none",
                    borderRadius: 18,
                    border: "1px solid #1a2d40",
                    background: `linear-gradient(135deg, ${hexToRgba(awayColor, 0.18)} 0%, rgba(9,16,23,0.96) 36%, rgba(9,16,23,0.96) 64%, ${hexToRgba(homeColor, 0.18)} 100%)`,
                    padding: 14,
                    display: "grid",
                    gap: 10,
                    transition: "transform 0.16s ease, border-color 0.16s ease",
                  };

                  if (isCompleted || !prediction) {
                    const homeWon = homeScore != null && awayScore != null && homeScore > awayScore;
                    return (
                      <Link key={`overview-${game.id}`} href={predictionHref(selectedDateString, game.id)} style={cardStyle}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                          <div style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 999, background: "rgba(255,255,255,0.05)", border: "1px solid #2a3d50", color: "#6d8a9f", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                            Final
                          </div>
                          <div style={{ color: "#4a6a88", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>
                            {formatStartTime(game.startTimeUTC)}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={logoUrl(game.awayTeam.abbr)} alt={game.awayTeam.abbr} width={28} height={28} style={{ width: 28, height: 28, objectFit: "contain" }} />
                          <div style={{ fontSize: 28, fontWeight: 900, color: homeWon ? "#4a6a88" : "var(--text-primary)" }}>{awayScore ?? "—"}</div>
                          <div style={{ color: "#2e4a65", fontSize: 18, fontFamily: "'DM Mono',monospace" }}>–</div>
                          <div style={{ fontSize: 28, fontWeight: 900, color: !homeWon ? "#4a6a88" : "var(--text-primary)" }}>{homeScore ?? "—"}</div>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={logoUrl(game.homeTeam.abbr)} alt={game.homeTeam.abbr} width={28} height={28} style={{ width: 28, height: 28, objectFit: "contain" }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <div style={{ color: homeWon ? "#4a6a88" : awayColor, fontSize: 11, fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{game.awayTeam.abbr}</div>
                          <div style={{ color: !homeWon ? "#4a6a88" : homeColor, fontSize: 11, fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{game.homeTeam.abbr}</div>
                        </div>
                      </Link>
                    );
                  }

                  const favoriteIsHome = prediction.homeWinPct >= prediction.awayWinPct;
                  return (
                    <Link key={`overview-${game.id}`} href={predictionHref(selectedDateString, game.id)} style={cardStyle}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <div style={{ color: "#7bcfff", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                          {formatStartTime(game.startTimeUTC)}
                        </div>
                        <div style={{ color: "#617b96", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>
                          {favoriteIsHome ? "home edge" : "away edge"}
                        </div>
                      </div>
                      {[
                        { abbr: game.awayTeam.abbr, pct: prediction.awayWinPct },
                        { abbr: game.homeTeam.abbr, pct: prediction.homeWinPct },
                      ].map((row) => (
                        <div key={`${game.id}-${row.abbr}`} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto", gap: 10, alignItems: "center" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={logoUrl(row.abbr)} alt={row.abbr} width={28} height={28} style={{ width: 28, height: 28, objectFit: "contain" }} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: "#e9f6ff", fontSize: 16, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {row.abbr}
                            </div>
                          </div>
                          <div style={{ padding: "5px 8px", borderRadius: 10, background: row.pct >= 0.5 ? "rgba(83, 177, 255, 0.2)" : "rgba(255, 111, 123, 0.18)", color: row.pct >= 0.5 ? "#9dd8ff" : "#ff9aa4", fontWeight: 900, fontSize: 18, lineHeight: 1 }}>
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
            {predictions.map(({ game, prediction, homeTeam, awayTeam, projectedHomeGoalie, projectedAwayGoalie, homeKeyPlayers, awayKeyPlayers, isCompleted, homeScore, awayScore }) => {
              const homeColor = TEAM_COLOR[game.homeTeam.abbr] || "#1f5b85";
              const awayColor = TEAM_COLOR[game.awayTeam.abbr] || "#1f5b85";

              // ── Completed game card ──────────────────────────────────────────
              if (isCompleted || !prediction) {
                const homeWon = homeScore != null && awayScore != null && homeScore > awayScore;
                return (
                  <Link
                    key={game.id}
                    className="prediction-card"
                    href={predictionHref(selectedDateString, game.id)}
                    style={{ display: "block", textDecoration: "none", border: "1px solid var(--border-strong)", borderRadius: 24, background: "var(--bg-card)", transition: "transform 0.18s ease, box-shadow 0.18s ease" }}
                  >
                    <div style={{ padding: 18, borderBottom: "1px solid #132131", background: `linear-gradient(135deg, ${hexToRgba(awayColor, 0.22)} 0%, rgba(9,16,23,0.94) 38%, rgba(9,16,23,0.94) 62%, ${hexToRgba(homeColor, 0.22)} 100%)` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 20 }}>
                        <div style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 999, background: "var(--border-color)", border: "1px solid #2a3d50", color: "#8db9dc", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>
                          Final
                        </div>
                        <div style={{ fontSize: 11, color: "#4a6a88", fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em" }}>
                          {formatStartTime(game.startTimeUTC)}
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={logoUrl(game.awayTeam.abbr)} alt={game.awayTeam.abbr} width={48} height={48} style={{ width: 48, height: 48, objectFit: "contain" }} />
                          <div>
                            <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 800 }}>{game.awayTeam.abbr}</div>
                            <div style={{ color: homeWon ? "#4a6a88" : "var(--text-primary)", fontSize: 42, fontWeight: 900, lineHeight: 1 }}>{awayScore ?? "—"}</div>
                          </div>
                        </div>
                        <div style={{ color: "#2e4a65", fontSize: 24, fontFamily: "'DM Mono',monospace" }}>—</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexDirection: "row-reverse" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={logoUrl(game.homeTeam.abbr)} alt={game.homeTeam.abbr} width={48} height={48} style={{ width: 48, height: 48, objectFit: "contain" }} />
                          <div style={{ textAlign: "right" }}>
                            <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 800 }}>{game.homeTeam.abbr}</div>
                            <div style={{ color: !homeWon ? "#4a6a88" : "var(--text-primary)", fontSize: 42, fontWeight: 900, lineHeight: 1 }}>{homeScore ?? "—"}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: "14px 18px" }}>
                      <div style={{ color: "#3a5a78", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em" }}>
                        View game stats →
                      </div>
                    </div>
                  </Link>
                );
              }

              // ── Active / upcoming prediction card ────────────────────────────
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
                    border: "1px solid var(--border-strong)",
                    borderRadius: 24,
                    background: "var(--bg-card)",
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
                        <div style={{ fontSize: 22, color: "var(--text-primary)", fontWeight: 900, marginTop: 4 }}>
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
                          <ConfidenceHelpIcon tooltip={prediction.modelDiagnostics.confidenceReason} />
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
                      {(() => {
                        const teamRows = [
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
                            goalieInfo: projectedAwayGoalie,
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
                            goalieInfo: projectedHomeGoalie,
                          },
                        ];
                        const renderTeam = (teamRow) => (
                          <div
                            key={`${game.id}-${teamRow.side}`}
                            style={{
                              display: "grid",
                              gap: 12,
                              justifyItems: teamRow.align === "right" ? "end" : "start",
                              textAlign: teamRow.align,
                              minWidth: 0,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flexDirection: teamRow.align === "right" ? "row-reverse" : "row", minWidth: 0 }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={logoUrl(teamRow.abbr)}
                                alt={teamRow.abbr}
                                width={56}
                                height={56}
                                style={{ width: 56, height: 56, objectFit: "contain", flexShrink: 0 }}
                              />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ color: "var(--text-primary)", fontSize: 28, fontWeight: 900, lineHeight: 0.95 }}>{Math.round(teamRow.winPct * 100)}%</div>
                                <div style={{ color: teamRow.meta.color, fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {teamRow.side} win probability
                                </div>
                              </div>
                            </div>
                            <div style={{ minWidth: 0, overflow: "hidden" }}>
                              <div title={teamRow.name} style={{ color: "#ecf7ff", fontSize: teamRow.name.length > 14 ? 16 : 20, fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{teamRow.name}</div>
                              <div style={{ color: "#7f9ab5", fontSize: 11, fontFamily: "'DM Mono',monospace", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {teamRow.align === "right" ? "home" : "away"} split {teamRow.record}
                              </div>
                              {teamRow.goalieInfo?.starterName && (
                                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
                                  <div style={{ color: "#b0d4ef", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                                    {teamRow.goalieInfo.starterName}
                                  </div>
                                  {teamRow.goalieInfo.overallRating != null && (
                                    <div style={{ borderRadius: 7, background: "rgba(47,180,255,0.12)", border: "1px solid rgba(47,180,255,0.25)", color: "#7bcfff", fontSize: 11, fontWeight: 800, fontFamily: "'DM Mono',monospace", padding: "3px 7px", flexShrink: 0 }}>
                                      {Math.round(teamRow.goalieInfo.overallRating)} OVR
                                    </div>
                                  )}
                                  {teamRow.goalieInfo.gsaxPct != null && (
                                    <div style={{ borderRadius: 7, background: "rgba(0,229,160,0.1)", border: "1px solid rgba(0,229,160,0.25)", color: "#00e5a0", fontSize: 11, fontWeight: 800, fontFamily: "'DM Mono',monospace", padding: "3px 7px", flexShrink: 0 }}>
                                      {Math.round(teamRow.goalieInfo.gsaxPct)}th GSAx
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            <div style={{ width: "100%", maxWidth: 240, height: 10, borderRadius: 999, background: "var(--border-color)", overflow: "hidden" }}>
                              <div
                                style={{
                                  width: `${teamRow.winPct * 100}%`,
                                  height: "100%",
                                  background: `linear-gradient(90deg, ${hexToRgba(teamRow.align === "right" ? homeColor : awayColor, 0.7)} 0%, ${teamRow.align === "right" ? homeColor : awayColor} 100%)`,
                                }}
                              />
                            </div>
                          </div>
                        );
                        return (
                          <>
                            {renderTeam(teamRows[0])}
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
                              <div style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 900 }}>
                                xG {prediction.expectedAwayGoals.toFixed(2)} - {prediction.expectedHomeGoals.toFixed(2)}
                              </div>
                            </div>
                            {renderTeam(teamRows[1])}
                          </>
                        );
                      })()}
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
                            background: "var(--bg-card)",
                            border: "1px solid var(--border-strong)",
                            padding: "12px 14px",
                          }}
                        >
                          <div style={{ color: "#6f879f", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            {label}
                          </div>
                          <div style={{ color: "var(--text-primary)", fontSize: 20, fontWeight: 900, marginTop: 6 }}>{value}</div>
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        borderRadius: 18,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-strong)",
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
                              <div style={{ color: "var(--text-primary)", fontSize: 26, fontWeight: 900, marginTop: 4 }}>{row.xg.toFixed(2)}</div>
                            </div>
                            <div style={{ textAlign: "right" }}>
                              <div style={{ color: "#6f879f", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase" }}>Expected shots</div>
                              <div style={{ color: "var(--text-primary)", fontSize: 26, fontWeight: 900, marginTop: 4 }}>{row.shots.toFixed(1)}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div
                      style={{
                        borderRadius: 18,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-strong)",
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

                    {((awayKeyPlayers?.length > 0) || (homeKeyPlayers?.length > 0)) && (
                      <div
                        style={{
                          borderRadius: 18,
                          background: "var(--bg-card)",
                          border: "1px solid var(--border-strong)",
                          padding: "14px 16px",
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 12,
                        }}
                      >
                        {[
                          { abbr: game.awayTeam.abbr, color: awayColor, players: awayKeyPlayers },
                          { abbr: game.homeTeam.abbr, color: homeColor, players: homeKeyPlayers },
                        ].map((side) => (
                          <div key={`kp-${side.abbr}`}>
                            <div style={{ color: side.color, fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                              {side.abbr} key players
                            </div>
                            <div style={{ display: "grid", gap: 4 }}>
                              {(side.players || []).map((p) => (
                                <div key={p.name} style={{ display: "flex", justifyContent: "space-between", gap: 6, alignItems: "center" }}>
                                  <div style={{ color: "#cde6f8", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                                  <div style={{ color: "#56a0cf", fontSize: 10, fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>
                                    {p.war != null ? `${p.war > 0 ? "+" : ""}${p.war} WAR` : "—"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
            </div>
          </>
        )}

        <ModelAccuracySection accuracy={accuracy} />
      </div>
    </div>
  );
}
