"use client";

function percent(value) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function summarizeScenarios(gameImpacts = [], teamCode) {
  const scenarios = [];
  for (const item of gameImpacts) {
    const away = item.game.awayTeam.abbr;
    const home = item.game.homeTeam.abbr;

    if (away === teamCode) {
      scenarios.push(
        { gameId: item.gameId, label: `${away} win ${home}`, impact: item.branches.away_reg.away.playoffDelta, projected: item.branches.away_reg.away.playoffProbability },
        { gameId: item.gameId, label: `${away} lose OT`, impact: item.branches.home_ot.away.playoffDelta, projected: item.branches.home_ot.away.playoffProbability },
        { gameId: item.gameId, label: `${away} lose reg`, impact: item.branches.home_reg.away.playoffDelta, projected: item.branches.home_reg.away.playoffProbability },
      );
      continue;
    }

    if (home === teamCode) {
      scenarios.push(
        { gameId: item.gameId, label: `${home} win ${away}`, impact: item.branches.home_reg.home.playoffDelta, projected: item.branches.home_reg.home.playoffProbability },
        { gameId: item.gameId, label: `${home} lose OT`, impact: item.branches.away_ot.home.playoffDelta, projected: item.branches.away_ot.home.playoffProbability },
        { gameId: item.gameId, label: `${home} lose reg`, impact: item.branches.away_reg.home.playoffDelta, projected: item.branches.away_reg.home.playoffProbability },
      );
      continue;
    }

    const helpful = item.leagueImpacts.find((row) => row.team === teamCode);
    if (helpful) {
      scenarios.push(
        {
          gameId: item.gameId,
          label: `${item.game.awayTeam.abbr} win`,
          impact: helpful.awayWinPlayoffProbability - helpful.homeWinPlayoffProbability,
          projected: helpful.awayWinPlayoffProbability,
        },
        {
          gameId: item.gameId,
          label: `${item.game.homeTeam.abbr} win`,
          impact: helpful.homeWinPlayoffProbability - helpful.awayWinPlayoffProbability,
          projected: helpful.homeWinPlayoffProbability,
        }
      );
    }
  }

  return {
    best: [...scenarios].sort((a, b) => b.impact - a.impact).slice(0, 4),
    worst: [...scenarios].sort((a, b) => a.impact - b.impact).slice(0, 4),
  };
}

export default function BestWorstCaseSection({ teamCode, onTeamChange, teams = [], gameImpacts = [] }) {
  const { best, worst } = summarizeScenarios(gameImpacts, teamCode);

  return (
    <section style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Best / worst case
          </div>
          <div style={{ fontSize: 28, color: "var(--text-primary)", fontWeight: 900, marginTop: 4 }}>
            Tonight’s most helpful and harmful swings
          </div>
        </div>
        <select value={teamCode} onChange={(event) => onTeamChange(event.target.value)} style={{ borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--bg-card)", color: "var(--text-primary)", padding: "10px 12px", minWidth: 180 }}>
          {teams.map((team) => (
            <option key={team.team} value={team.team}>{team.teamName}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {[
          { title: "Best-case branches", rows: best, color: "#35e3a0" },
          { title: "Worst-case branches", rows: worst, color: "#ff8d9b" },
        ].map((bucket) => (
          <div key={bucket.title} style={{ borderRadius: 20, border: "1px solid var(--border-strong)", background: "var(--bg-card)", padding: "16px 18px", display: "grid", gap: 10 }}>
            <div style={{ color: bucket.color, fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{bucket.title}</div>
            <div style={{ display: "grid", gap: 8 }}>
              {bucket.rows.map((row) => (
                <div key={`${bucket.title}-${row.gameId}-${row.label}`} style={{ borderRadius: 12, border: "1px solid var(--border-strong)", background: "rgba(8,16,24,0.58)", padding: "10px 12px", display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 700 }}>{row.label}</div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: bucket.color, fontSize: 12, fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>
                      {row.impact >= 0 ? "+" : ""}{(row.impact * 100).toFixed(1)} pts
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>{percent(row.projected)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
