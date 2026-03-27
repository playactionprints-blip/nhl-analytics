import Link from "next/link";
import { logoUrl } from "@/app/lib/nhlTeams";

function cardStyle(accent) {
  return {
    borderRadius: 24,
    border: `1px solid ${accent ? `${accent}44` : "#1d3146"}`,
    background: "linear-gradient(180deg, rgba(13,20,30,0.98) 0%, rgba(9,14,22,0.98) 100%)",
    padding: 18,
    display: "grid",
    gap: 14,
    minHeight: 214,
    boxShadow: "0 18px 42px rgba(0,0,0,0.22)",
  };
}

function StatPill({ label, value, color = "#d8f2ff" }) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid #203447",
        background: "rgba(12,19,29,0.9)",
        padding: "10px 12px",
        display: "grid",
        gap: 5,
      }}
    >
      <div
        style={{
          color: "#7f9ab1",
          fontSize: 10,
          fontFamily: "'DM Mono',monospace",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div style={{ color, fontSize: 18, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

export default function DailyInsights({ dateLabel, cards = [] }) {
  const hasCards = cards.length > 0;

  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ color: "#86a9c6", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Daily insights
          </div>
          <h2 style={{ margin: 0, color: "var(--text-primary)", fontSize: 34, lineHeight: 1, fontWeight: 900 }}>
            What matters today
          </h2>
        </div>
        <div style={{ color: "#7f97ad", fontSize: 13 }}>
          {dateLabel}
        </div>
      </div>

      {hasCards ? (
        <div className="home-insights-grid">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              style={{ textDecoration: "none" }}
            >
              <article style={cardStyle(card.accent)}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ color: "#89a5be", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {card.kicker}
                    </div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <img src={logoUrl(card.awayTeam)} alt={card.awayTeam} style={{ width: 26, height: 26, objectFit: "contain" }} />
                      <div style={{ color: "#f1f8ff", fontSize: 22, fontWeight: 900 }}>
                        {card.awayTeam}
                      </div>
                      <div style={{ color: "#63809a", fontSize: 14 }}>at</div>
                      <div style={{ color: "#f1f8ff", fontSize: 22, fontWeight: 900 }}>
                        {card.homeTeam}
                      </div>
                      <img src={logoUrl(card.homeTeam)} alt={card.homeTeam} style={{ width: 26, height: 26, objectFit: "contain" }} />
                    </div>
                  </div>
                  <div
                    style={{
                      borderRadius: 999,
                      border: "1px solid #24435f",
                      background: "rgba(17,28,42,0.95)",
                      color: "#d2ebfb",
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {card.time}
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 20,
                    border: "1px solid #1b3145",
                    background: "rgba(10,16,24,0.86)",
                    padding: 14,
                    display: "grid",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ color: "#7baad2", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        Model favorite
                      </div>
                      <div style={{ color: "var(--text-primary)", fontSize: 20, fontWeight: 900 }}>{card.favorite}</div>
                    </div>
                    <div style={{ color: card.accent || "#2fb4ff", fontSize: 32, fontWeight: 900 }}>
                      {card.favoriteWinPct}
                    </div>
                  </div>

                  <div className="home-insight-stats">
                    <StatPill label="Lean" value={card.leanLabel} color="#dff6ff" />
                    <StatPill label="Edge" value={card.edgeLabel} color={card.edgePositive ? "#54e0a6" : "#9cc9ea"} />
                    <StatPill label="Entry" value="Game report" color="#8bd4ff" />
                  </div>
                </div>
              </article>
            </Link>
          ))}
        </div>
      ) : (
        <div
          style={{
            borderRadius: 26,
            border: "1px solid #193047",
            background: "linear-gradient(180deg, rgba(13,20,30,0.98) 0%, rgba(8,13,21,0.98) 100%)",
            padding: "22px 22px 20px",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ color: "#ecf8ff", fontSize: 22, fontWeight: 900 }}>Today&apos;s board is loading.</div>
          <div style={{ color: "#8ba7bf", lineHeight: 1.7, maxWidth: 880 }}>
            Prediction cards populate here whenever game and model data are available. When there is no active slate yet, this section stays ready for the next drop of edges, featured matchups, and direct links into game reports.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {["Model edges", "Pregame forecasts", "Postgame reports"].map((label) => (
              <div
                key={label}
                style={{
                  borderRadius: 999,
                  border: "1px solid #23384f",
                  background: "#0d1622",
                  color: "#9ec2dd",
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .home-insights-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 16px;
        }
        .home-insight-stats {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        @media (max-width: 1180px) {
          .home-insights-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 760px) {
          .home-insights-grid,
          .home-insight-stats {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
