import LotterySimulator from "@/LotterySimulator";
import { NHL_LOTTERY_RULES } from "@/app/lib/lotteryConfig";
import { buildLotteryEntriesFromStandings, sortStandingsForLotteryOrder } from "@/app/lib/lotteryEngine";
import { createServerClient } from "@/app/lib/supabase";
import { TEAM_FULL } from "@/app/lib/nhlTeams";
import { applyRuntimePickOverrides } from "@/app/lib/lotteryRuntime";
import {
  getOriginalFirstRoundPick,
  getStaticSpecialSlots,
  nhl2026FirstRoundPicks,
} from "@/app/lib/nhl2026PickLedger";

export const revalidate = 3600;

export const metadata = {
  title: "NHL Lottery Simulator — NHL Analytics",
  description: "Interactive NHL Draft Lottery simulator with configurable draw rules and future pick-protection support.",
};

function normalizeStandingsRow(row) {
  const abbr = typeof row.teamAbbrev === "object" ? row.teamAbbrev.default : row.teamAbbrev;
  const l10Wins = row.l10Wins ?? row.last10Wins ?? row.last10?.wins ?? row.last10Record?.wins ?? null;
  const l10Losses = row.l10Losses ?? row.last10Losses ?? row.last10?.losses ?? row.last10Record?.losses ?? null;
  const l10OtLosses = row.l10OtLosses ?? row.last10OtLosses ?? row.last10?.otLosses ?? row.last10Record?.otLosses ?? null;
  const last10Record =
    l10Wins === null || l10Losses === null || l10OtLosses === null
      ? "—"
      : `${l10Wins}-${l10Losses}-${l10OtLosses}`;

  return {
    abbr,
    name: TEAM_FULL[abbr] || (typeof row.teamName === "object" ? row.teamName.default : row.teamName) || abbr,
    points: row.points || 0,
    gamesPlayed: row.gamesPlayed || 0,
    pointPct: row.pointPctg ?? row.pointPct ?? ((row.points || 0) / Math.max(1, (row.gamesPlayed || 0) * 2)),
    regulationWins: row.regulationWins || row.regPlusOtWins || 0,
    goalDiff: row.goalDifferential || 0,
    last10Record,
  };
}

async function fetchStandingsRows() {
  try {
    const response = await fetch("https://api-web.nhle.com/v1/standings/now", {
      next: { revalidate: 3600 },
    });
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return (data.standings || [])
      .map(normalizeStandingsRow)
      .filter((row) => row.abbr && TEAM_FULL[row.abbr]);
  } catch {
    return [];
  }
}

export default async function LotteryPage() {
  const supabase = createServerClient();
  const [
    standingsRows,
    { data: pickTrades },
    { data: pickProtections },
  ] = await Promise.all([
    fetchStandingsRows(),
    supabase
      .from("pick_trades")
      .select("original_team,current_owner,round,year,conditions")
      .eq("round", 1)
      .eq("year", 2026),
    supabase
      .from("pick_protections")
      .select("team,round,year,protection_type,protected_threshold")
      .eq("round", 1)
      .eq("year", 2026),
  ]);
  const resolvedPickLedger = applyRuntimePickOverrides(
    nhl2026FirstRoundPicks,
    pickTrades || [],
    pickProtections || []
  );
  const staticTeams = new Set(getStaticSpecialSlots(resolvedPickLedger).map((pick) => pick.originalTeam));
  const orderableRows = sortStandingsForLotteryOrder(
    standingsRows.filter((row) => !staticTeams.has(row.abbr))
  );
  const lotteryRows = orderableRows.slice(0, NHL_LOTTERY_RULES.lotteryTeamCount);
  const nonLotteryRows = orderableRows.slice(NHL_LOTTERY_RULES.lotteryTeamCount);
  const entries = buildLotteryEntriesFromStandings(lotteryRows).map((entry) => {
    const asset = getOriginalFirstRoundPick(entry.originalTeam, resolvedPickLedger);
    return asset
      ? {
          ...entry,
          currentOwner: asset.currentOwner,
          notes: asset.notes || null,
          protectionRule: asset.conditions || null,
        }
      : entry;
  });
  const generatedAt = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());

  return (
    <LotterySimulator
      initialEntries={entries}
      nonLotteryOrder={nonLotteryRows.map((row) => row.abbr)}
      pickLedger={resolvedPickLedger}
      generatedAt={generatedAt}
    />
  );
}
