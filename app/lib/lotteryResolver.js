import {
  getOriginalFirstRoundPick,
  getStaticSpecialSlots,
  nhl2026FirstRoundPicks,
} from "@/app/lib/nhl2026PickLedger";

function normalizeTeamCode(item) {
  if (!item) return null;
  if (typeof item === "string") return item;
  return item.originalTeam || item.abbr || item.currentOwner || item.team || null;
}

function uniqueOrdered(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function buildConditionResult(condition, triggered, note) {
  return {
    type: condition.type,
    triggered,
    description: note || condition.description,
  };
}

function evaluatePickConditions(asset, slot) {
  let selectionOwner = asset.currentOwner;
  let notes = asset.notes ? [asset.notes] : [];
  let isSpecialSlot = Boolean(asset.isStaticSlot);
  let isStaticSlot = Boolean(asset.isStaticSlot);
  let isTradedPick = asset.currentOwner !== asset.originalTeam;
  let protectionTriggered = false;
  let requiresManualReview = false;
  let deferred = false;
  let resolvedSlot = slot;
  const conditionResults = [];

  for (const condition of asset.conditions || []) {
    switch (condition.type) {
      case "top_n_protected": {
        const limit = Number(condition.value || 0);
        const triggered = slot <= limit;
        conditionResults.push(
          buildConditionResult(
            condition,
            triggered,
            triggered
              ? `${condition.description} triggered at slot ${slot}`
              : `${condition.description} did not trigger at slot ${slot}`
          )
        );
        if (triggered) {
          protectionTriggered = true;
          deferred = true;
          const action = condition.ifTriggered?.action;
          if (action === "retain_by_original_team") {
            selectionOwner = asset.originalTeam;
          } else if (action === "manual_review") {
            selectionOwner = asset.originalTeam;
            requiresManualReview = true;
            notes.push(
              `Manual review: rollover/next-season handling may apply (${condition.ifTriggered?.nextSeason || "future"}-${condition.ifTriggered?.nextRound || "?"}).`
            );
          }
        } else if (condition.ifNotTriggered?.action === "convey_to_current_owner") {
          selectionOwner = asset.currentOwner;
        }
        break;
      }
      case "convey_only_if_team_finishes_outside_bottom_n": {
        const limit = Number(condition.value || 0);
        const triggered = slot > limit;
        conditionResults.push(
          buildConditionResult(
            condition,
            triggered,
            triggered
              ? `${condition.description} satisfied at slot ${slot}`
              : `${condition.description} blocked at slot ${slot}`
          )
        );
        if (triggered) {
          selectionOwner = asset.currentOwner;
        } else {
          selectionOwner = asset.originalTeam;
          protectionTriggered = true;
          deferred = true;
        }
        break;
      }
      case "fixed_slot_nontradeable": {
        const configuredSlot = Number(condition.ifTriggered?.slot || asset.staticSlot || resolvedSlot);
        resolvedSlot = configuredSlot;
        selectionOwner = asset.originalTeam;
        isSpecialSlot = true;
        isStaticSlot = true;
        isTradedPick = false;
        conditionResults.push(
          buildConditionResult(condition, true, `${condition.description} — fixed at slot ${configuredSlot}`)
        );
        break;
      }
      case "manual_review": {
        requiresManualReview = true;
        conditionResults.push(buildConditionResult(condition, true, condition.description));
        notes.push(condition.description);
        selectionOwner = asset.originalTeam;
        break;
      }
      default: {
        conditionResults.push(buildConditionResult(condition, false, condition.description));
        break;
      }
    }
  }

  return {
    selectionOwner,
    resolvedSlot,
    conditionResults,
    notes: notes.filter(Boolean).join(" "),
    isSpecialSlot,
    isStaticSlot,
    isTradedPick,
    protectionTriggered,
    requiresManualReview,
    deferred,
  };
}

function resolveStaticSlot(asset) {
  const evaluated = evaluatePickConditions(asset, asset.staticSlot || 32);
  return {
    slot: evaluated.resolvedSlot,
    originalTeam: asset.originalTeam,
    selectionOwner: asset.originalTeam,
    assetId: asset.id,
    conditionResults: evaluated.conditionResults,
    notes: evaluated.notes,
    isSpecialSlot: true,
    isStaticSlot: true,
    isTradedPick: false,
    protectionTriggered: false,
    requiresManualReview: evaluated.requiresManualReview,
    deferred: false,
    verificationStatus: asset.verificationStatus,
  };
}

export function resolve2026FirstRoundOrder({
  lotteryOrder,
  nonLotteryOrder,
  pickLedger = nhl2026FirstRoundPicks,
}) {
  const staticAssets = getStaticSpecialSlots(pickLedger);
  const staticTeams = new Set(staticAssets.map((pick) => pick.originalTeam));

  const orderedTeams = uniqueOrdered([
    ...(lotteryOrder || []).map(normalizeTeamCode),
    ...(nonLotteryOrder || []).map(normalizeTeamCode),
  ]).filter((team) => !staticTeams.has(team));

  const resolved = orderedTeams.map((team, index) => {
    const slot = index + 1;
    const asset =
      getOriginalFirstRoundPick(team, pickLedger) || {
        id: `2026-R1-${team}`,
        originalTeam: team,
        currentOwner: team,
        notes: "Fallback asset generated because the pick ledger had no explicit entry.",
        conditions: [],
        verificationStatus: "needs_primary_source_check",
      };

    const evaluated = evaluatePickConditions(asset, slot);
    return {
      slot: evaluated.resolvedSlot,
      originalTeam: asset.originalTeam,
      selectionOwner: evaluated.selectionOwner,
      assetId: asset.id,
      conditionResults: evaluated.conditionResults,
      notes: evaluated.notes,
      isSpecialSlot: evaluated.isSpecialSlot,
      isStaticSlot: evaluated.isStaticSlot,
      isTradedPick: evaluated.isTradedPick,
      protectionTriggered: evaluated.protectionTriggered,
      requiresManualReview: evaluated.requiresManualReview,
      deferred: evaluated.deferred,
      verificationStatus: asset.verificationStatus,
    };
  });

  for (const asset of staticAssets) {
    resolved.push(resolveStaticSlot(asset));
  }

  return resolved.sort((a, b) => a.slot - b.slot);
}
