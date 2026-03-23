/**
 * Fantasy Hub player pool API.
 * Depends on Supabase player_seasons for current-season production and the
 * players table for names, positions, ratings, and current stat snapshots.
 */
import { createServerClient } from "@/app/lib/supabase";
import { jsonError, jsonWithCache } from "@/app/lib/apiCache";
import { CURRENT_SEASON } from "@/app/components/fantasy-hub/fantasyHubConfig";

export const revalidate = 300;

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export async function GET() {
  try {
    const supabase = createServerClient();

    const { data: seasonRows, error: seasonError } = await supabase
      .from("player_seasons")
      .select("player_id,team,gp,g,a1,a2,ixg,hits,blk,icf,iff,toi,war_total")
      .eq("season", CURRENT_SEASON)
      .order("war_total", { ascending: false, nullsFirst: false });

    if (seasonError) throw seasonError;

    const ids = [...new Set((seasonRows || []).map((row) => row.player_id).filter(Boolean))];
    if (!ids.length) return jsonWithCache([], 300);

    const allPlayers = [];
    const batchSize = 200;
    for (let index = 0; index < ids.length; index += batchSize) {
      const batch = ids.slice(index, index + batchSize);
      const { data: batchPlayers, error: playersError } = await supabase
        .from("players")
        .select("*")
        .in("player_id", batch);
      if (playersError) throw playersError;
      allPlayers.push(...(batchPlayers || []));
    }

    const playerMap = Object.fromEntries(allPlayers.map((player) => [String(player.player_id), player]));

    const payload = (seasonRows || [])
      .map((row) => {
        const player = playerMap[String(row.player_id)];
        if (!player) return null;

        const assists = (toNumber(row.a1, 0) || 0) + (toNumber(row.a2, 0) || 0);
        const goals = toNumber(row.g, toNumber(player.g, 0) || 0) || 0;
        const gp = toNumber(row.gp, toNumber(player.gp, 0) || 0) || 0;
        const shots = toNumber(player.shots, toNumber(row.iff, toNumber(row.icf, 0) || 0));
        const hits = toNumber(row.hits, toNumber(player.hits, 0));
        const blocks = toNumber(row.blk, toNumber(player.blk, 0));
        const ppp = toNumber(player.ppp, toNumber(player.ppg, 0) + toNumber(player.ppa, 0));
        const saves = toNumber(player.saves, 0);
        const wins = toNumber(player.wins, 0);
        const goalsAgainst = toNumber(player.goals_against, 0);
        const shutouts = toNumber(player.shutouts, 0);
        const savePct = saves + goalsAgainst > 0 ? saves / (saves + goalsAgainst) : null;
        const gaa = gp > 0 ? goalsAgainst / gp : null;

        return {
          player_id: String(row.player_id),
          player_name: player.full_name,
          team: row.team || player.team || null,
          position: player.position || null,
          cap_hit: toNumber(player.contract_info?.cap_hit ?? player.cap_hit, null),
          contract_expiry: toNumber(player.contract_info?.expiry ?? player.contract_expiry, null),
          war: toNumber(row.war_total, null),
          overall_rating: toNumber(player.overall_rating, null),
          off_rating: toNumber(player.off_rating, null),
          def_rating: toNumber(player.def_rating, null),
          gp,
          goals,
          assists,
          points: goals + assists,
          shots: toNumber(shots, 0),
          hits: toNumber(hits, 0),
          blocks: toNumber(blocks, 0),
          ixg: toNumber(row.ixg, null),
          ppp: toNumber(ppp, 0),
          wins,
          saves,
          goalsAgainst,
          shutouts,
          savePct,
          gaa,
          toi: row.toi ?? player.toi ?? null,
        };
      })
      .filter(Boolean);

    return jsonWithCache(payload, 300);
  } catch (error) {
    return jsonError(error.message || "Failed to load fantasy players", 500);
  }
}
