import { Suspense } from "react";
import Link from "next/link";
import { createServerClient } from "@/app/lib/supabase";
import TeamsSeasonFilter from "@/app/components/teams/TeamsSeasonFilter";

export const revalidate = 3600;

export const metadata = {
  title: "All Teams — NHL Analytics",
};

const CURRENT_SEASON = "25-26";
const SEASON_OPTIONS = ["25-26", "24-25", "23-24"];
const WAR_MODE_OPTIONS = [
  { value: "1y", label: "1-Year WAR", seasons: 1 },
  { value: "3y", label: "3-Year WAR", seasons: 3 },
  { value: "5y", label: "5-Year WAR", seasons: 5 },
];

const TEAM_FULL = {
  ANA: "Anaheim Ducks", BOS: "Boston Bruins", BUF: "Buffalo Sabres",
  CAR: "Carolina Hurricanes", CBJ: "Columbus Blue Jackets", CGY: "Calgary Flames",
  CHI: "Chicago Blackhawks", COL: "Colorado Avalanche", DAL: "Dallas Stars",
  DET: "Detroit Red Wings", EDM: "Edmonton Oilers", FLA: "Florida Panthers",
  LAK: "Los Angeles Kings", MIN: "Minnesota Wild", MTL: "Montréal Canadiens",
  NSH: "Nashville Predators", NJD: "New Jersey Devils", NYI: "New York Islanders",
  NYR: "New York Rangers", OTT: "Ottawa Senators", PHI: "Philadelphia Flyers",
  PIT: "Pittsburgh Penguins", SEA: "Seattle Kraken", SJS: "San Jose Sharks",
  STL: "St. Louis Blues", TBL: "Tampa Bay Lightning", TOR: "Toronto Maple Leafs",
  UTA: "Utah Hockey Club", VAN: "Vancouver Canucks", VGK: "Vegas Golden Knights",
  WPG: "Winnipeg Jets", WSH: "Washington Capitals",
};

const TEAM_COLOR = {
  ANA: "#F47A38", BOS: "#FFB81C", BUF: "#003087", CAR: "#CC0000",
  CBJ: "#002654", CGY: "#C8102E", CHI: "#CF0A2C", COL: "#6F263D", DAL: "#006847",
  DET: "#CE1126", EDM: "#FF4C00", FLA: "#C8102E", LAK: "#555555", MIN: "#154734",
  MTL: "#AF1E2D", NSH: "#FFB81C", NJD: "#CC0000", NYI: "#00539B", NYR: "#0038A8",
  OTT: "#C52032", PHI: "#F74902", PIT: "#CFC493", SEA: "#99D9D9", SJS: "#006D75",
  STL: "#002F87", TBL: "#002868", TOR: "#00205B", UTA: "#69B3E7", VAN: "#00843D",
  VGK: "#B4975A", WPG: "#041E42", WSH: "#C8102E",
};

const TEAM_BY_FULLNAME = Object.fromEntries(
  Object.entries(TEAM_FULL).map(([abbr, name]) => [name, abbr])
);

function logoUrl(abbr) {
  return `https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg`;
}

function pctColor(v) {
  if (v >= 85) return "#00e5a0";
  if (v >= 70) return "#f0c040";
  if (v >= 50) return "#f08040";
  return "#e05050";
}

function formatSeasonLabel(season) {
  return `20${season.slice(0, 2)}-${season.slice(3)}`;
}

function parseSeason(searchParams) {
  const raw = searchParams?.season;
  const season = Array.isArray(raw) ? raw[0] : raw;
  return SEASON_OPTIONS.includes(season) ? season : CURRENT_SEASON;
}

function parseWarMode(searchParams) {
  const raw = searchParams?.war;
  const warMode = Array.isArray(raw) ? raw[0] : raw;
  return WAR_MODE_OPTIONS.some((option) => option.value === warMode) ? warMode : "1y";
}

function getSeasonWindow(selectedSeason, warMode) {
  const count = WAR_MODE_OPTIONS.find((option) => option.value === warMode)?.seasons || 1;
  const startIndex = SEASON_OPTIONS.indexOf(selectedSeason);
  if (startIndex === -1) return [CURRENT_SEASON];
  return SEASON_OPTIONS.slice(startIndex, startIndex + count);
}

