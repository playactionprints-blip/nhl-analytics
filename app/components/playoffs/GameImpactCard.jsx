"use client";

import { logoUrl } from "@/app/lib/nhlTeams";
import LeagueImpactMiniTable from "@/app/components/playoffs/LeagueImpactMiniTable";

function percent(value) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatPoints(value) {
  return value == null ? "—" : value.toFixed(1);
}

function outcomeTone(delta) {
  if (delta >= 0.015) return "#35e3a0";
  if (delta <= -0.015) return "#ff8d9b";
  return "#9fd8ff";
}

function TeamBranchTable({ team, outcomeRows }) {
  const rows = [
    { label: "If Win", data: outcomeRows.win },
    { label: "If Lose OT", data: outcomeRows.loseOt },
    { label: "If Lose Reg", data: outcomeRows.loseReg },
  ];

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl(team.abbr)} alt={team.abbr} width={24} height={24} style={{ width: 24, height: 24, objectFit: "contain" }} />
        <div>
          <div style={{ color: "var(--text-primary)", fontSize: 17, fontWeight: 800 }}>{team.name}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>
            {team.record ? `${team.record.wins}-${team.record.losses}-${team.record.otLosses}` : team.abbr}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: "grid",
              gridTemplateColumns: "92px 1fr 68px 70px",
              gap: 8,
              alignItems: "center",
              borderRadius: 12,
              background: "rgba(8,16,24,0.62)",
              border: "1px solid var(--border-strong)",
              padding: "10px 12px",
            }}
          >
            <div style={{ color: "var(--text-secondary)", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>{row.label}</div>
            <div style={{ color: outcomeTone(row.data.playoffDelta), fontSize: 14, fontWeight: 800 }}>
              {percent(row.data.playoffProbability)}
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: 11, textAlign: "right", fontFamily: "'DM Mono',monospace" }}>
              {formatPoints(row.data.projectedPoints)} pts
            </div>
            <div style={{ color: outcomeTone(row.data.playoffDelta), fontSize: 11, textAlign: "right", fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>
              {row.data.playoffDelta >= 0 ? "+" : ""}{(row.data.playoffDelta * 100).toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GameImpactCard({ gameImpact }) {
  const game = gameImpact.game;

  return (
    <article
      style={{
        borderRadius: 24,
        border: "1px solid var(--border-strong)",
        background: "var(--bg-card)",
        padding: 20,
        display: "grid",
        gap: 18,
      }}
    >
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ color: "var(--text-primary)", fontSize: 24, fontWeight: 900 }}>
            {game.awayTeam.abbr} @ {game.homeTeam.abbr}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Pregame win probs · {percent(gameImpact.currentWinProbabilities.away)} / {percent(gameImpact.currentWinProbabilities.home)}
          </div>
        </div>
        <div style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          Conditional playoff odds if this game swings one way or the other.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
        }}
      >
        <TeamBranchTable team={game.awayTeam} outcomeRows={gameImpact.outcomes.away} />
        <TeamBranchTable team={game.homeTeam} outcomeRows={gameImpact.outcomes.home} />
      </div>

      <LeagueImpactMiniTable rows={gameImpact.leagueImpacts} />
    </article>
  );
}
