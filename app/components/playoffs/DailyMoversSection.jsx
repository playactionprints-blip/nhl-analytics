"use client";

import { logoUrl } from "@/app/lib/nhlTeams";

function pct(value) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function delta(value) {
  if (value == null) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;
}

function MoverCard({ label, team, positive = true }) {
  if (!team) return null;
  return (
    <div style={{ borderRadius: 20, border: "1px solid var(--border-strong)", background: "var(--bg-card)", padding: "16px 18px", display: "grid", gap: 10 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl(team.team)} alt={team.team} width={30} height={30} style={{ width: 30, height: 30, objectFit: "contain" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 800 }}>{team.teamName}</div>
          <div style={{ color: positive ? "#35e3a0" : "#ff8d9b", fontSize: 14, fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>
            {delta(team.playoffDelta)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DailyMoversSection({ overview, conferenceFilter, sortKey, onConferenceChange, onSortChange }) {
  const teams = (overview?.teams || []).filter((team) => !conferenceFilter || team.conference === conferenceFilter);

  const sorted = [...teams].sort((a, b) => {
    if (sortKey === "projectedPoints") return b.projectedPoints - a.projectedPoints;
    if (sortKey === "delta") return b.playoffDelta - a.playoffDelta;
    if (sortKey === "cup") return b.cupProbability - a.cupProbability;
    return b.playoffProbability - a.playoffProbability;
  });

  return (
    <section style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Daily board
          </div>
          <div style={{ fontSize: 30, color: "var(--text-primary)", fontWeight: 900, marginTop: 4 }}>
            Movers, fallers, and league context
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select value={conferenceFilter} onChange={(event) => onConferenceChange(event.target.value)} style={{ borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--bg-card)", color: "var(--text-primary)", padding: "10px 12px" }}>
            <option value="">All conferences</option>
            <option value="Eastern">Eastern</option>
            <option value="Western">Western</option>
          </select>
          <select value={sortKey} onChange={(event) => onSortChange(event.target.value)} style={{ borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--bg-card)", color: "var(--text-primary)", padding: "10px 12px" }}>
            <option value="playoffProbability">Sort by playoff %</option>
            <option value="projectedPoints">Sort by projected points</option>
            <option value="delta">Sort by daily delta</option>
            <option value="cup">Sort by cup odds</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <MoverCard label="Biggest riser" team={overview?.biggestRiser} positive />
        <MoverCard label="Biggest faller" team={overview?.biggestFaller} positive={false} />
      </div>

      <div style={{ borderRadius: 22, border: "1px solid var(--border-strong)", background: "var(--bg-card)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "32px minmax(140px, 1.4fr) 80px 92px 72px 86px", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border-strong)", color: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          <div />
          <div>Team</div>
          <div style={{ textAlign: "right" }}>Proj Pts</div>
          <div style={{ textAlign: "right" }}>Playoff %</div>
          <div style={{ textAlign: "right" }}>Cup %</div>
          <div style={{ textAlign: "right" }}>Delta</div>
        </div>
        {(sorted || []).map((team) => (
          <div key={team.team} style={{ display: "grid", gridTemplateColumns: "32px minmax(140px, 1.4fr) 80px 92px 72px 86px", gap: 10, padding: "12px 14px", borderBottom: "1px solid rgba(20,36,53,0.8)", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl(team.team)} alt={team.team} width={24} height={24} style={{ width: 24, height: 24, objectFit: "contain" }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800 }}>{team.teamName}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>{team.team}</div>
            </div>
            <div style={{ textAlign: "right", color: "var(--text-primary)", fontFamily: "'DM Mono',monospace" }}>{team.projectedPointsRounded.toFixed(1)}</div>
            <div style={{ textAlign: "right", color: "var(--text-primary)", fontFamily: "'DM Mono',monospace" }}>{pct(team.playoffProbability)}</div>
            <div style={{ textAlign: "right", color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace" }}>{pct(team.cupProbability)}</div>
            <div style={{ textAlign: "right", color: team.playoffDelta >= 0 ? "#35e3a0" : "#ff8d9b", fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>{delta(team.playoffDelta)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
