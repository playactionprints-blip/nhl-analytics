import { hexToRgba } from "./postgameAnalytics";

function buildStatMap(teamGameStats = []) {
  return Object.fromEntries((teamGameStats || []).map((row) => [row.category, { away: row.awayValue, home: row.homeValue }]));
}

function parsePowerPlay(rawValue) {
  const parts = String(rawValue || "").split("/");
  if (parts.length !== 2) return { pct: 0, label: rawValue ?? "—" };
  const goals = Number(parts[0]) || 0;
  const chances = Number(parts[1]) || 0;
  const pct = chances > 0 ? (goals / chances) * 100 : 0;
  return { pct, label: rawValue ?? "—" };
}

function mirroredRow({ label, awayValue, homeValue, awayDisplay, homeDisplay, awayColor, homeColor, maxValue = null, isPct = false }) {
  const scaleMax = maxValue ?? Math.max(awayValue, homeValue, 1);
  const awayWidth = Math.max((awayValue / scaleMax) * 100, awayValue > 0 ? 6 : 0);
  const homeWidth = Math.max((homeValue / scaleMax) * 100, homeValue > 0 ? 6 : 0);

  return (
    <div
      key={label}
      style={{
        display: "grid",
        gridTemplateColumns: "64px minmax(0, 1fr) 116px minmax(0, 1fr) 64px",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div style={{ color: awayColor, fontSize: 18, fontWeight: 900 }}>{awayDisplay}</div>
      <div style={{ height: 10, borderRadius: 999, background: "#132130", overflow: "hidden" }}>
        <div style={{ width: `${awayWidth}%`, height: "100%", background: `linear-gradient(90deg, ${hexToRgba(awayColor, 0.34)} 0%, ${awayColor} 100%)` }} />
      </div>
      <div style={{ color: "#7189a1", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "center" }}>
        {label}
      </div>
      <div style={{ height: 10, borderRadius: 999, background: "#132130", overflow: "hidden" }}>
        <div style={{ marginLeft: "auto", width: `${homeWidth}%`, height: "100%", background: `linear-gradient(90deg, ${hexToRgba(homeColor, 0.34)} 0%, ${homeColor} 100%)` }} />
      </div>
      <div style={{ color: homeColor, fontSize: 18, fontWeight: 900, textAlign: "right" }}>{homeDisplay}</div>
    </div>
  );
}

export default function TeamComparison({
  teamGameStats = [],
  analytics = null,
  playerByGameStats = null,
  awayAbbr,
  homeAbbr,
  awayColor,
  homeColor,
  title = "Team stats comparison",
  compact = false,
}) {
  const statMap = buildStatMap(teamGameStats);
  const powerPlay = statMap.powerPlayConversions
    ? {
        away: parsePowerPlay(statMap.powerPlayConversions.away),
        home: parsePowerPlay(statMap.powerPlayConversions.home),
      }
    : null;
  const faceoffAway = (Number(statMap.faceoffWinningPctg?.away) || 0) * 100;
  const faceoffHome = (Number(statMap.faceoffWinningPctg?.home) || 0) * 100;
  const awayGoalie = [...(playerByGameStats?.awayTeam?.goalies || [])].sort((a, b) => {
    const [am, as] = String(a.toi || "0:00").split(":").map(Number);
    const [bm, bs] = String(b.toi || "0:00").split(":").map(Number);
    return ((bm || 0) * 60 + (bs || 0)) - ((am || 0) * 60 + (as || 0));
  })[0];
  const homeGoalie = [...(playerByGameStats?.homeTeam?.goalies || [])].sort((a, b) => {
    const [am, as] = String(a.toi || "0:00").split(":").map(Number);
    const [bm, bs] = String(b.toi || "0:00").split(":").map(Number);
    return ((bm || 0) * 60 + (bs || 0)) - ((am || 0) * 60 + (as || 0));
  })[0];
  const awaySavePct = awayGoalie?.savePctg != null
    ? Number(awayGoalie.savePctg) * 100
    : (awayGoalie?.shotsAgainst ? ((Number(awayGoalie.saves) || 0) / Number(awayGoalie.shotsAgainst)) * 100 : 0);
  const homeSavePct = homeGoalie?.savePctg != null
    ? Number(homeGoalie.savePctg) * 100
    : (homeGoalie?.shotsAgainst ? ((Number(homeGoalie.saves) || 0) / Number(homeGoalie.shotsAgainst)) * 100 : 0);
  const rows = [
    statMap.sog
      ? {
          label: "Shots",
          awayValue: Number(statMap.sog.away) || 0,
          homeValue: Number(statMap.sog.home) || 0,
          awayDisplay: statMap.sog.away ?? "—",
          homeDisplay: statMap.sog.home ?? "—",
        }
      : null,
    analytics
      ? {
          label: "Expected Goals",
          awayValue: analytics.totalAwayXG ?? 0,
          homeValue: analytics.totalHomeXG ?? 0,
          awayDisplay: (analytics.totalAwayXG ?? 0).toFixed(2),
          homeDisplay: (analytics.totalHomeXG ?? 0).toFixed(2),
        }
      : null,
    powerPlay
      ? {
          label: "Power Play",
          awayValue: powerPlay.away.pct,
          homeValue: powerPlay.home.pct,
          awayDisplay: powerPlay.away.label,
          homeDisplay: powerPlay.home.label,
          maxValue: 100,
        }
      : null,
    statMap.faceoffWinningPctg
      ? {
          label: "Faceoff %",
          awayValue: faceoffAway,
          homeValue: faceoffHome,
          awayDisplay: `${faceoffAway.toFixed(1)}%`,
          homeDisplay: `${faceoffHome.toFixed(1)}%`,
          maxValue: 100,
        }
      : null,
    (awayGoalie || homeGoalie)
      ? {
          label: "Save %",
          awayValue: awaySavePct,
          homeValue: homeSavePct,
          awayDisplay: awayGoalie ? `${awaySavePct.toFixed(1)}%` : "—",
          homeDisplay: homeGoalie ? `${homeSavePct.toFixed(1)}%` : "—",
          maxValue: 100,
        }
      : null,
    analytics
      ? {
          label: "High Danger",
          awayValue: analytics.highDanger?.away ?? 0,
          homeValue: analytics.highDanger?.home ?? 0,
          awayDisplay: analytics.highDanger?.away ?? 0,
          homeDisplay: analytics.highDanger?.home ?? 0,
        }
      : null,
    statMap.hit || statMap.hits
      ? {
          label: "Hits",
          awayValue: Number((statMap.hit || statMap.hits).away) || 0,
          homeValue: Number((statMap.hit || statMap.hits).home) || 0,
          awayDisplay: (statMap.hit || statMap.hits).away ?? "—",
          homeDisplay: (statMap.hit || statMap.hits).home ?? "—",
        }
      : null,
    statMap.blockedShots || statMap.blocked
      ? {
          label: "Blocks",
          awayValue: Number((statMap.blockedShots || statMap.blocked).away) || 0,
          homeValue: Number((statMap.blockedShots || statMap.blocked).home) || 0,
          awayDisplay: (statMap.blockedShots || statMap.blocked).away ?? "—",
          homeDisplay: (statMap.blockedShots || statMap.blocked).home ?? "—",
        }
      : null,
  ].filter(Boolean);

  return (
    <div
      style={{
        borderRadius: 24,
        border: "1px solid #16283a",
        background: "#0a121c",
        padding: compact ? "18px 18px" : "22px 22px",
        display: "grid",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Team Stats
          </div>
          <div style={{ color: "#eff8ff", fontSize: compact ? 22 : 26, fontWeight: 900, marginTop: 4 }}>{title}</div>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[{ label: awayAbbr, color: awayColor }, { label: homeAbbr, color: homeColor }].map((item) => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color }} />
              <span style={{ color: "#9db7cd", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {rows.length > 0 ? (
        <div style={{ display: "grid", gap: 14 }}>
          {rows.map((row) =>
            mirroredRow({
              ...row,
              awayColor,
              homeColor,
            })
          )}
        </div>
      ) : (
        <div style={{ color: "#6f879f", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>
          Team stat comparison unavailable for this game.
        </div>
      )}
    </div>
  );
}
