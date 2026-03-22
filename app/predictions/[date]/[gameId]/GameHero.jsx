import { logoUrl } from "@/app/lib/nhlTeams";

function chip(label, awayValue, homeValue) {
  return { label, awayValue, homeValue };
}

export default function GameHero({
  awayTeam,
  homeTeam,
  awayScore,
  homeScore,
  statusLabel,
  metaLabel,
  arenaLabel,
  awayColor,
  homeColor,
  statChips = [],
}) {
  const chips = statChips.filter((item) => item && (item.awayValue != null || item.homeValue != null));

  return (
    <section
      style={{
        border: "1px solid #16283a",
        borderRadius: 28,
        background: `linear-gradient(135deg, rgba(11,20,30,0.98) 0%, rgba(7,11,18,0.98) 35%, rgba(7,11,18,0.98) 65%, rgba(11,20,30,0.98) 100%)`,
        padding: "28px 28px 22px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.24)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl(awayTeam.abbr)}
        alt=""
        style={{
          position: "absolute",
          left: -18,
          top: "50%",
          transform: "translateY(-50%)",
          width: 240,
          height: 240,
          objectFit: "contain",
          opacity: 0.06,
          pointerEvents: "none",
        }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl(homeTeam.abbr)}
        alt=""
        style={{
          position: "absolute",
          right: -18,
          top: "50%",
          transform: "translateY(-50%)",
          width: 240,
          height: 240,
          objectFit: "contain",
          opacity: 0.06,
          pointerEvents: "none",
        }}
      />

      <div className="postgame-hero-grid" style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "grid", gap: 12, alignItems: "center", justifyItems: "start" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl(awayTeam.abbr)} alt={awayTeam.abbr} width={78} height={78} style={{ width: 78, height: 78, objectFit: "contain" }} />
          <div style={{ color: awayColor, fontSize: 12, fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>
            {awayTeam.abbr}
          </div>
          <div style={{ color: "#eff8ff", fontSize: 34, fontWeight: 900, lineHeight: 0.95 }}>{awayTeam.name}</div>
          <div style={{ color: awayColor, fontSize: 76, fontWeight: 900, lineHeight: 0.9 }}>{awayScore}</div>
        </div>

        <div style={{ display: "grid", gap: 10, justifyItems: "center", alignContent: "center", textAlign: "center" }}>
          <div
            style={{
              borderRadius: 999,
              border: "1px solid #21425f",
              background: "rgba(47,180,255,0.12)",
              color: "#9fd8ff",
              padding: "7px 12px",
              fontSize: 11,
              fontFamily: "'DM Mono',monospace",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {statusLabel}
          </div>
          <div style={{ color: "#eff8ff", fontSize: 19, fontWeight: 800 }}>{metaLabel}</div>
          {arenaLabel ? (
            <div style={{ color: "#7994ad", fontSize: 13, fontFamily: "'DM Mono',monospace" }}>{arenaLabel}</div>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: 12, alignItems: "center", justifyItems: "end", textAlign: "right" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl(homeTeam.abbr)} alt={homeTeam.abbr} width={78} height={78} style={{ width: 78, height: 78, objectFit: "contain" }} />
          <div style={{ color: homeColor, fontSize: 12, fontFamily: "'DM Mono',monospace", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>
            {homeTeam.abbr}
          </div>
          <div style={{ color: "#eff8ff", fontSize: 34, fontWeight: 900, lineHeight: 0.95 }}>{homeTeam.name}</div>
          <div style={{ color: homeColor, fontSize: 76, fontWeight: 900, lineHeight: 0.9 }}>{homeScore}</div>
        </div>
      </div>

      {chips.length > 0 ? (
        <div
          className="postgame-hero-chips"
          style={{
            position: "relative",
            zIndex: 1,
            marginTop: 22,
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(chips.length, 5)}, minmax(0, 1fr))`,
            gap: 10,
          }}
        >
          {chips.map((item) => (
            <div
              key={item.label}
              style={{
                borderRadius: 16,
                border: "1px solid #1a2c3f",
                background: "#0c1520",
                padding: "10px 12px",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ color: "#728aa1", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {item.label}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ color: awayColor, fontWeight: 800, fontSize: 16 }}>{item.awayValue ?? "—"}</div>
                <div style={{ color: "#49647f", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>vs</div>
                <div style={{ color: homeColor, fontWeight: 800, fontSize: 16 }}>{item.homeValue ?? "—"}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <style>{`
        .postgame-hero-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          gap: 18px;
          align-items: center;
        }
        @media (max-width: 860px) {
          .postgame-hero-grid {
            grid-template-columns: 1fr;
            justify-items: center;
            text-align: center;
          }
          .postgame-hero-grid > div:nth-child(1),
          .postgame-hero-grid > div:nth-child(3) {
            justify-items: center !important;
            text-align: center !important;
          }
          .postgame-hero-chips {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

export function buildHeroStatChips(statMap = {}) {
  const chips = [];
  if (statMap.sog) chips.push(chip("Shots", statMap.sog.away, statMap.sog.home));
  if (statMap.powerPlayConversions) chips.push(chip("Power Play", statMap.powerPlayConversions.away, statMap.powerPlayConversions.home));
  if (statMap.faceoffWinningPctg) {
    chips.push(
      chip(
        "Faceoff %",
        `${(((Number(statMap.faceoffWinningPctg.away) || 0) * 100)).toFixed(1)}%`,
        `${(((Number(statMap.faceoffWinningPctg.home) || 0) * 100)).toFixed(1)}%`
      )
    );
  }
  if (statMap.hits) chips.push(chip("Hits", statMap.hits.away, statMap.hits.home));
  if (statMap.blocked) chips.push(chip("Blocked", statMap.blocked.away, statMap.blocked.home));
  return chips;
}

