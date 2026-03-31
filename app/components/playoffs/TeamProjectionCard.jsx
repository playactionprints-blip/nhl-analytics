"use client";

import Link from "next/link";
import { logoUrl } from "@/app/lib/nhlTeams";
import PointDistributionChart from "@/app/components/playoffs/PointDistributionChart";

function pct(value) {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export default function TeamProjectionCard({ team }) {
  return (
    <article style={{ borderRadius: 22, border: "1px solid var(--border-strong)", background: "var(--bg-card)", padding: 18, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl(team.team)} alt={team.team} width={34} height={34} style={{ width: 34, height: 34, objectFit: "contain" }} />
          <div>
            <div style={{ color: "var(--text-primary)", fontSize: 20, fontWeight: 900 }}>{team.teamName}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {team.team} · {team.conference} · {team.division}
            </div>
          </div>
        </div>
        <Link href={`/team/${team.team}`} style={{ color: "#9fd8ff", textDecoration: "none", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          View team
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {[
          ["Proj Pts", team.projectedPointsRounded.toFixed(1), "var(--text-primary)"],
          ["Playoff %", pct(team.playoffProbability), team.playoffProbability >= 0.75 ? "#35e3a0" : "var(--text-primary)"],
          ["Cup %", pct(team.cupProbability), "var(--text-primary)"],
          ["Daily Δ", `${team.playoffDelta >= 0 ? "+" : ""}${(team.playoffDelta * 100).toFixed(1)} pts`, team.playoffDelta >= 0 ? "#35e3a0" : "#ff8d9b"],
        ].map(([label, value, color]) => (
          <div key={label} style={{ borderRadius: 14, border: "1px solid var(--border-strong)", background: "rgba(8,16,24,0.58)", padding: "10px 12px" }}>
            <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
            <div style={{ color, fontSize: 20, fontWeight: 900, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 0.9fr)", gap: 16 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Point distribution
          </div>
          <PointDistributionChart bins={team.pointDistribution || []} />
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Likely first-round opponents
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {(team.likelyFirstRoundOpponents || []).length ? team.likelyFirstRoundOpponents.map((opponent) => (
              <div key={opponent.abbr} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 12, border: "1px solid var(--border-strong)", background: "rgba(8,16,24,0.58)", padding: "8px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoUrl(opponent.abbr)} alt={opponent.abbr} width={20} height={20} style={{ width: 20, height: 20, objectFit: "contain" }} />
                  <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 700 }}>{opponent.abbr}</span>
                </div>
                <span style={{ color: "var(--text-secondary)", fontSize: 11, fontFamily: "'DM Mono',monospace" }}>{pct(opponent.probability)}</span>
              </div>
            )) : (
              <div style={{ borderRadius: 12, border: "1px solid var(--border-strong)", background: "rgba(8,16,24,0.58)", padding: "10px 12px", color: "var(--text-muted)", fontSize: 12 }}>
                First-round matchup range is still settling.
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
