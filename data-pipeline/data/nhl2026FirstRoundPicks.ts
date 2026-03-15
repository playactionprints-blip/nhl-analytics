// data/nhl2026FirstRoundPicks.ts

export type TeamCode =
  | "ANA" | "BOS" | "BUF" | "CGY" | "CAR" | "CHI" | "COL" | "CBJ"
  | "DAL" | "DET" | "EDM" | "FLA" | "LAK" | "MIN" | "MTL" | "NSH"
  | "NJD" | "NYI" | "NYR" | "OTT" | "PHI" | "PIT" | "SJS" | "SEA"
  | "STL" | "TBL" | "TOR" | "UTA" | "VAN" | "VGK" | "WSH" | "WPG";

export type PickConditionType =
  | "none"
  | "top_n_protected"
  | "convey_only_if_team_finishes_outside_bottom_n"
  | "fixed_slot_nontradeable"
  | "manual_review";

export interface PickCondition {
  type: PickConditionType;
  description: string;
  value?: number;
  affectedTeam?: TeamCode;
  ifTriggered?: {
    action:
      | "retain_by_original_team"
      | "convey_to_current_owner"
      | "set_fixed_slot"
      | "manual_review";
    slot?: number;
    nextSeason?: number;
    nextRound?: number;
  };
  ifNotTriggered?: {
    action:
      | "retain_by_original_team"
      | "convey_to_current_owner"
      | "manual_review";
  };
}

export interface FirstRoundPickAsset {
  id: string;                 // e.g. "2026-R1-TOR"
  season: 2026;
  round: 1;
  originalTeam: TeamCode;     // team whose standings/lottery slot determines draft position
  currentOwner: TeamCode;     // team currently entitled to the selection if conveyed
  isLotteryEligibleOriginalTeam?: boolean;
  isTradeable?: boolean;
  isStaticSlot?: boolean;
  staticSlot?: number;
  source: "DailyFaceoff" | "Reuters" | "Mixed";
  verificationStatus: "article_snapshot" | "needs_primary_source_check" | "verified_news_update";
  notes?: string;
  conditions: PickCondition[];
}

