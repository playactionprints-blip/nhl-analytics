/**
 * Weekly fantasy schedule view.
 * Depends on /api/fantasy/schedule output plus the user's roster to highlight
 * relevant teams and off-night opportunities in a fantasy-planning context.
 */
import { addDaysIso } from "@/app/components/fantasy-hub/fantasyHubUtils";

function dayLabel(dateString) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/Toronto",
  }).format(new Date(`${dateString}T12:00:00Z`));
}

export default function FantasyScheduleView({
  weekStart,
  onWeekChange,
  scheduleData,
  showRosterTeamsOnly,
  onToggleRosterTeamsOnly,
  rosterTeams,
}) {
  const weekDays = scheduleData?.weekDays || [];
  const summaryMap = {};
  weekDays.forEach((day) => {
    day.games.forEach((game) => {
      [game.awayTeam, game.homeTeam].forEach((team) => {
        if (!team) return;
        if (!summaryMap[team]) summaryMap[team] = { games: 0, offNights: 0, dates: [] };
        summaryMap[team].games += 1;
        if (day.isOffNight) summaryMap[team].offNights += 1;
        summaryMap[team].dates.push(day.date);
      });
    });
  });

  const visibleTeams = Object.entries(summaryMap)
    .filter(([team]) => !showRosterTeamsOnly || rosterTeams.has(team))
    .sort((a, b) => b[1].games - a[1].games || a[0].localeCompare(b[0]));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#6caede", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Weekly Schedule
          </div>
          <div style={{ color: "var(--text-primary)", fontSize: 26, fontWeight: 900, marginTop: 4 }}>
            Fantasy schedule planning
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => onWeekChange(addDaysIso(weekStart, -7))}
            style={{
              borderRadius: 999,
              border: "1px solid #213547",
              background: "#0d1620",
              color: "#d4e9f8",
              padding: "9px 12px",
              cursor: "pointer",
            }}
          >
            Prev Week
          </button>
          <button
            type="button"
            onClick={() => onWeekChange(addDaysIso(weekStart, 7))}
            style={{
              borderRadius: 999,
              border: "1px solid #213547",
              background: "#0d1620",
              color: "#d4e9f8",
              padding: "9px 12px",
              cursor: "pointer",
            }}
          >
            Next Week
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#8ca8c1", fontSize: 13 }}>
            <input type="checkbox" checked={showRosterTeamsOnly} onChange={(event) => onToggleRosterTeamsOnly(event.target.checked)} />
            My roster teams only
          </label>
        </div>
      </div>

      <div className="fantasy-schedule-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(300px, 0.7fr)", gap: 16 }}>
        <section
          style={{
            borderRadius: 22,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-card)",
            padding: "16px 16px 14px",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 900 }}>Games by day</div>
          <div className="fantasy-week-days" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 10 }}>
            {weekDays.map((day) => (
              <div
                key={day.date}
                style={{
                  borderRadius: 16,
                  border: `1px solid ${day.isOffNight ? "#2c7258" : "#17283b"}`,
                  background: day.isOffNight ? "rgba(53,227,160,0.08)" : "#0d1620",
                  padding: "12px 12px 10px",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 800 }}>{dayLabel(day.date)}</div>
                  <div style={{ color: day.isOffNight ? "#47e8aa" : "#7d95ab", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 4 }}>
                    {day.isOffNight ? "Off-night" : `${day.numberOfGames} games`}
                  </div>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {day.games.length ? day.games.map((game) => (
                    <div key={game.id} style={{ color: "#d6e9f7", fontSize: 13, lineHeight: 1.4 }}>
                      {game.awayTeam} at {game.homeTeam}
                    </div>
                  )) : (
                    <div style={{ color: "#6f879f", fontSize: 12 }}>No games</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            borderRadius: 22,
            border: "1px solid var(--border-strong)",
            background: "var(--bg-card)",
            padding: "16px 16px 14px",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 900 }}>Weekly games summary</div>
          <div style={{ display: "grid", gap: 10 }}>
            {visibleTeams.length ? visibleTeams.map(([team, meta]) => (
              <div
                key={team}
                style={{
                  borderRadius: 16,
                  border: "1px solid var(--border-strong)",
                  background: "#0d1620",
                  padding: "12px 12px 10px",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                  <div style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800 }}>{team}</div>
                  <div style={{ color: "#8fd6ff", fontSize: 14, fontWeight: 900 }}>{meta.games} games</div>
                </div>
                <div style={{ color: "#7d95ab", fontSize: 12 }}>
                  Off-nights: {meta.offNights} · {meta.dates.map((date) => dayLabel(date).split(",")[0]).join(" · ")}
                </div>
              </div>
            )) : (
              <div style={{ color: "#6f879f", fontSize: 13 }}>
                No teams match the current schedule filter.
              </div>
            )}
          </div>
        </section>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .fantasy-schedule-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 860px) {
          .fantasy-week-days {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