function computeSeasonWar(player) {
  const directWar = Number(player?.war_total);
  if (Number.isFinite(directWar)) return directWar;

  const componentKeys = [
    "war_ev_off",
    "war_ev_def",
    "war_pp",
    "war_pk",
    "war_shooting",
    "war_penalties",
  ];

  const componentValues = componentKeys
    .map((key) => Number(player?.[key]))
    .filter((value) => Number.isFinite(value));

  if (!componentValues.length) return null;
  return componentValues.reduce((sum, value) => sum + value, 0);
}

function seasonToId(season) {
  const start = `20${String(season).slice(0, 2)}`;
  const end = `20${String(season).slice(3, 5)}`;
  return `${start}${end}`;
}

function TeamsSeasonFilterFallback({ seasonLabel, warModeLabel }) {
  const boxStyle = {
    width: "100%",
    borderRadius: 12,
    border: "1px solid #213547",
    background: "#0f1823",
    color: "#e8f5ff",
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: "'Barlow Condensed',sans-serif",
  };

  const labelStyle = {
    color: "#5a7a99",
    fontSize: 10,
    fontFamily: "'DM Mono',monospace",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  };

  return (
    <>
      <div style={{ display: "grid", gap: 6, minWidth: 180 }}>
        <div style={labelStyle}>Season</div>
        <div style={boxStyle}>{seasonLabel}</div>
      </div>
      <div style={{ display: "grid", gap: 6, minWidth: 180 }}>
        <div style={labelStyle}>WAR Window</div>
        <div style={boxStyle}>{warModeLabel}</div>
      </div>
    </>
  );
}

