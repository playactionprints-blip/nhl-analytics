export const NHL_LOTTERY_RULES = {
  seasonLabel: "2026 NHL Draft Lottery",
  lotteryTeamCount: 16,
  drawCount: 2,
  maxJump: 10,
  oddsByRank: [
    18.5, 13.5, 11.5, 9.5, 8.5, 7.5, 6.5, 6.0,
    5.0, 3.5, 3.0, 2.5, 2.0, 1.5, 0.5, 0.5,
  ],
  summarySimulationCount: 100,
};

export const LOTTERY_ASSUMPTIONS = [
  "Two lottery drawings determine the top two picks.",
  "A team can move up a maximum of 10 spots in a drawing.",
  "The weighted odds table is configurable and currently uses the standard 16-team NHL-style distribution.",
  "Teams outside the allowed jump range are excluded from a specific drawing.",
  "Traded picks and protected picks are not active yet, but the data model already supports ownership and protection metadata.",
];
