"use client";

/**
 * Interactive Armchair GM roster builder UI.
 * Depends on the roster-builder player API route, shared NHL team metadata,
 * and local URL state encoded into a single base64 roster query param.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BreadcrumbSetter } from "@/Breadcrumbs";
import { TEAM_FULL, logoUrl } from "@/app/lib/nhlTeams";
import {
  DEFAULT_TEAM_NAME,
  DEFENSE_PAIRS,
  DEFENSE_POSITIONS,
  FORWARD_LINES,
  FORWARD_POSITIONS,
  GOALIE_POSITION,
  GOALIE_SLOTS,
  NHL_CAP_CEILING,
  POSITION_FILTERS,
} from "@/app/components/roster-builder/rosterBuilderConfig";
import {
  buildRosterSummary,
  clearPlayerFromRoster,
  createDefaultRosterState,
  decodeRosterState,
  encodeRosterState,
  findPlayerSlot,
  formatCapHit,
  formatWar,
  getAssignedPlayerIds,
  getAvailableEmptySlots,
  getExpiryTone,
  getSlotValue,
  isRosterEmpty,
  isValidPositionForSlot,
  removeSlotPlayer,
  setSlotValue,
  slotRequirementLabel,
  swapOrMovePlayer,
} from "@/app/components/roster-builder/rosterBuilderUtils";

function ovrTierStyle(value) {
  if (value >= 90) return { color: "#00e5a0", border: "#1f7d66", background: "#0d2e27" };
  if (value >= 80) return { color: "#7fd0ff", border: "#235b7d", background: "#0c2231" };
  if (value >= 70) return { color: "#ffca6a", border: "#7a5a22", background: "#2b210f" };
  return { color: "#8da2b6", border: "#344556", background: "#141c24" };
}

function formatAvg(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(1);
}

function capSpaceTone(value) {
  if (value < 0) return "#ff4d57";
  if (value < 5_000_000) return "#ff8c4d";
  if (value < 10_000_000) return "#ffbf5f";
  return "#18d89d";
}

function positionFilterMatch(filter, player) {
  const pos = String(player.position || "").toUpperCase();
  if (filter === "ALL") return true;
  if (filter === "F") return ["F", "C", "L", "LW", "R", "RW"].includes(pos);
  return pos === filter;
}

function normalizePlayers(payload) {
  return (payload || []).map((player) => ({
    id: String(player.player_id),
    name: player.player_name,
    team: player.team,
    position: player.position,
    capHit: player.cap_hit,
    contractExpiry: player.contract_expiry,
    war: player.war,
    overallRating: player.overall_rating,
    offRating: player.off_rating,
    defRating: player.def_rating,
  }));
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return isMobile;
}

function LoadingPool() {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          style={{
            height: 62,
            borderRadius: 14,
            border: "1px solid #182635",
            background: index % 2 === 0 ? "#0c151f" : "#0a121a",
            animation: "rbPulse 1.4s ease-in-out infinite",
          }}
        />
      ))}
    </div>
  );
}

function SlotPickerModal({ player, slots, onAssign, onClose }) {
  if (!player) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(2,6,12,0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#0c151f",
          border: "1px solid #1d3044",
          borderRadius: 22,
          padding: 22,
          boxShadow: "0 28px 80px rgba(0,0,0,0.42)",
        }}
      >
        <div style={{ fontSize: 11, color: "#5d7c99", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>
          Select a position slot
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <img src={logoUrl(player.team)} alt={player.team} width={34} height={34} style={{ objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#f2f7fb", fontFamily: "'Barlow Condensed',sans-serif" }}>
              {player.name}
            </div>
            <div style={{ fontSize: 11, color: "#6c8aa6", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {player.team} · {player.position || "—"} · {formatCapHit(player.capHit)}
            </div>
          </div>
        </div>
        {slots.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
            {slots.map((slot) => (
              <button
                key={slot.key}
                onClick={() => onAssign(slot)}
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: "1px solid #244a67",
                  background: "#0e2130",
                  color: "#cbe6fa",
                  fontSize: 14,
                  fontWeight: 800,
                  fontFamily: "'Barlow Condensed',sans-serif",
                  cursor: "pointer",
                }}
              >
                {slot.lineKey} · {slot.slotKey}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ color: "#90a8bc", fontSize: 14 }}>
            No empty valid slots are available for this player right now.
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerRow({ player, assigned, isMobile, onPick, onDragStart }) {
  const tier = ovrTierStyle(player.overallRating ?? 0);
  return (
    <div
      draggable={!isMobile}
      onDragStart={(event) => onDragStart(event, player)}
      onClick={() => onPick(player)}
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr auto",
        gap: 10,
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid #162433",
        background: "#0b141d",
        cursor: "pointer",
        opacity: assigned ? 0.42 : 1,
      }}
      title={`${TEAM_FULL[player.team] || player.team} · ${player.position || "—"}`}
    >
      <img src={logoUrl(player.team)} alt={player.team} width={28} height={28} style={{ objectFit: "contain" }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#edf6fd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {player.name}
        </div>
        <div style={{ marginTop: 3, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#8fc7ff", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em", padding: "2px 6px", border: "1px solid #23445f", borderRadius: 999 }}>
            {player.position || "—"}
          </span>
          <span style={{ fontSize: 10, color: "#6c8aa6", fontFamily: "'DM Mono',monospace" }}>{formatCapHit(player.capHit)}</span>
        </div>
      </div>
      <div
        style={{
          minWidth: 40,
          textAlign: "center",
          padding: "6px 8px",
          borderRadius: 999,
          border: `1px solid ${tier.border}`,
          background: tier.background,
          color: tier.color,
          fontSize: 11,
          fontWeight: 800,
          fontFamily: "'DM Mono',monospace",
        }}
      >
        {player.overallRating != null ? Math.round(player.overallRating) : "—"}
      </div>
    </div>
  );
}

function FilledSlot({ slotKey, player, errorMessage, isMobile, onRemove, onDragStart, onDrop, onDragOver }) {
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      style={{
        minHeight: 94,
        borderRadius: 18,
        border: `1px solid ${errorMessage ? "#a34545" : "#1e3144"}`,
        background: errorMessage ? "rgba(130,42,42,0.18)" : "#0b141d",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      {player ? (
        <>
          <div
            draggable={!isMobile}
            onDragStart={(event) => onDragStart(event)}
            style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: isMobile ? "default" : "grab" }}
          >
            <img src={logoUrl(player.team)} alt={player.team} width={28} height={28} style={{ objectFit: "contain", marginTop: 2 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#edf6fd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {player.name}
              </div>
              <div style={{ marginTop: 4, fontSize: 11, color: "#6f8aa7", fontFamily: "'DM Mono',monospace" }}>
                {formatCapHit(player.capHit)} · WAR {formatWar(player.war)}
              </div>
            </div>
            <button
              onClick={onRemove}
              aria-label={`Remove ${player.name}`}
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: "1px solid #2f4458",
                background: "#101b26",
                color: "#9cbad5",
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: 10, color: "#4c6781", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {slotKey}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center", height: "100%" }}>
          <div style={{ fontSize: 11, color: "#6b8298", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            {slotKey}
          </div>
          <div
            style={{
              minHeight: 44,
              borderRadius: 12,
              border: "1px dashed #355069",
              background: "rgba(15,25,36,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#7b93a8",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            Empty
          </div>
        </div>
      )}
      {errorMessage && (
        <div style={{ fontSize: 10, color: "#ff8f8f", fontFamily: "'DM Mono',monospace" }}>
          {errorMessage}
        </div>
      )}
    </div>
  );
}

export default function RosterBuilderApp({ initialRosterParam = "" }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const initialParamRef = useRef(Boolean(initialRosterParam));
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState("ALL");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [poolExpanded, setPoolExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [slotErrors, setSlotErrors] = useState({});
  const [modalPlayer, setModalPlayer] = useState(null);
  const [rosterState, setRosterState] = useState(() => decodeRosterState(initialRosterParam));
  const [loadTeamCode, setLoadTeamCode] = useState("ANA");
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [rosterToast, setRosterToast] = useState("");
  const autoLoadFiredRef = useRef(false);

  useEffect(() => {
    setPoolExpanded(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    let cancelled = false;

    async function loadPlayers() {
      try {
        setLoading(true);
        setError("");
        const response = await fetch("/api/roster-builder/players", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Could not load players");
        if (!cancelled) setPlayers(normalizePlayers(payload));
      } catch (fetchError) {
        if (!cancelled) setError(fetchError.message || "Could not load players — try refreshing");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPlayers();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setSlotErrors({}), 2000);
    return () => clearTimeout(timeout);
  }, [slotErrors]);

  useEffect(() => {
    const encoded = encodeRosterState(rosterState);
    const isDefault = isRosterEmpty(rosterState) && rosterState.teamName === DEFAULT_TEAM_NAME;
    const href = isDefault && !initialParamRef.current
      ? "/roster-builder"
      : `/roster-builder?roster=${encodeURIComponent(encoded)}`;
    router.replace(href, { scroll: false });
  }, [rosterState, router]);

  async function loadTeamRoster(teamCode) {
    setLoadingRoster(true);
    try {
      const teamPlayers = players.filter((p) => p.team === teamCode);

      const forwards = teamPlayers
        .filter((p) => ["C", "L", "LW", "R", "RW", "F"].includes(String(p.position).toUpperCase()))
        .sort((a, b) => (b.overallRating ?? 0) - (a.overallRating ?? 0));

      const defense = teamPlayers
        .filter((p) => String(p.position).toUpperCase() === "D")
        .sort((a, b) => (b.overallRating ?? 0) - (a.overallRating ?? 0));

      const goalies = teamPlayers
        .filter((p) => String(p.position).toUpperCase() === "G")
        .sort((a, b) => (b.overallRating ?? 0) - (a.overallRating ?? 0));

      let newRoster = createDefaultRosterState();

      let fIdx = 0;
      for (const lineKey of FORWARD_LINES) {
        for (const slotKey of FORWARD_POSITIONS) {
          if (forwards[fIdx]) {
            newRoster = setSlotValue(newRoster, lineKey, slotKey, forwards[fIdx].id);
            fIdx++;
          }
        }
      }

      let dIdx = 0;
      for (const pairKey of DEFENSE_PAIRS) {
        for (const slotKey of DEFENSE_POSITIONS) {
          if (defense[dIdx]) {
            newRoster = setSlotValue(newRoster, pairKey, slotKey, defense[dIdx].id);
            dIdx++;
          }
        }
      }

      GOALIE_SLOTS.forEach((lineKey, i) => {
        if (goalies[i]) {
          newRoster = setSlotValue(newRoster, lineKey, GOALIE_POSITION, goalies[i].id);
        }
      });

      setRosterState(newRoster);
      setTeamFilter(teamCode);
      setRosterToast(`Loaded ${TEAM_FULL[teamCode] ?? teamCode} roster`);
      setTimeout(() => setRosterToast(""), 2000);
    } catch (err) {
      console.error("Failed to load team roster:", err);
    } finally {
      setLoadingRoster(false);
    }
  }

  useEffect(() => {
    console.log("Auto-load check:", { fired: autoLoadFiredRef.current, hasParam: Boolean(initialRosterParam), empty: isRosterEmpty(rosterState), playersLen: players.length });
    if (
      !autoLoadFiredRef.current &&
      !initialRosterParam &&
      isRosterEmpty(rosterState) &&
      players.length > 0
    ) {
      autoLoadFiredRef.current = true;
      console.log("Auto-loading ANA roster", players.length);
      loadTeamRoster("ANA");
    }
  }, [players.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const playerMap = useMemo(
    () => Object.fromEntries(players.map((player) => [String(player.id), player])),
    [players]
  );

  const assignedIds = useMemo(() => getAssignedPlayerIds(rosterState), [rosterState]);
  const summary = useMemo(() => buildRosterSummary(rosterState, playerMap), [rosterState, playerMap]);

  const filteredPlayers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return players.filter((player) => {
      if (teamFilter !== "ALL" && player.team !== teamFilter) return false;
      if (!positionFilterMatch(positionFilter, player)) return false;
      if (query && !player.name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [players, positionFilter, search, teamFilter]);

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  const capRemaining = NHL_CAP_CEILING - summary.totalCapCommitted;
  const capTone = capSpaceTone(capRemaining);

  function assignPlayerToSlot(playerId, slot) {
    setRosterState((current) => {
      const cleared = clearPlayerFromRoster(current, playerId);
      return setSlotValue(cleared, slot.lineKey, slot.slotKey, playerId);
    });
  }

  function removeSlot(lineKey, slotKey) {
    setRosterState((current) => removeSlotPlayer(current, { lineKey, slotKey }));
  }

  function setSlotError(lineKey, slotKey, message) {
    setSlotErrors({ [`${lineKey}.${slotKey}`]: message });
  }

  function handlePlayerPick(player) {
    const slots = getAvailableEmptySlots(rosterState, player);
    setModalPlayer({ player, slots });
  }

  function handleAssignFromModal(slot) {
    if (!modalPlayer) return;
    assignPlayerToSlot(modalPlayer.player.id, slot);
    setModalPlayer(null);
  }

  function handleDragStart(event, player, sourceSlot = null) {
    if (isMobile) return;
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ playerId: String(player.id), sourceSlot })
    );
    event.dataTransfer.effectAllowed = "move";
  }

  function handleSlotDrop(event, lineKey, slotKey) {
    event.preventDefault();
    try {
      const payload = JSON.parse(event.dataTransfer.getData("text/plain"));
      const player = playerMap[String(payload.playerId)];
      if (!player) return;

      if (!isValidPositionForSlot(player.position, lineKey, slotKey)) {
        setSlotError(lineKey, slotKey, `Wrong position — this slot requires ${slotRequirementLabel(lineKey, slotKey)}`);
        return;
      }

      const targetId = getSlotValue(rosterState, lineKey, slotKey);

      if (!payload.sourceSlot) {
        if (targetId) {
          setSlotError(lineKey, slotKey, "Slot already filled");
          return;
        }
        assignPlayerToSlot(player.id, { lineKey, slotKey });
        return;
      }

      const sourceSlot = payload.sourceSlot;
      const sourcePlayer = playerMap[String(getSlotValue(rosterState, sourceSlot.lineKey, sourceSlot.slotKey))];
      if (!sourcePlayer) return;
      if (sourceSlot.lineKey === lineKey && sourceSlot.slotKey === slotKey) return;

      if (!targetId) {
        setRosterState((current) => swapOrMovePlayer(current, sourceSlot, { lineKey, slotKey }));
        return;
      }

      const targetPlayer = playerMap[String(targetId)];
      if (!targetPlayer) return;

      if (!isValidPositionForSlot(targetPlayer.position, sourceSlot.lineKey, sourceSlot.slotKey)) {
        setSlotError(lineKey, slotKey, `Wrong position — this slot requires ${slotRequirementLabel(lineKey, slotKey)}`);
        return;
      }

      setRosterState((current) => swapOrMovePlayer(current, sourceSlot, { lineKey, slotKey }));
    } catch {
      // Ignore invalid drag payloads.
    }
  }

  function handlePoolDrop(event) {
    event.preventDefault();
    try {
      const payload = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (!payload.sourceSlot) return;
      setRosterState((current) => removeSlotPlayer(current, payload.sourceSlot));
    } catch {
      // Ignore invalid drag payloads.
    }
  }

  async function copyShareableLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function groupedRows(groupKey) {
    return summary.players.filter((player) => {
      if (groupKey === "forwards") return player.lineKey.startsWith("F");
      if (groupKey === "defense") return player.lineKey.startsWith("D");
      return player.lineKey.startsWith("G");
    });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top left, #0d2136 0%, var(--bg-primary) 58%, var(--bg-primary) 100%)",
        padding: "32px 20px 60px",
      }}
    >
      <BreadcrumbSetter items={[{ href: "/roster-builder", label: "Roster Builder" }]} />
      <style>{`
        @keyframes rbPulse {
          0%, 100% { opacity: 0.62; }
          50% { opacity: 1; }
        }
        .rb-grid {
          display: grid;
          grid-template-columns: 280px minmax(0, 1fr) 300px;
          gap: 18px;
          align-items: start;
        }
        @media (max-width: 767px) {
          .rb-page-shell {
            padding: 18px 12px 36px !important;
          }
          .rb-page-title {
            font-size: 34px !important;
          }
          .rb-grid {
            grid-template-columns: 1fr;
          }
          .rb-load-row,
          .rb-filter-row {
            grid-template-columns: 1fr !important;
          }
          .rb-forward-row,
          .rb-defense-row,
          .rb-goalie-row {
            grid-template-columns: 1fr !important;
          }
          .rb-line-label {
            justify-content: flex-start !important;
            padding-left: 2px;
          }
        }
      `}</style>

      <div className="rb-page-shell" style={{ maxWidth: 1440, margin: "0 auto" }}>
        <div style={{ marginBottom: 28, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#2a5070", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>
            NHL Analytics
          </div>
          <h1 className="rb-page-title" style={{ fontSize: 42, fontWeight: 900, color: "#e8f4ff", letterSpacing: "-0.5px", lineHeight: 1, margin: 0 }}>
            Armchair GM Roster Builder
          </h1>
          <div style={{ fontSize: 12, color: "#5c7894", fontFamily: "'DM Mono',monospace", marginTop: 8 }}>
            Search, slot, and share a custom roster using current-season player data.
          </div>
        </div>

        <div className="rb-grid">
          <div
            onDrop={isMobile ? undefined : handlePoolDrop}
            onDragOver={isMobile ? undefined : (event) => event.preventDefault()}
            style={{
              background: "#0c151f",
              border: "1px solid #1a2a3a",
              borderRadius: 22,
              padding: 16,
              position: isMobile ? "static" : "sticky",
              top: isMobile ? "auto" : 108,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#7291ad", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                Player pool
              </div>
              {isMobile && (
                <button
                  onClick={() => setPoolExpanded((current) => !current)}
                  style={{
                    border: "1px solid #22384b",
                    background: "#101b26",
                    color: "#b7d3eb",
                    borderRadius: 999,
                    padding: "6px 10px",
                    fontSize: 11,
                    fontFamily: "'DM Mono',monospace",
                    cursor: "pointer",
                  }}
                >
                  {poolExpanded ? "Hide" : "Show"}
                </button>
              )}
            </div>

            {/* Load Team Roster */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                Load Team Roster
              </div>
              <div className="rb-load-row" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 8 }}>
                <select
                  value={loadTeamCode}
                  onChange={(e) => setLoadTeamCode(e.target.value)}
                  style={{
                    flex: 1,
                    background: "var(--bg-card-hover)",
                    border: "1px solid #1e3048",
                    color: "var(--text-primary)",
                    borderRadius: 10,
                    padding: "6px 10px",
                    fontSize: 12,
                    fontFamily: "'DM Mono',monospace",
                    minWidth: 0,
                  }}
                >
                  {Object.entries(TEAM_FULL)
                    .sort(([, a], [, b]) => a.localeCompare(b))
                    .map(([code, name]) => (
                      <option key={code} value={code}>{name}</option>
                    ))}
                </select>
                <button
                  onClick={() => loadTeamRoster(loadTeamCode)}
                  disabled={loadingRoster}
                  style={{
                    background: "#1a2d42",
                    border: "1px solid #2fb4ff",
                    color: "#9fd8ff",
                    borderRadius: 10,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontFamily: "'DM Mono',monospace",
                    cursor: loadingRoster ? "default" : "pointer",
                    whiteSpace: "nowrap",
                    opacity: loadingRoster ? 0.7 : 1,
                  }}
                  onMouseEnter={(e) => { if (!loadingRoster) e.currentTarget.style.background = "#213650"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#1a2d42"; }}
                >
                  {loadingRoster ? "Loading..." : "Load Roster"}
                </button>
              </div>
            </div>

            {(!isMobile || poolExpanded) && (
              <>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search players..."
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid #213447",
                    background: "#09111a",
                    color: "#edf6fd",
                    outline: "none",
                    fontSize: 15,
                    marginBottom: 10,
                  }}
                />

                <div className="rb-filter-row" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {POSITION_FILTERS.map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setPositionFilter(filter)}
                      style={{
                        padding: "7px 10px",
                        borderRadius: 999,
                        border: `1px solid ${positionFilter === filter ? "#2fb4ff" : "#22384b"}`,
                        background: positionFilter === filter ? "#12293b" : "#101821",
                        color: positionFilter === filter ? "#cfefff" : "#90a8bc",
                        fontSize: 11,
                        fontFamily: "'DM Mono',monospace",
                        cursor: "pointer",
                      }}
                    >
                      {filter}
                    </button>
                  ))}
                  </div>

                  <select
                    value={teamFilter}
                    onChange={(event) => setTeamFilter(event.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid #213447",
                      background: "#09111a",
                      color: "#cfe7fb",
                      fontSize: 14,
                      marginBottom: 12,
                    }}
                  >
                    <option value="ALL">All Teams</option>
                    {Object.entries(TEAM_FULL).map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>

                {loading ? (
                  <LoadingPool />
                ) : error ? (
                  <div style={{ padding: 14, borderRadius: 14, border: "1px solid #5b2d33", background: "#201116", color: "#ffb1b7", fontSize: 14 }}>
                    Could not load players — try refreshing
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10, maxHeight: "70vh", overflowY: "auto", paddingRight: 2 }}>
                    {filteredPlayers.map((player) => (
                      <PlayerRow
                        key={player.id}
                        player={player}
                        assigned={assignedIds.has(String(player.id))}
                        isMobile={isMobile}
                        onPick={handlePlayerPick}
                        onDragStart={(event, selectedPlayer) => handleDragStart(event, selectedPlayer, null)}
                      />
                    ))}
                    {!filteredPlayers.length && (
                      <div style={{ padding: 16, color: "#90a8bc", border: "1px solid #182635", borderRadius: 14 }}>
                        No players found
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ display: "grid", gap: 18 }}>
            <div style={{ background: "#0c151f", border: "1px solid #1a2a3a", borderRadius: 22, padding: 18 }}>
              <div style={{ fontSize: 11, color: "#7291ad", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>
                Team name
              </div>
              <input
                value={rosterState.teamName}
                onChange={(event) =>
                  setRosterState((current) => ({
                    ...current,
                    teamName: event.target.value || DEFAULT_TEAM_NAME,
                  }))
                }
                style={{
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "var(--text-primary)",
                  fontSize: 34,
                  fontWeight: 900,
                  fontFamily: "'Barlow Condensed',sans-serif",
                  letterSpacing: "-0.4px",
                }}
              />
            </div>

            <div style={{ background: "#0c151f", border: "1px solid #1a2a3a", borderRadius: 22, padding: 18 }}>
              <div style={{ fontSize: 11, color: "#7291ad", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>
                Forward lines
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {FORWARD_LINES.map((lineKey) => (
                  <div key={lineKey} className="rb-forward-row" style={{ display: "grid", gridTemplateColumns: "50px repeat(3, minmax(0,1fr))", gap: 10, alignItems: "stretch" }}>
                    <div className="rb-line-label" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#8ca8c1", fontFamily: "'DM Mono',monospace", fontSize: 13 }}>{lineKey}</div>
                    {FORWARD_POSITIONS.map((slotKey) => {
                      const playerId = getSlotValue(rosterState, lineKey, slotKey);
                      const player = playerId ? playerMap[String(playerId)] : null;
                      return (
                        <FilledSlot
                          key={`${lineKey}.${slotKey}`}
                          slotKey={slotKey}
                          player={player}
                          errorMessage={slotErrors[`${lineKey}.${slotKey}`]}
                          isMobile={isMobile}
                          onRemove={() => removeSlot(lineKey, slotKey)}
                          onDragStart={(event) => handleDragStart(event, player, { lineKey, slotKey })}
                          onDrop={(event) => handleSlotDrop(event, lineKey, slotKey)}
                          onDragOver={(event) => !isMobile && event.preventDefault()}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#0c151f", border: "1px solid #1a2a3a", borderRadius: 22, padding: 18 }}>
              <div style={{ fontSize: 11, color: "#7291ad", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>
                Defense pairs
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {DEFENSE_PAIRS.map((lineKey) => (
                  <div key={lineKey} className="rb-defense-row" style={{ display: "grid", gridTemplateColumns: "50px repeat(2, minmax(0,1fr))", gap: 10, alignItems: "stretch" }}>
                    <div className="rb-line-label" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#8ca8c1", fontFamily: "'DM Mono',monospace", fontSize: 13 }}>{lineKey}</div>
                    {DEFENSE_POSITIONS.map((slotKey) => {
                      const playerId = getSlotValue(rosterState, lineKey, slotKey);
                      const player = playerId ? playerMap[String(playerId)] : null;
                      return (
                        <FilledSlot
                          key={`${lineKey}.${slotKey}`}
                          slotKey={slotKey}
                          player={player}
                          errorMessage={slotErrors[`${lineKey}.${slotKey}`]}
                          isMobile={isMobile}
                          onRemove={() => removeSlot(lineKey, slotKey)}
                          onDragStart={(event) => handleDragStart(event, player, { lineKey, slotKey })}
                          onDrop={(event) => handleSlotDrop(event, lineKey, slotKey)}
                          onDragOver={(event) => !isMobile && event.preventDefault()}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#0c151f", border: "1px solid #1a2a3a", borderRadius: 22, padding: 18 }}>
              <div style={{ fontSize: 11, color: "#7291ad", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 12 }}>
                Goalies
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {GOALIE_SLOTS.map((lineKey) => {
                  const playerId = getSlotValue(rosterState, lineKey, GOALIE_POSITION);
                  const player = playerId ? playerMap[String(playerId)] : null;
                  return (
                    <div key={lineKey} className="rb-goalie-row" style={{ display: "grid", gridTemplateColumns: "50px minmax(0,1fr)", gap: 10, alignItems: "stretch" }}>
                      <div className="rb-line-label" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#8ca8c1", fontFamily: "'DM Mono',monospace", fontSize: 13 }}>{lineKey}</div>
                      <FilledSlot
                        slotKey="G"
                        player={player}
                        errorMessage={slotErrors[`${lineKey}.G`]}
                        isMobile={isMobile}
                        onRemove={() => removeSlot(lineKey, "G")}
                        onDragStart={(event) => handleDragStart(event, player, { lineKey, slotKey: "G" })}
                        onDrop={(event) => handleSlotDrop(event, lineKey, "G")}
                        onDragOver={(event) => !isMobile && event.preventDefault()}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {isRosterEmpty(rosterState) && (
              <div style={{ borderRadius: 18, border: "1px dashed #27445d", background: "rgba(10,18,26,0.74)", padding: "26px 22px", color: "#97b0c6", textAlign: "center" }}>
                Search for players on the left or drag them into position slots
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ background: "#0c151f", border: "1px solid #1a2a3a", borderRadius: 22, padding: 18 }}>
              <div style={{ fontSize: 11, color: "#7291ad", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>
                Cap tracker
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "#7f98af", marginBottom: 4 }}>Cap ceiling</div>
                  <div style={{ fontSize: 26, fontWeight: 900, color: "#ebf6ff" }}>{formatCapHit(NHL_CAP_CEILING)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#7f98af", marginBottom: 4 }}>Total committed</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#d8ebfa" }}>{formatCapHit(summary.totalCapCommitted)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#7f98af", marginBottom: 4 }}>Cap space remaining</div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: capTone }}>
                    {capRemaining >= 0 ? formatCapHit(capRemaining) : `-${formatCapHit(Math.abs(capRemaining))}`}
                  </div>
                  {capRemaining < 0 && (
                    <div style={{ marginTop: 4, fontSize: 10, color: "#ff6670", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      Over cap
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "#7f98af", marginBottom: 4 }}>Player count</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#d8ebfa" }}>{summary.filledCount} / 23</div>
                </div>
              </div>
            </div>

            <div style={{ background: "#0c151f", border: "1px solid #1a2a3a", borderRadius: 22, padding: 18 }}>
              <div style={{ fontSize: 11, color: "#7291ad", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>
                Roster analytics
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  ["Total WAR", formatAvg(summary.totalWar)],
                  ["Avg OVR", formatAvg(summary.avgOvr)],
                  ["Avg OFF", formatAvg(summary.avgOff)],
                  ["Avg DEF", formatAvg(summary.avgDef)],
                ].map(([label, value]) => (
                  <div key={label} style={{ borderRadius: 14, border: "1px solid #1c2f42", background: "#0a121a", padding: 12 }}>
                    <div style={{ fontSize: 10, color: "#6f8aa4", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#eef7fd" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ background: "#0c151f", border: "1px solid #1a2a3a", borderRadius: 22, padding: 18 }}>
              <div style={{ fontSize: 11, color: "#7291ad", fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>
                Slotted players
              </div>
              {[
                ["Forwards", groupedRows("forwards")],
                ["Defense", groupedRows("defense")],
                ["Goalies", groupedRows("goalies")],
              ].map(([label, groupRows]) => (
                <div key={label} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, color: "#d3e8f8", fontWeight: 800, marginBottom: 8 }}>{label}</div>
                  {groupRows.length ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      {groupRows.map((player) => (
                        <div key={`${player.lineKey}.${player.slotKey}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", paddingBottom: 8, borderBottom: "1px solid #132232" }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#eff7fd" }}>
                              {player.lineKey} {player.slotKey} · {player.name}
                            </div>
                            <div style={{ marginTop: 3, fontSize: 10, color: getExpiryTone(player.contractExpiry), fontFamily: "'DM Mono',monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                              {player.position || "—"} · EXP {player.contractExpiry || "—"} · WAR {formatWar(player.war)}
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: "#b8d3e9", fontFamily: "'DM Mono',monospace" }}>
                            {formatCapHit(player.capHit)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: "#7f97ad", fontSize: 13 }}>No {String(label).toLowerCase()} added yet.</div>
                  )}
                </div>
              ))}
            </div>

            <button
              onClick={copyShareableLink}
              style={{
                width: "100%",
                padding: "13px 16px",
                borderRadius: 16,
                border: "1px solid #24506d",
                background: "#12304a",
                color: "#d9efff",
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              {copied ? "Copied!" : "Copy shareable link"}
            </button>
          </div>
        </div>
      </div>

      <SlotPickerModal
        player={modalPlayer?.player}
        slots={modalPlayer?.slots || []}
        onAssign={handleAssignFromModal}
        onClose={() => setModalPlayer(null)}
      />

      {rosterToast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#0f2235",
            border: "1px solid #2fb4ff",
            color: "#9fd8ff",
            padding: "10px 20px",
            borderRadius: 999,
            fontSize: 13,
            fontFamily: "'DM Mono',monospace",
            zIndex: 9999,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
          }}
        >
          {rosterToast}
        </div>
      )}
    </div>
  );
}
