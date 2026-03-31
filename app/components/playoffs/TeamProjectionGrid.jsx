"use client";

import TeamProjectionCard from "@/app/components/playoffs/TeamProjectionCard";

export default function TeamProjectionGrid({ teams = [], teamFilter, onTeamFilterChange }) {
  const filtered = teams.filter((team) => !teamFilter || team.team === teamFilter);

  return (
    <section style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Team projections
          </div>
          <div style={{ fontSize: 30, color: "var(--text-primary)", fontWeight: 900, marginTop: 4 }}>
            Season outlook cards
          </div>
        </div>
        <select value={teamFilter} onChange={(event) => onTeamFilterChange(event.target.value)} style={{ borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--bg-card)", color: "var(--text-primary)", padding: "10px 12px", minWidth: 180 }}>
          <option value="">All teams</option>
          {teams.map((team) => (
            <option key={team.team} value={team.team}>{team.teamName}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        {filtered.map((team) => (
          <TeamProjectionCard key={team.team} team={team} />
        ))}
      </div>
    </section>
  );
}
