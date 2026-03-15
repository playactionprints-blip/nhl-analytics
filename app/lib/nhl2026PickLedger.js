import { nhl2026FirstRoundPicks } from "@/data-pipeline/data/nhl2026FirstRoundPicks";

export { nhl2026FirstRoundPicks };

export function getOriginalFirstRoundPick(team, ledger = nhl2026FirstRoundPicks) {
  return ledger.find((pick) => pick.originalTeam === team) || null;
}

export function getTransferredFirstRoundPicks(ledger = nhl2026FirstRoundPicks) {
  return ledger.filter((pick) => pick.currentOwner !== pick.originalTeam);
}

export function isProtectedPick(pick) {
  return Boolean(
    pick?.conditions?.some((condition) =>
      ["top_n_protected", "convey_only_if_team_finishes_outside_bottom_n"].includes(condition.type)
    )
  );
}

export function isLotteryEligibleOriginalTeam(team, ledger = nhl2026FirstRoundPicks) {
  const pick = getOriginalFirstRoundPick(team, ledger);
  return Boolean(pick?.isLotteryEligibleOriginalTeam);
}

export function getStaticSpecialSlots(ledger = nhl2026FirstRoundPicks) {
  return ledger
    .filter(
      (pick) =>
        pick.isStaticSlot ||
        pick.conditions?.some((condition) => condition.type === "fixed_slot_nontradeable")
    )
    .sort((a, b) => (a.staticSlot || 999) - (b.staticSlot || 999));
}
