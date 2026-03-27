/**
 * Search-and-add roster builder for the Fantasy Hub.
 * Depends on the fantasy player pool and local roster state to manage
 * forwards, defense, goalies, bench, and IR sections.
 */
import { logoUrl } from "@/app/lib/nhlTeams";
import {
  addPlayerToRoster,
  buildRosterSections,
  formatCapHit,
  isPlayerRostered,
  removePlayerFromRoster,
} from "@/app/components/fantasy-hub/fantasyHubUtils";

function PositionBadge({ value }) {
  return (
    <span
      style={{
        borderRadius: 999,
        background: "rgba(47,180,255,0.14)",
        color: "var(--text-secondary)",
        padding: "3px 8px",
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontFamily: "'DM Mono',monospace",
      }}
    >
      {value}
    </span>
  );
}

function sectionMeta(sectionKey, settings) {
  if (sectionKey === "forwards") return { label: "Forwards", slots: settings.rosterSlots.forwards };
  if (sectionKey === "defense") return { label: "Defense", slots: settings.rosterSlots.defense };
  if (sectionKey === "goalies") return { label: "Goalies", slots: settings.rosterSlots.goalies };
  if (sectionKey === "bench") return { label: "Bench", slots: settings.rosterSlots.bench };
  return { label: "IR", slots: settings.rosterSlots.ir };
}

export default function FantasyRosterBuilder({
  players,
  playerMap,
  state,
  onStateChange,
  search,
  onSearchChange,
}) {
  const sections = buildRosterSections(state, playerMap);
  const searchResults = players
    .filter((player) =>
      !search.trim()
        ? true
        : player.player_name.toLowerCase().includes(search.trim().toLowerCase())
    )
    .slice(0, 30);

  function handleAddPlayer(player) {
    onStateChange((current) => addPlayerToRoster(current, player));
  }

  function handleRemovePlayer(playerId) {
    onStateChange((current) => removePlayerFromRoster(current, playerId));
  }

  return (
    <div className="fantasy-myteam-grid" style={{ display: "grid", gridTemplateColumns: "minmax(320px, 0.92fr) minmax(0, 1.08fr)", gap: 18 }}>
      <div style={{ display: "grid", gap: 16 }}>
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
          <div style={{ color: "var(--text-primary)", fontSize: 22, fontWeight: 900 }}>Player search</div>
          <input
            type="text"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search players..."
            style={{
              width: "100%",
              borderRadius: 14,
              border: "1px solid var(--border-strong)",
              background: "var(--bg-card)",
              color: "var(--text-primary)",
              padding: "12px 14px",
              fontSize: 14,
              outline: "none",
            }}
          />
          <div style={{ display: "grid", gap: 10, maxHeight: 620, overflowY: "auto", paddingRight: 2 }}>
            {searchResults.map((player) => {
              const rostered = isPlayerRostered(state, player.player_id);
              return (
                <div
                  key={player.player_id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto minmax(0, 1fr) auto",
                    gap: 12,
                    alignItems: "center",
                    borderRadius: 16,
                    border: "1px solid var(--border-strong)",
                    background: rostered ? "rgba(12,19,29,0.55)" : "var(--bg-card)",
                    padding: "10px 12px",
                    opacity: rostered ? 0.56 : 1,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoUrl(player.team)}
                    alt={player.team}
                    width={28}
                    height={28}
                    style={{ width: 28, height: 28, objectFit: "contain" }}
                  />
                  <div style={{ minWidth: 0, display: "grid", gap: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                      <div style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800, minWidth: 0 }}>{player.player_name}</div>
                      <PositionBadge value={player.position} />
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                      {player.team} · {formatCapHit(player.cap_hit)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddPlayer(player)}
                    disabled={rostered}
                    style={{
                      borderRadius: 999,
                      border: `1px solid ${rostered ? "#223647" : "#2fb4ff"}`,
                      background: rostered ? "#0c151e" : "rgba(47,180,255,0.12)",
                      color: rostered ? "#6d879f" : "var(--accent-blue)",
                      padding: "8px 10px",
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontFamily: "'DM Mono',monospace",
                      cursor: rostered ? "default" : "pointer",
                    }}
                  >
                    {rostered ? "Added" : "Add"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        {Object.entries(sections).map(([sectionKey, sectionPlayers]) => {
          const meta = sectionMeta(sectionKey, state.settings);
          return (
            <section
              key={sectionKey}
              style={{
                borderRadius: 22,
                border: "1px solid var(--border-strong)",
                background: "var(--bg-card)",
                padding: "16px 16px 14px",
                display: "grid",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 900 }}>{meta.label}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {sectionPlayers.length}/{meta.slots}
                </div>
              </div>
              {sectionPlayers.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
                  No players in this section yet.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {sectionPlayers.map((player) => (
                    <div
                      key={player.player_id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto minmax(0, 1fr) auto",
                        gap: 12,
                        alignItems: "center",
                        borderRadius: 16,
                        border: "1px solid var(--border-strong)",
                        background: "var(--bg-card)",
                        padding: "10px 12px",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={logoUrl(player.team)}
                        alt={player.team}
                        width={28}
                        height={28}
                        style={{ width: 28, height: 28, objectFit: "contain" }}
                      />
                      <div style={{ minWidth: 0, display: "grid", gap: 5 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800 }}>{player.player_name}</div>
                          <PositionBadge value={player.position} />
                        </div>
                        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                          {player.team} · WAR {player.war != null ? Number(player.war).toFixed(2) : "—"} · {formatCapHit(player.cap_hit)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePlayer(player.player_id)}
                        style={{
                          borderRadius: 999,
                          border: "1px solid var(--border-strong)",
                          background: "var(--bg-secondary)",
                          color: "var(--text-secondary)",
                          padding: "8px 10px",
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          fontFamily: "'DM Mono',monospace",
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <style>{`
        @media (max-width: 980px) {
          .fantasy-myteam-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
