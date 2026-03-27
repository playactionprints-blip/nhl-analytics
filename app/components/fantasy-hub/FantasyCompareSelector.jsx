/**
 * Player picker for the Fantasy Hub compare tab.
 * Depends on the fantasy player pool and selected compare IDs only.
 */
import { logoUrl } from "@/app/lib/nhlTeams";

function PositionBadge({ value }) {
  return (
    <span
      style={{
        borderRadius: 999,
        background: "rgba(47,180,255,0.14)",
        color: "#8fd6ff",
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

export default function FantasyCompareSelector({
  players,
  selectedIds,
  onAddPlayer,
  onRemovePlayer,
  search,
  onSearchChange,
}) {
  const selectedSet = new Set(selectedIds.map(String));
  const results = players
    .filter((player) => {
      if (selectedSet.has(String(player.player_id))) return false;
      if (!search.trim()) return true;
      return player.player_name.toLowerCase().includes(search.trim().toLowerCase());
    })
    .slice(0, 12);

  const selectedPlayers = selectedIds
    .map((id) => players.find((player) => String(player.player_id) === String(id)))
    .filter(Boolean);

  return (
    <section
      style={{
        borderRadius: 22,
        border: "1px solid var(--border-strong)",
        background: "var(--bg-card)",
        padding: "16px 16px 14px",
        display: "grid",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#6caede", fontSize: 11, fontFamily: "'DM Mono',monospace", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Player Selector
          </div>
          <div style={{ color: "var(--text-primary)", fontSize: 22, fontWeight: 900, marginTop: 4 }}>
            Compare 2 to 4 players
          </div>
        </div>
        <div style={{ color: "#7d95ab", fontSize: 12 }}>
          {selectedPlayers.length}/4 selected
        </div>
      </div>

      <input
        type="text"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search players to compare..."
        style={{
          width: "100%",
          borderRadius: 14,
          border: "1px solid #213547",
          background: "var(--bg-card)",
          color: "#e8f5ff",
          padding: "12px 14px",
          fontSize: 14,
          outline: "none",
        }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {selectedPlayers.length ? selectedPlayers.map((player) => (
          <div
            key={player.player_id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 999,
              border: "1px solid #224057",
              background: "var(--bg-card)",
              padding: "8px 10px",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl(player.team)}
              alt={player.team}
              width={22}
              height={22}
              style={{ width: 22, height: 22, objectFit: "contain" }}
            />
            <span style={{ color: "#e8f5ff", fontSize: 13, fontWeight: 800 }}>{player.player_name}</span>
            <PositionBadge value={player.position} />
            <button
              type="button"
              onClick={() => onRemovePlayer(player.player_id)}
              style={{
                border: "none",
                background: "transparent",
                color: "#8ea8c0",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 900,
                lineHeight: 1,
              }}
              aria-label={`Remove ${player.player_name}`}
            >
              ×
            </button>
          </div>
        )) : (
          <div style={{ color: "#69839d", fontSize: 13 }}>
            Pick at least two players to unlock the comparison view.
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {results.map((player) => (
          <button
            key={player.player_id}
            type="button"
            onClick={() => onAddPlayer(player.player_id)}
            disabled={selectedPlayers.length >= 4}
            style={{
              border: "1px solid var(--border-strong)",
              borderRadius: 16,
              background: "var(--bg-card)",
              padding: "10px 12px",
              display: "grid",
              gridTemplateColumns: "auto minmax(0, 1fr) auto",
              gap: 12,
              alignItems: "center",
              cursor: selectedPlayers.length >= 4 ? "default" : "pointer",
              opacity: selectedPlayers.length >= 4 ? 0.55 : 1,
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
            <div style={{ minWidth: 0, display: "grid", gap: 4, textAlign: "left" }}>
              <div style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800 }}>{player.player_name}</div>
              <div style={{ color: "#7d95ab", fontSize: 12 }}>
                {player.team} · {player.position}
              </div>
            </div>
            <PositionBadge value={player.position} />
          </button>
        ))}
      </div>
    </section>
  );
}
