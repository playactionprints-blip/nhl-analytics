/**
 * Pure helpers for roster-builder URL state, slot validation, and summaries.
 * Depends on the rosterBuilderConfig constants and plain player objects.
 */
import {
  CURRENT_OFFSEASON_YEAR,
  DEFAULT_TEAM_NAME,
  EMPTY_ROSTER_STATE,
  ROSTER_SLOT_ORDER,
} from "@/app/components/roster-builder/rosterBuilderConfig";

export function cloneRosterState(state) {
  return JSON.parse(JSON.stringify(state || EMPTY_ROSTER_STATE));
}

export function createDefaultRosterState() {
  return cloneRosterState(EMPTY_ROSTER_STATE);
}

export function encodeRosterState(state) {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function decodeRosterState(encoded) {
  try {
    if (!encoded) return createDefaultRosterState();
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return normalizeRosterState(parsed);
  } catch {
    return createDefaultRosterState();
  }
}

export function normalizeRosterState(value) {
  const normalized = createDefaultRosterState();
  if (!value || typeof value !== "object") return normalized;

  normalized.teamName =
    typeof value.teamName === "string" && value.teamName.trim()
      ? value.teamName.trim()
      : DEFAULT_TEAM_NAME;

  for (const [lineKey, slots] of Object.entries(normalized.lines)) {
    const incomingSlots = value.lines?.[lineKey];
    if (!incomingSlots || typeof incomingSlots !== "object") continue;
    for (const slotKey of Object.keys(slots)) {
      const slotValue = incomingSlots[slotKey];
      slots[slotKey] = slotValue == null ? null : String(slotValue);
    }
  }

  return normalized;
}

export function isRosterEmpty(state) {
  return !ROSTER_SLOT_ORDER.some(([lineKey, slotKey]) => state.lines?.[lineKey]?.[slotKey]);
}

export function getSlotValue(state, lineKey, slotKey) {
  return state.lines?.[lineKey]?.[slotKey] ?? null;
}

export function setSlotValue(state, lineKey, slotKey, playerId) {
  const next = cloneRosterState(state);
  next.lines[lineKey][slotKey] = playerId == null ? null : String(playerId);
  return next;
}

export function clearPlayerFromRoster(state, playerId) {
  const next = cloneRosterState(state);
  for (const [lineKey, slotKey] of ROSTER_SLOT_ORDER) {
    if (next.lines[lineKey][slotKey] === String(playerId)) {
      next.lines[lineKey][slotKey] = null;
    }
  }
  return next;
}

export function findPlayerSlot(state, playerId) {
  const target = String(playerId);
  for (const [lineKey, slotKey] of ROSTER_SLOT_ORDER) {
    if (state.lines?.[lineKey]?.[slotKey] === target) {
      return { lineKey, slotKey };
    }
  }
  return null;
}

export function getAssignedPlayerIds(state) {
  const ids = new Set();
  for (const [lineKey, slotKey] of ROSTER_SLOT_ORDER) {
    const value = state.lines?.[lineKey]?.[slotKey];
    if (value) ids.add(String(value));
  }
  return ids;
}

export function slotGroupFor(lineKey, slotKey) {
  if (slotKey === "G") return "goalie";
  if (lineKey.startsWith("D")) return "defense";
  return "forward";
}

export function isValidPositionForSlot(playerPosition, lineKey, slotKey) {
  const pos = String(playerPosition || "").toUpperCase();
  const group = slotGroupFor(lineKey, slotKey);
  if (group === "goalie") return pos === "G";
  if (group === "defense") return pos === "D";
  return ["F", "C", "L", "LW", "R", "RW"].includes(pos);
}

export function slotRequirementLabel(lineKey, slotKey) {
  const group = slotGroupFor(lineKey, slotKey);
  if (group === "goalie") return "G";
  if (group === "defense") return "D";
  return "forward";
}

export function getAvailableEmptySlots(state, player) {
  return ROSTER_SLOT_ORDER.filter(([lineKey, slotKey]) => {
    const isEmpty = !state.lines?.[lineKey]?.[slotKey];
    return isEmpty && isValidPositionForSlot(player?.position, lineKey, slotKey);
  }).map(([lineKey, slotKey]) => ({
    lineKey,
    slotKey,
    key: `${lineKey}.${slotKey}`,
  }));
}

export function swapOrMovePlayer(state, source, target) {
  const next = cloneRosterState(state);
  const sourceValue = next.lines[source.lineKey][source.slotKey];
  const targetValue = next.lines[target.lineKey][target.slotKey];
  next.lines[target.lineKey][target.slotKey] = sourceValue;
  next.lines[source.lineKey][source.slotKey] = targetValue ?? null;
  return next;
}

export function removeSlotPlayer(state, slot) {
  return setSlotValue(state, slot.lineKey, slot.slotKey, null);
}

export function formatCapHit(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `$${(Number(value) / 1_000_000).toFixed(1)}M`;
}

export function formatWar(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toFixed(2);
}

export function getExpiryTone(expiryYear) {
  if (!expiryYear) return "#8398ab";
  if (Number(expiryYear) <= CURRENT_OFFSEASON_YEAR) return "#ff6a6a";
  if (Number(expiryYear) === CURRENT_OFFSEASON_YEAR + 1) return "#ffbf5f";
  return "#8398ab";
}

export function buildRosterSummary(state, playerMap) {
  const players = [];
  for (const [lineKey, slotKey] of ROSTER_SLOT_ORDER) {
    const playerId = state.lines?.[lineKey]?.[slotKey];
    if (!playerId) continue;
    const player = playerMap[String(playerId)];
    if (!player) continue;
    players.push({
      ...player,
      lineKey,
      slotKey,
    });
  }

  const totalCapCommitted = players.reduce((sum, player) => sum + (Number(player.capHit) || 0), 0);
  const totalWar = players.reduce((sum, player) => sum + (Number(player.war) || 0), 0);
  const avg = (field) => {
    if (!players.length) return null;
    const values = players
      .map((player) => Number(player[field]))
      .filter((value) => Number.isFinite(value));
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  return {
    players,
    totalCapCommitted,
    filledCount: players.length,
    totalWar,
    avgOvr: avg("overallRating"),
    avgOff: avg("offRating"),
    avgDef: avg("defRating"),
  };
}
