export default function PlayerLeaders({ leaders, awayColor, homeColor, awayAbbr, homeAbbr, compact = false }) {
  const data = leaders ?? { points: [], goals: [], toi: [], xg: [], goalieSummary: [] };
  const listCards = [
    {
      title: "Points leaders",
      rows: data.points.map((item) => ({
        key: `${item.teamAbbr}-${item.name}-points`,
        name: item.name,
        teamAbbr: item.teamAbbr,
        value: `${item.points} pts`,
        sub: `${item.goals}G · ${item.assists}A`,
      })),
    },
    {
      title: "Goal scorers",
      rows: data.goals.map((item) => ({
        key: `${item.teamAbbr}-${item.name}-goals`,
        name: item.name,
        teamAbbr: item.teamAbbr,
        value: `${item.goals} G`,
        sub: `${item.points} pts`,
      })),
    },
    {
      title: "TOI leaders",
      rows: data.toi.map((item) => ({
        key: `${item.teamAbbr}-${item.name}-toi`,
        name: item.name,
        teamAbbr: item.teamAbbr,
        value: item.toi,
        sub: item.position,
      })),
    },
    {
      title: "xG leaders",
      rows: data.xg.map((item) => ({
        key: `${item.teamAbbr}-${item.name}-xg`,
        name: item.name,
        teamAbbr: item.teamAbbr,
        value: item.xg.toFixed(2),
        sub: `${item.shots} shots`,
      })),
    },
  ];

  const teamColor = (teamAbbr) => (teamAbbr === awayAbbr ? awayColor : homeColor);

  return (
    <div
      style={{
        borderRadius: 24,
        border: "1px solid #16283a",
        background: "#0a121c",
        padding: compact ? "18px" : "22px",
        display: "grid",
        gap: 16,
      }}
    >
      <div>
        <div style={{ color: "#8eb9db", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Players
        </div>
        <div style={{ color: "var(--text-primary)", fontSize: compact ? 22 : 26, fontWeight: 900, marginTop: 4 }}>Player leaders</div>
      </div>

      <div className="player-leaders-grid">
        {listCards.map((card) => (
          <div key={card.title} style={{ borderRadius: 18, background: "#0d1620", border: "1px solid #182736", padding: "14px 16px", display: "grid", gap: 10 }}>
            <div style={{ color: "#8eb9db", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
              {card.title}
            </div>
            {card.rows.length ? card.rows.map((row) => (
              <div key={row.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "var(--text-primary)", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</div>
                  <div style={{ color: teamColor(row.teamAbbr), fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                    {row.teamAbbr} · {row.sub}
                  </div>
                </div>
                <div style={{ color: "#dff1ff", fontSize: 16, fontWeight: 900 }}>{row.value}</div>
              </div>
            )) : (
              <div style={{ color: "#6f879f", fontSize: 12, fontFamily: "'DM Mono',monospace" }}>No data available.</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ borderRadius: 18, background: "#0d1620", border: "1px solid #182736", padding: "14px 16px", display: "grid", gap: 10 }}>
        <div style={{ color: "#8eb9db", fontSize: 10, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
          Goalie summary
        </div>
        {data.goalieSummary.length ? (
          data.goalieSummary.map((goalie) => (
            <div key={`${goalie.teamAbbr}-${goalie.name}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <div style={{ color: "var(--text-primary)", fontWeight: 800 }}>{goalie.name}</div>
                <div style={{ color: teamColor(goalie.teamAbbr), fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                  {goalie.teamAbbr} · {goalie.toi}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#dff1ff", fontWeight: 900, fontSize: 16 }}>
                  {goalie.shotsAgainst > 0 && goalie.savePct != null
                    ? `.${Math.round(goalie.savePct * 1000).toString().padStart(3, "0")}`
                    : "—"}
                </div>
                <div style={{ color: "#86a0b8", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>
                  {goalie.saves}/{goalie.shotsAgainst} · GA {goalie.goalsAgainst}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div style={{ color: "#6f879f", fontSize: 12, fontFamily: "'DM Mono',monospace" }}>No goalie summary available.</div>
        )}
      </div>

      <style>{`
        .player-leaders-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 980px) {
          .player-leaders-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
