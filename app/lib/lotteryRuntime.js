/**
 * Runtime lottery ledger helpers backed by Supabase pick_trades and
 * pick_protections tables. Depends on the existing file-based ledger and
 * merges DB-managed ownership/protection overrides without changing UI code.
 */
function normalizeThreshold(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function protectionTypeToCondition(protectionType, threshold) {
  if (!protectionType) return null;
  const normalizedType = String(protectionType).toLowerCase();
  if (normalizedType.startsWith("top-") || normalizedType.startsWith("top_")) {
    return {
      type: "top_n_protected",
      description: `Top-${threshold} protected`,
      value: threshold,
      ifTriggered: { action: "retain_by_original_team", nextSeason: 2027, nextRound: 1 },
      ifNotTriggered: { action: "convey_to_current_owner" },
    };
  }
  return null;
}

export function applyRuntimePickOverrides(pickLedger, pickTrades = [], pickProtections = []) {
  const tradeMap = new Map(
    (pickTrades || []).map((row) => [`${row.year}-${row.round}-${row.original_team}`, row])
  );
  const protectionMap = new Map(
    (pickProtections || []).map((row) => [`${row.year}-${row.round}-${row.team}`, row])
  );

  return (pickLedger || []).map((asset) => {
    const key = `${asset.season}-${asset.round}-${asset.originalTeam}`;
    const trade = tradeMap.get(key);
    const protection = protectionMap.get(key);
    const threshold = normalizeThreshold(protection?.protected_threshold);
    const protectionCondition = threshold
      ? protectionTypeToCondition(protection?.protection_type, threshold)
      : null;

    const baseConditions = [...(asset.conditions || [])];
    const nextConditions = protectionCondition
      ? [
          ...baseConditions.filter((condition) => condition.type !== protectionCondition.type),
          protectionCondition,
        ]
      : baseConditions;

    return {
      ...asset,
      currentOwner: trade?.current_owner || asset.currentOwner,
      notes: [asset.notes, trade?.conditions, protection?.protection_type].filter(Boolean).join(" · ") || undefined,
      conditions: nextConditions,
    };
  });
}
