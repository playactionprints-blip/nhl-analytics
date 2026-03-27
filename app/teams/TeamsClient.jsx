"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import TeamsSeasonFilter from "@/app/components/teams/TeamsSeasonFilter";

const CURRENT_SEASON = "25-26";

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

const TEAM_ALIAS_MAP = {
  "L.A": "LAK",
  "N.J": "NJD",
  "S.J": "SJS",
  "T.B": "TBL",
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

function normalizeTeamCode(teamCode) {
  const raw = typeof teamCode === "object" ? teamCode?.default : teamCode;
  return TEAM_ALIAS_MAP[raw] || raw || null;
}

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

function formatSeasonShortLabel(season) {
  return season.replace("-", "/");
}

function parseSelectedSeasons(searchParams, availableSeasons) {
  const raw = searchParams?.get("seasons");

  if (!raw) {
    return availableSeasons.includes(CURRENT_SEASON)
      ? [CURRENT_SEASON]
      : availableSeasons.slice(0, 1);
  }

  const parsed = raw
    .split(",")
    .map((part) => part.trim())
    .filter((season) => availableSeasons.includes(season));

  const normalized = availableSeasons.filter((season) => parsed.includes(season));
  return normalized.length
    ? normalized
    : availableSeasons.includes(CURRENT_SEASON)
      ? [CURRENT_SEASON]
      : availableSeasons.slice(0, 1);
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

function buildSelectedSeasonSummary(selectedSeasons) {
  return selectedSeasons.map(formatSeasonLabel).reverse().join(" + ");
}

function buildWarLabel(selectedSeasons) {
  return `${selectedSeasons.length}-Year WAR`;
}

export default function TeamsClient({
  availableSeasons,
  seasonPlayers,
  currentPlayers,
  standingsBySeason,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedSeasons, setSelectedSeasons] = useState(
    parseSelectedSeasons(searchParams, availableSeasons)
  );

  useEffect(() => {
    setSelectedSeasons(parseSelectedSeasons(searchParams, availableSeasons));
  }, [searchParams, availableSeasons]);

  const seasonOptions = useMemo(
    () =>
      availableSeasons.map((season) => ({
        value: season,
        label: formatSeasonLabel(season),
        shortLabel: formatSeasonShortLabel(season),
      })),
    [availableSeasons]
  );

  const mostRecentSeason = selectedSeasons[0] || availableSeasons[0] || CURRENT_SEASON;

  const teams = useMemo(() => {
    const selectedSet = new Set(selectedSeasons);
    const seasonTeamData = {};
    const currentRatingData = {};

    for (const abbr of Object.keys(TEAM_FULL)) {
      seasonTeamData[abbr] = {
        war: 0,
        players: new Set(),
        debugBySeason: {},
      };
      currentRatingData[abbr] = { ratingSum: 0, ratingCount: 0 };
    }

    for (const player of seasonPlayers || []) {
      if (!selectedSet.has(player.season)) continue;
      const abbr = normalizeTeamCode(player.team);
      if (!abbr || !seasonTeamData[abbr]) continue;

      seasonTeamData[abbr].players.add(player.player_id);

      const seasonWar = computeSeasonWar(player);
      if (seasonWar != null) {
        seasonTeamData[abbr].war += seasonWar;
        if (!seasonTeamData[abbr].debugBySeason[player.season]) {
          seasonTeamData[abbr].debugBySeason[player.season] = 0;
        }
        seasonTeamData[abbr].debugBySeason[player.season] += seasonWar;
      }
    }

    for (const player of currentPlayers || []) {
      const abbr = normalizeTeamCode(player.team);
      if (!abbr || !currentRatingData[abbr]) continue;
      if (player.overall_rating != null && player.position !== "G") {
        currentRatingData[abbr].ratingSum += Number(player.overall_rating);
        currentRatingData[abbr].ratingCount += 1;
      }
    }

    const standings = standingsBySeason?.[mostRecentSeason] || {};

    const ranked = Object.entries(TEAM_FULL)
      .map(([abbr, name]) => {
        const seasonData = seasonTeamData[abbr] || { war: 0, players: new Set() };
        const ratingData = currentRatingData[abbr] || { ratingSum: 0, ratingCount: 0 };
        const record = standings[abbr] || null;

        return {
          abbr,
          name,
          war: Number(seasonData.war.toFixed(1)),
          avgRating:
            mostRecentSeason === CURRENT_SEASON && ratingData.ratingCount > 0
              ? Number((ratingData.ratingSum / ratingData.ratingCount).toFixed(1))
              : null,
          playerCount: seasonData.players.size,
          record,
          color: TEAM_COLOR[abbr] || "#4a6a88",
          debugBySeason: seasonData.debugBySeason,
        };
      })
      .sort((a, b) => b.war - a.war || b.playerCount - a.playerCount || a.name.localeCompare(b.name));

    if (process.env.NODE_ENV !== "production") {
      const debugTeams = ["FLA", "COL", "EDM"].map((abbr) => ({
        team: abbr,
        selectedSeasons,
        matchedRows: (seasonPlayers || [])
          .filter((player) => selectedSet.has(player.season) && normalizeTeamCode(player.team) === abbr)
          .slice(0, 8)
          .map((player) => ({
            season: player.season,
            team: player.team,
            war_total: player.war_total,
            computedWar: computeSeasonWar(player),
          })),
        perSeasonSubtotal: Object.fromEntries(
          Object.entries(ranked.find((team) => team.abbr === abbr)?.debugBySeason || {}).map(([season, value]) => [
            season,
            Number(value.toFixed(2)),
          ])
        ),
        aggregatedWar: ranked.find((team) => team.abbr === abbr)?.war ?? null,
        playerCount: ranked.find((team) => team.abbr === abbr)?.playerCount ?? null,
      }));

      console.log("[teams-client] selected seasons", JSON.stringify(selectedSeasons));
      console.log("[teams-client] war debug", JSON.stringify(debugTeams));
      console.log(
        "[teams-client] sorted top 10",
        JSON.stringify(ranked.slice(0, 10).map((team) => ({ abbr: team.abbr, war: team.war, players: team.playerCount })))
      );
    }

    return ranked;
  }, [selectedSeasons, seasonPlayers, currentPlayers, standingsBySeason, mostRecentSeason]);

  const seasonSummary = useMemo(() => buildSelectedSeasonSummary(selectedSeasons), [selectedSeasons]);
  const warLabel = useMemo(() => buildWarLabel(selectedSeasons), [selectedSeasons]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[teams-client] subtitle", `Ranked by ${warLabel} · ${seasonSummary}`);
    }
  }, [seasonSummary, warLabel]);

  function handleToggleSeason(season) {
    const next = selectedSeasons.includes(season)
      ? selectedSeasons.filter((value) => value !== season)
      : [...selectedSeasons, season];

    if (!next.length) return;

    const normalized = availableSeasons.filter((value) => next.includes(value));
    setSelectedSeasons(normalized);

    const params = new URLSearchParams(searchParams?.toString() || "");
    params.delete("season");
    params.delete("war");
    params.set("seasons", normalized.join(","));
    const query = params.toString();
    router.replace(query ? `/teams?${query}` : "/teams");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 20% 20%,#0d1e30 0%,var(--bg-primary) 60%)",
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
                color: "var(--text-muted)",
                fontFamily: "'DM Mono',monospace",
                marginTop: 6,
              }}
            >
              Ranked by {warLabel} · {seasonSummary}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#4d6f8d",
                fontFamily: "'DM Mono',monospace",
                marginTop: 6,
              }}
            >
              Record and points reflect the most recent selected season
            </div>
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
                border: "1px solid var(--border-strong)",
                background: "var(--bg-card)",
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <TeamsSeasonFilter
                seasonOptions={seasonOptions}
                selectedSeasons={selectedSeasons}
                onToggleSeason={handleToggleSeason}
              />
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
            const seasonsQuery = selectedSeasons.join(",");

            return (
              <Link
                key={team.abbr}
                href={`/team/${team.abbr}?season=${mostRecentSeason}&seasons=${seasonsQuery}`}
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
                      color: topTen ? team.color : "var(--text-muted)",
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
                      {warLabel}
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
