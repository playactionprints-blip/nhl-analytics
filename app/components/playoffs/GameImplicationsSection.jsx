"use client";

import GameImpactCard from "@/app/components/playoffs/GameImpactCard";

export default function GameImplicationsSection({ loading, dateOptions = [], selectedDate, onDateChange, data }) {
  return (
    <section style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Game implications
          </div>
          <div style={{ fontSize: 32, color: "var(--text-primary)", fontWeight: 900, marginTop: 4 }}>
            The playoff race game by game
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 6 }}>
            Fix a result branch, rerun the rest of the season, and see who gains or loses ground.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Date
          </label>
          <select
            value={selectedDate}
            onChange={(event) => onDateChange(event.target.value)}
            style={{
              borderRadius: 12,
              border: "1px solid var(--border-strong)",
              background: "var(--bg-card)",
              color: "var(--text-primary)",
              padding: "10px 14px",
              minWidth: 180,
            }}
          >
            {dateOptions.map((date) => (
              <option key={date} value={date}>{date}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div style={{ borderRadius: 20, border: "1px solid var(--border-strong)", background: "var(--bg-card)", padding: "18px 20px", color: "var(--text-secondary)" }}>
          Re-simulating the race for the selected date.
        </div>
      )}

      {!loading && !data?.games?.length && (
        <div style={{ borderRadius: 20, border: "1px solid var(--border-strong)", background: "var(--bg-card)", padding: "18px 20px", color: "var(--text-secondary)" }}>
          No remaining games were found for this date.
        </div>
      )}

      {!loading && (data?.games || []).map((gameImpact) => (
        <GameImpactCard key={gameImpact.gameId} gameImpact={gameImpact} />
      ))}
    </section>
  );
}