export const nhl2026FirstRoundPicks: FirstRoundPickAsset[] = [
  {
    id: "2026-R1-ANA",
    season: 2026,
    round: 1,
    originalTeam: "ANA",
    currentOwner: "ANA",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    notes: "Anaheim listed with its own 2026 1st.",
    conditions: [],
  },
  {
    id: "2026-R1-BOS",
    season: 2026,
    round: 1,
    originalTeam: "BOS",
    currentOwner: "BOS",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-BUF",
    season: 2026,
    round: 1,
    originalTeam: "BUF",
    currentOwner: "BUF",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-CGY",
    season: 2026,
    round: 1,
    originalTeam: "CGY",
    currentOwner: "CGY",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-CAR",
    season: 2026,
    round: 1,
    originalTeam: "CAR",
    currentOwner: "CAR",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-CHI",
    season: 2026,
    round: 1,
    originalTeam: "CHI",
    currentOwner: "CHI",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-CBJ",
    season: 2026,
    round: 1,
    originalTeam: "CBJ",
    currentOwner: "CBJ",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-COL",
    season: 2026,
    round: 1,
    originalTeam: "COL",
    currentOwner: "NYI",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    notes: "Islanders listed with Colorado's 2026 1st.",
    conditions: [],
  },
  {
    id: "2026-R1-DAL",
    season: 2026,
    round: 1,
    originalTeam: "DAL",
    currentOwner: "CAR",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    notes: "Carolina listed with Dallas's 2026 1st.",
    conditions: [],
  },
  {
    id: "2026-R1-DET",
    season: 2026,
    round: 1,
    originalTeam: "DET",
    currentOwner: "DET",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-EDM",
    season: 2026,
    round: 1,
    originalTeam: "EDM",
    currentOwner: "SJS",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "needs_primary_source_check",
    notes: "San Jose listed with Edmonton's 2026 1st; article says top-12 protected.",
    conditions: [
      {
        type: "top_n_protected",
        description: "Top-12 protected",
        value: 12,
        affectedTeam: "EDM",
        ifTriggered: {
          action: "retain_by_original_team",
        },
        ifNotTriggered: {
          action: "convey_to_current_owner",
        },
      },
    ],
  },
  {
    id: "2026-R1-FLA",
    season: 2026,
    round: 1,
    originalTeam: "FLA",
    currentOwner: "CHI",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "needs_primary_source_check",
    notes: "Chicago listed with Florida's 2026 1st only if Florida finishes outside the bottom 10.",
    conditions: [
      {
        type: "convey_only_if_team_finishes_outside_bottom_n",
        description: "Conveys only if Florida finishes outside the bottom 10",
        value: 10,
        affectedTeam: "FLA",
        ifTriggered: {
          action: "convey_to_current_owner",
        },
        ifNotTriggered: {
          action: "retain_by_original_team",
        },
      },
    ],
  },
  {
    id: "2026-R1-LAK",
    season: 2026,
    round: 1,
    originalTeam: "LAK",
    currentOwner: "LAK",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-MIN",
    season: 2026,
    round: 1,
    originalTeam: "MIN",
    currentOwner: "VAN",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    notes: "Vancouver listed with Minnesota's 2026 1st.",
    conditions: [],
  },
  {
    id: "2026-R1-MTL",
    season: 2026,
    round: 1,
    originalTeam: "MTL",
    currentOwner: "MTL",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-NSH",
    season: 2026,
    round: 1,
    originalTeam: "NSH",
    currentOwner: "NSH",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-NJD",
    season: 2026,
    round: 1,
    originalTeam: "NJD",
    currentOwner: "NJD",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-NYI",
    season: 2026,
    round: 1,
    originalTeam: "NYI",
    currentOwner: "NYI",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-NYR",
    season: 2026,
    round: 1,
    originalTeam: "NYR",
    currentOwner: "NYR",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-OTT",
    season: 2026,
    round: 1,
    originalTeam: "OTT",
    currentOwner: "OTT",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: false,
    isStaticSlot: true,
    staticSlot: 32,
    source: "Mixed",
    verificationStatus: "verified_news_update",
    notes: "Ottawa's 2026 pick is permanently rendered as static pick 32 and excluded from lottery ordering.",
    conditions: [
      {
        type: "fixed_slot_nontradeable",
        description: "Static pick 32; excluded from lottery and normal first-round ordering",
        affectedTeam: "OTT",
        ifTriggered: {
          action: "set_fixed_slot",
          slot: 32,
        },
      },
    ],
  },
  {
    id: "2026-R1-PHI",
    season: 2026,
    round: 1,
    originalTeam: "PHI",
    currentOwner: "PHI",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-PIT",
    season: 2026,
    round: 1,
    originalTeam: "PIT",
    currentOwner: "PIT",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-SJS",
    season: 2026,
    round: 1,
    originalTeam: "SJS",
    currentOwner: "SJS",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-SEA",
    season: 2026,
    round: 1,
    originalTeam: "SEA",
    currentOwner: "SEA",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-STL",
    season: 2026,
    round: 1,
    originalTeam: "STL",
    currentOwner: "STL",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-TBL",
    season: 2026,
    round: 1,
    originalTeam: "TBL",
    currentOwner: "SEA",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    notes: "Seattle listed with Tampa Bay's 2026 1st.",
    conditions: [],
  },
  {
    id: "2026-R1-TOR",
    season: 2026,
    round: 1,
    originalTeam: "TOR",
    currentOwner: "BOS",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "needs_primary_source_check",
    notes: "Boston listed with Toronto's 2026 1st; article says top-5 protected.",
    conditions: [
      {
        type: "top_n_protected",
        description: "Top-5 protected",
        value: 5,
        affectedTeam: "TOR",
        ifTriggered: {
          action: "manual_review",
          nextSeason: 2027,
          nextRound: 1,
        },
        ifNotTriggered: {
          action: "convey_to_current_owner",
        },
      },
    ],
  },
  {
    id: "2026-R1-UTA",
    season: 2026,
    round: 1,
    originalTeam: "UTA",
    currentOwner: "UTA",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-VAN",
    season: 2026,
    round: 1,
    originalTeam: "VAN",
    currentOwner: "VAN",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-VGK",
    season: 2026,
    round: 1,
    originalTeam: "VGK",
    currentOwner: "CGY",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    notes: "Calgary listed with Vegas's 2026 1st.",
    conditions: [],
  },
  {
    id: "2026-R1-WSH",
    season: 2026,
    round: 1,
    originalTeam: "WSH",
    currentOwner: "WSH",
    isLotteryEligibleOriginalTeam: false,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
  {
    id: "2026-R1-WPG",
    season: 2026,
    round: 1,
    originalTeam: "WPG",
    currentOwner: "WPG",
    isLotteryEligibleOriginalTeam: true,
    isTradeable: true,
    source: "DailyFaceoff",
    verificationStatus: "article_snapshot",
    conditions: [],
  },
];