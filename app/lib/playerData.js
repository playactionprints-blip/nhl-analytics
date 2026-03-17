/**
 * Shared player-data loader for API routes, comparison payloads, and OG metadata.
 * Depends on Supabase players/player_seasons tables plus sync_log freshness data.
 */
import { createServerClient } from "@/app/lib/supabase";
import { getLastUpdatedForDataType } from "@/app/lib/syncStatus";

const CURRENT_SEASON = "25-26";
const PLAYER_SEASONS = ["25-26", "24-25", "23-24"];
const PLAYER_SEASON_COLUMNS = [
  "player_id",
  "season",
  "team",
  "gp",
  "g",
  "a1",
  "a2",
  "toi",
  "toi_5v5",
  "cf_pct",
  "xgf_pct",
  "hdcf_pct",
  "scf_pct",
  "rapm_off",
  "rapm_def",
  "war_total",
  "war_ev_off",
  "war_ev_def",
  "war_pp",
  "war_pk",
  "war_shooting",
  "war_penalties",
].join(",");

function toNumber(value, fallback = null) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function buildPercentilePayload(player) {
  const percentiles = player.percentiles || {};
  return {
    evOff: percentiles["EV Off"] ?? percentiles["RAPM Off"] ?? player.rapm_off_pct ?? null,
    evDef: percentiles["EV Def"] ?? percentiles["RAPM Def"] ?? player.rapm_def_pct ?? null,
    pp: percentiles["PP"] ?? null,
    pk: percentiles["PK"] ?? null,
    war: percentiles["WAR"] ?? percentiles["Overall"] ?? null,
    xgf: percentiles["xGF%"] ?? null,
    hdcf: percentiles["HDCF%"] ?? null,
    overall: percentiles["Overall"] ?? player.overall_rating ?? null,
    offRating: percentiles["Off Rating"] ?? player.off_rating ?? null,
    defRating: percentiles["Def Rating"] ?? player.def_rating ?? null,
  };
}

function buildCurrentSeasonPayload(player) {
  const assists = (player.a1 || 0) + (player.a2 || 0);
  return {
    gp: toNumber(player.gp, 0),
    g: toNumber(player.g, 0),
    a: toNumber(player.a, assists ?? 0),
    pts: toNumber(player.pts, toNumber(player.g, 0) + assists),
    plusMinus: toNumber(player.plus_minus ?? player.plusMinus, null),
    ppp: toNumber(player.ppp, null),
    toi: player.toi ?? null,
    capHit: toNumber(player.contract_info?.cap_hit ?? player.cap_hit ?? player.capHit, null),
  };
}

function buildWarPayload(player) {
  return {
    war3yr: toNumber(player.war_total, null),
    evOffWar: toNumber(player.war_ev_off, null),
    evDefWar: toNumber(player.war_ev_def, null),
    shootingWar: toNumber(player.war_shooting, null),
    penaltiesWar: toNumber(player.war_penalties, null),
  };
}

function buildRapmPayload(player) {
  return {
    rapmOff: toNumber(player.rapm_off, null),
    rapmDef: toNumber(player.rapm_def, null),
  };
}

function buildMetaPayload(player, seasonRows) {
  const warSampleGp = seasonRows.reduce((sum, row) => sum + (toNumber(row.gp, 0) || 0), 0);
  const currentSeasonRow = seasonRows.find((row) => row.season === CURRENT_SEASON);
  const currentSampleGp = toNumber(currentSeasonRow?.gp, toNumber(player.gp, 0) || 0) || 0;

  return {
    war_sample_gp: warSampleGp,
    rapm_provisional: currentSampleGp < 100,
  };
}

function buildPlayerResponse(player, seasonRows, lastUpdated) {
  return {
    id: String(player.player_id),
    playerId: String(player.player_id),
    name: player.full_name,
    team: player.team,
    position: player.position,
    jersey: player.jersey ?? null,
    headshotUrl: player.headshot_url ?? null,
    currentSeason: buildCurrentSeasonPayload(player),
    war: buildWarPayload(player),
    rapm: buildRapmPayload(player),
    percentiles: buildPercentilePayload(player),
    ratings: {
      overall: toNumber(player.overall_rating, null),
      offRating: toNumber(player.off_rating, null),
      defRating: toNumber(player.def_rating, null),
    },
    meta: buildMetaPayload(player, seasonRows),
    last_updated: lastUpdated,
    seasons: seasonRows,
    raw: player,
  };
}

export async function fetchPlayersPayload(playerIds, options = {}) {
  const supabase = options.supabase || createServerClient();
  const normalizedIds = [...new Set((playerIds || []).map((id) => String(id)).filter(Boolean))];
  if (!normalizedIds.length) return [];

  const [
    { data: players, error: playersError },
    { data: playerSeasons, error: playerSeasonsError },
  ] = await Promise.all([
    supabase.from("players").select("*").in("player_id", normalizedIds),
    supabase
      .from("player_seasons")
      .select(PLAYER_SEASON_COLUMNS)
      .in("player_id", normalizedIds)
      .in("season", PLAYER_SEASONS),
  ]);

  if (playersError) throw playersError;
  if (playerSeasonsError) throw playerSeasonsError;
  const lastUpdated = await getLastUpdatedForDataType(supabase, "players").catch(() => null);

  const seasonsByPlayer = (playerSeasons || []).reduce((acc, row) => {
    const key = String(row.player_id);
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  return (players || []).map((player) =>
    buildPlayerResponse(player, seasonsByPlayer[String(player.player_id)] || [], lastUpdated)
  );
}

export async function fetchPlayerPayload(playerId, options = {}) {
  const players = await fetchPlayersPayload([playerId], options);
  return players[0] || null;
}
