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

function sanePpp(ppp, points, gp, playerGp) {
  const pppValue = toNumber(ppp, null);
  const pointsValue = toNumber(points, null);
  const seasonGp = toNumber(gp, null);
  const playerGames = toNumber(playerGp, null);

  if (pppValue == null) return null;
  // A player CAN have more PP points than games played (e.g. 2-point PP nights),
  // so the old pppValue > seasonGp guard was incorrect and has been removed.
  if (pointsValue != null && pppValue > pointsValue) return null;
  if (playerGames != null && playerGames > 0 && seasonGp != null && Math.abs(playerGames - seasonGp) > 3) return null;
  return pppValue;
}

function firstFinite(...values) {
  for (const value of values) {
    const numeric = toNumber(value, null);
    if (numeric != null) return numeric;
  }
  return null;
}

export async function GET() {
  try {
    const supabase = createServerClient();

    const { data: seasonRows, error: seasonError } = await supabase
      .from("player_seasons")
      .select("player_id,team,gp,g,a1,a2,ixg,hits,blk,icf,iff,toi,toi_pp,war_total,gva,tka,fow,fol")
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

        const position = player.position || null;
        const isGoalie = String(position).toUpperCase() === "G";
        const assists = (toNumber(row.a1, 0) || 0) + (toNumber(row.a2, 0) || 0);
        const goals = toNumber(row.g, toNumber(player.g, null));
        const gp = toNumber(row.gp, toNumber(player.gp, null));
        const points = toNumber(row.pts, null) ?? (
          Number.isFinite(goals) && Number.isFinite(assists) ? goals + assists : null
        );
        const shots = toNumber(row.iff, toNumber(row.icf, toNumber(player.iff, toNumber(player.icf, null))));
        const hits = toNumber(row.hits, toNumber(player.hits, null));
        const blocks = toNumber(row.blk, toNumber(player.blk, null));
        const takeaways = toNumber(row.tka, firstFinite(player.tka, player.takeaways));
        const giveaways = toNumber(row.gva, firstFinite(player.gva, player.giveaways));
        const faceoffWins = toNumber(row.fow, firstFinite(player.fow, player.faceoff_wins, player.faceoffs_won));
        const faceoffLosses = toNumber(row.fol, firstFinite(player.fol, player.faceoff_losses, player.faceoffs_lost));
        const fwPct =
          faceoffWins != null && faceoffLosses != null && faceoffWins + faceoffLosses > 0
            ? faceoffWins / (faceoffWins + faceoffLosses)
            : firstFinite(player.fw_pct, player.faceoff_win_pct, player.faceoff_pct);
        const shp = !isGoalie
          ? firstFinite(
              row.shp,
              player.shp,
              player.short_handed_points,
              player.shortHandedPoints
            )
          : null;
        const ppp = !isGoalie
          ? sanePpp(player.ppp, points ?? player.pts, gp, player.gp)
          : null;
        const wins = isGoalie ? toNumber(player.wins, null) : null;
        const goalsAgainst = isGoalie ? toNumber(player.goals_against, null) : null;
        const shotsAgainst = isGoalie ? toNumber(player.shots_against, null) : null;
        const saves = isGoalie && shotsAgainst != null && goalsAgainst != null
          ? Math.max(shotsAgainst - goalsAgainst, 0)
          : null;
        const shutouts = isGoalie ? toNumber(player.shutouts, null) : null;
        const qualityStarts = isGoalie
          ? firstFinite(player.qs, player.quality_starts, player.qualityStarts)
          : null;
        const savePct = isGoalie
          ? toNumber(player.save_pct, saves != null && goalsAgainst != null && saves + goalsAgainst > 0 ? saves / (saves + goalsAgainst) : null)
          : null;
        const gaa = isGoalie ? toNumber(player.gaa, gp > 0 && goalsAgainst != null ? goalsAgainst / gp : null) : null;

        return {
          player_id: String(row.player_id),
          player_name: player.full_name,
          team: row.team || player.team || null,
          position,
          cap_hit: toNumber(player.contract_info?.cap_hit ?? player.cap_hit, null),
          contract_expiry: toNumber(player.contract_info?.expiry ?? player.contract_expiry, null),
          war: toNumber(row.war_total, null),
          overall_rating: toNumber(player.overall_rating, null),
          off_rating: toNumber(player.off_rating, null),
          def_rating: toNumber(player.def_rating, null),
          gp,
          goals,
          assists,
          points,
          shots,
          hits,
          blocks,
          shp,
          takeaways,
          giveaways,
          faceoffWins,
          faceoffLosses,
          fwPct,
          ixg: toNumber(row.ixg, null),
          ppp,
          ppToi: firstFinite(row.toi_pp, player.toi_pp, player.pp_toi),
          wins,
          saves,
          goalsAgainst,
          shotsAgainst,
          shutouts,
          qualityStarts,
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