async function fetchStandingsForSeason(season) {
  if (season === CURRENT_SEASON) {
    try {
      const res = await fetch("https://api-web.nhle.com/v1/standings/now", {
        next: { revalidate: 3600 },
      });
      if (!res.ok) return {};
      const data = await res.json();
      const map = {};
      for (const t of data.standings || []) {
        const abbr = typeof t.teamAbbrev === "object" ? t.teamAbbrev.default : t.teamAbbrev;
        if (!abbr) continue;
        map[abbr] = {
          wins: t.wins || 0,
          losses: t.losses || 0,
          otLosses: t.otLosses || 0,
          points: t.points || 0,
        };
      }
      return map;
    } catch {
      return {};
    }
  }

  try {
    const seasonExpr = encodeURIComponent(`seasonId=${seasonToId(season)} and gameTypeId=2`);
    const res = await fetch(`https://api.nhle.com/stats/rest/en/team/summary?cayenneExp=${seasonExpr}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return {};
    const data = await res.json();
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const map = {};
    for (const row of rows) {
      const abbr =
        row.teamAbbrevDefault ||
        row.teamAbbrev ||
        (typeof row.teamAbbrev === "object" ? row.teamAbbrev.default : null) ||
        TEAM_BY_FULLNAME[row.teamFullName];
      if (!abbr) continue;
      map[abbr] = {
        wins: row.wins ?? row.w ?? null,
        losses: row.losses ?? row.l ?? null,
        otLosses: row.otLosses ?? row.otl ?? row.overtimeLosses ?? null,
        points: row.points ?? row.pts ?? null,
      };
    }
    return map;
  } catch {
    return {};
  }
}

export default async function TeamsPage({ searchParams }) {
  const selectedSeason = parseSeason(searchParams);
  const selectedWarMode = parseWarMode(searchParams);
  const selectedWarConfig = WAR_MODE_OPTIONS.find((option) => option.value === selectedWarMode) || WAR_MODE_OPTIONS[0];
  const seasonWindow = getSeasonWindow(selectedSeason, selectedWarMode);
  const supabase = createServerClient();

  const [{ data: seasonPlayers }, { data: currentPlayers }, standings] = await Promise.all([
    supabase
      .from("player_seasons")
      .select("player_id,team,position,season,war_total,war_ev_off,war_ev_def,war_pp,war_pk,war_shooting,war_penalties")
      .in("season", seasonWindow),
    selectedSeason === CURRENT_SEASON
      ? supabase.from("players").select("player_id,team,position,overall_rating")
      : Promise.resolve({ data: [] }),
    fetchStandingsForSeason(selectedSeason),
  ]);

  const seasonTeamData = {};
  const currentRatingData = {};

  for (const abbr of Object.keys(TEAM_FULL)) {
    seasonTeamData[abbr] = { war: 0, playerCount: 0, contributingSeasons: new Set() };
    currentRatingData[abbr] = { ratingSum: 0, ratingCount: 0 };
  }

  for (const player of seasonPlayers || []) {
    const abbr = player.team;
    if (!abbr || !seasonTeamData[abbr]) continue;

    if (player.season === selectedSeason) {
      seasonTeamData[abbr].playerCount += 1;
    }

    const seasonWar = computeSeasonWar(player);
    if (seasonWar != null) {
      seasonTeamData[abbr].war += seasonWar;
      seasonTeamData[abbr].contributingSeasons.add(player.season);
    }
  }

  for (const player of currentPlayers || []) {
    const abbr = player.team;
    if (!abbr || !currentRatingData[abbr]) continue;
    if (player.overall_rating != null && player.position !== "G") {
      currentRatingData[abbr].ratingSum += Number(player.overall_rating);
      currentRatingData[abbr].ratingCount += 1;
    }
  }

  const teams = Object.entries(TEAM_FULL)
    .map(([abbr, name]) => {
      const seasonData = seasonTeamData[abbr] || { war: 0, playerCount: 0, contributingSeasons: new Set() };
      const ratingData = currentRatingData[abbr] || { ratingSum: 0, ratingCount: 0 };
      const record = standings[abbr] || null;

      return {
        abbr,
        name,
        war: Number(seasonData.war.toFixed(1)),
        avgRating:
          selectedSeason === CURRENT_SEASON && ratingData.ratingCount > 0
            ? Number((ratingData.ratingSum / ratingData.ratingCount).toFixed(1))
            : null,
        playerCount: seasonData.playerCount,
        record,
        color: TEAM_COLOR[abbr] || "#4a6a88",
        contributingSeasons: seasonData.contributingSeasons.size,
      };
    })
    .sort((a, b) => b.war - a.war || b.playerCount - a.playerCount || a.name.localeCompare(b.name));

  const seasonLabel = formatSeasonLabel(selectedSeason);
  const warModeLabel = selectedWarConfig.label;
  const seasonOptions = SEASON_OPTIONS.map((season) => ({
    value: season,
    label: formatSeasonLabel(season),
  }));
  const partialWindow = seasonWindow.length < selectedWarConfig.seasons;

  if (process.env.NODE_ENV !== "production") {
    const debugTeams = ["TOR", "FLA", "EDM"].map((abbr) => ({
      team: abbr,
      selectedSeason,
      selectedWarMode,
      seasonWindow,
      rawTeamInputs: (seasonPlayers || [])
        .filter((player) => player.team === abbr)
        .slice(0, 5)
        .map((player) => ({
          season: player.season,
          war_total: player.war_total,
          war_ev_off: player.war_ev_off,
          war_ev_def: player.war_ev_def,
          computedWar: computeSeasonWar(player),
        })),
      computedTeamWar: teams.find((team) => team.abbr === abbr)?.war ?? null,
    }));
    console.log("[teams-page] war debug", JSON.stringify(debugTeams));
    console.log("[teams-page] sorted order", JSON.stringify(teams.slice(0, 8).map((team) => ({
      abbr: team.abbr,
      war: team.war,
      playerCount: team.playerCount,
    }))));
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 20% 20%,#0d1e30 0%,#05090f 60%)",
        padding: "32px 20px 60px",
        fontFamily: "'Barlow Condensed',sans-serif",
      }}
    >
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        .team-card:hover { transform: translateY(-2px); box-shadow: var(--hover-shadow) !important; }
        .team-card { transition: transform 0.18s, box-shadow 0.18s; }
        @media (max-width: 720px) {
          .teams-page-header {
            text-align: left !important;
          }
          .teams-page-toolbar {
            justify-content: stretch !important;
          }
        }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div
          className="teams-page-header"
          style={{
            marginBottom: 28,
            display: "grid",
            gap: 18,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontSize: 11,
                color: "#2a5070",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                fontFamily: "'DM Mono',monospace",
                marginBottom: 8,
              }}
            >
              NHL Analytics
            </div>
            <h1
              style={{
                fontSize: 42,
                fontWeight: 900,
                color: "#e8f4ff",
                letterSpacing: "-0.5px",
                lineHeight: 1,
                margin: 0,
              }}
            >
              All Teams
            </h1>
            <div
              style={{
                fontSize: 12,
                color: "#2a4060",
                fontFamily: "'DM Mono',monospace",
                marginTop: 6,
              }}
            >
              Ranked by {warModeLabel} · {seasonLabel} Season
            </div>
            {partialWindow ? (
              <div
                style={{
                  fontSize: 10,
                  color: "#4d6f8d",
                  fontFamily: "'DM Mono',monospace",
                  marginTop: 6,
                }}
              >
                Using available seasons only ({seasonWindow.map(formatSeasonLabel).join(" + ")})
              </div>
            ) : null}
          </div>

          <div
            className="teams-page-toolbar"
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                borderRadius: 16,
                border: "1px solid #17283b",
                background: "#091017",
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <Suspense
                fallback={
                  <TeamsSeasonFilterFallback
                    seasonLabel={seasonLabel}
                    warModeLabel={warModeLabel}
                  />
                }
              >
                <TeamsSeasonFilter
                  seasonOptions={seasonOptions}
                  seasonValue={selectedSeason}
                  warModeOptions={WAR_MODE_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  warModeValue={selectedWarMode}
                />
              </Suspense>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {teams.map((team, idx) => {
            const rec = team.record;
            const hasRecord = rec && rec.wins != null && rec.losses != null && rec.otLosses != null;
            const hasPoints = rec && rec.points != null;
            const recordStr = hasRecord ? `${rec.wins}-${rec.losses}-${rec.otLosses}` : "—";
            const pts = hasPoints ? `${rec.points} pts` : null;
            const rankLabel = `#${idx + 1}`;
            const topTen = idx < 10;

            return (
              <Link
                key={team.abbr}
                href={`/team/${team.abbr}?season=${selectedSeason}&war=${selectedWarMode}`}
                className="team-card"
                style={{
                  display: "block",
                  textDecoration: "none",
                  background: "#0a1218",
                  border: `1px solid ${team.color}22`,
                  borderRadius: 12,
                  padding: "16px",
                  "--hover-shadow": `0 8px 24px ${team.color}33`,
                  boxShadow: "none",
                  animation: `fadeUp 0.3s ease ${idx * 0.02}s both`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 24,
                      fontSize: 11,
                      color: topTen ? team.color : "#2a4060",
                      fontFamily: "'DM Mono',monospace",
                      fontWeight: 700,
                      textAlign: "right",
                      flexShrink: 0,
                    }}
                  >
                    {rankLabel}
                  </div>

                  <div
                    style={{
                      width: 44,
                      height: 44,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoUrl(team.abbr)}
                      alt={team.abbr}
                      width={44}
                      height={44}
                      style={{ objectFit: "contain" }}
                    />
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: "#e8f4ff",
                        fontFamily: "'Barlow Condensed',sans-serif",
                        lineHeight: 1.2,
                      }}
                    >
                      {team.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#4a6a88",
                        fontFamily: "'DM Mono',monospace",
                        marginTop: 2,
                      }}
                    >
                      {recordStr}
                      {pts ? ` · ${pts}` : ""}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, borderTop: "1px solid #0d1825", paddingTop: 10 }}>
                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 900,
                        lineHeight: 1,
                        color:
                          team.war > 30
                            ? "#00e5a0"
                            : team.war > 15
                              ? "#f0c040"
                              : team.war > 0
                                ? "#f08040"
                                : "#e05050",
                        fontFamily: "'Barlow Condensed',sans-serif",
                      }}
                    >
                      {team.war > 0 ? `+${team.war}` : team.war}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "#3a5a78",
                        marginTop: 2,
                        fontFamily: "'DM Mono',monospace",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {warModeLabel}
                    </div>
                  </div>

                  <div
                    style={{
                      width: 1,
                      background: "#12202e",
                    }}
                  />

                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 900,
                        lineHeight: 1,
                        color: pctColor(team.avgRating ?? 0),
                        fontFamily: "'Barlow Condensed',sans-serif",
                      }}
                    >
                      {team.avgRating != null ? Math.round(team.avgRating) : "—"}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "#3a5a78",
                        marginTop: 2,
                        fontFamily: "'DM Mono',monospace",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      Avg Rating
                    </div>
                  </div>

                  <div
                    style={{
                      width: 1,
                      background: "#12202e",
                    }}
                  />

                  <div style={{ flex: 1, textAlign: "center" }}>
                    <div
                      style={{
                        fontSize: 20,
                        fontWeight: 900,
                        lineHeight: 1,
                        color: "#9bdcff",
                        fontFamily: "'Barlow Condensed',sans-serif",
                      }}
                    >
                      {team.playerCount}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "#3a5a78",
                        marginTop: 2,
                        fontFamily: "'DM Mono',monospace",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      Players
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
