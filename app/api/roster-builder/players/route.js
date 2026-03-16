/**
 * Current-season player pool API for the roster builder.
 * Depends on Supabase player_seasons for season WAR/team snapshots and
 * players for names, ratings, and contract metadata used in roster building.
 */
import { NextResponse } from "next/server";
import { createServerClient } from "@/app/lib/supabase";
import { CURRENT_SEASON } from "@/app/components/roster-builder/rosterBuilderConfig";

export const revalidate = 300;

function cacheHeaders(seconds) {
  return {
    "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=60`,
  };
}

function jsonWithCache(payload, seconds, init = {}) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      ...cacheHeaders(seconds),
      ...(init.headers || {}),
    },
  });
}

function jsonError(message, status = 500) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: cacheHeaders(300),
    }
  );
}

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export async function GET() {
  try {
    const supabase = createServerClient();

    const { data: seasonRows, error: seasonError } = await supabase
      .from("player_seasons")
      .select("player_id,team,position,war_total")
      .eq("season", CURRENT_SEASON)
      .order("war_total", { ascending: false, nullsFirst: false });

    if (seasonError) throw seasonError;

    const ids = [...new Set((seasonRows || []).map((row) => row.player_id).filter(Boolean))];
    if (!ids.length) {
      return jsonWithCache([], 300);
    }

    const { data: players, error: playersError } = await supabase
      .from("players")
      .select("player_id,full_name,team,position,cap_hit,overall_rating,off_rating,def_rating,contract_info")
      .in("player_id", ids);

    if (playersError) throw playersError;

    const playerMap = Object.fromEntries((players || []).map((player) => [String(player.player_id), player]));

    const payload = (seasonRows || [])
      .map((row) => {
        const player = playerMap[String(row.player_id)];
        if (!player) return null;

        return {
          player_id: String(row.player_id),
          player_name: player.full_name,
          team: row.team || player.team || null,
          position: row.position || player.position || null,
          cap_hit: toNumber(player.contract_info?.cap_hit ?? player.cap_hit, null),
          contract_expiry: toNumber(player.contract_info?.expiry, null),
          war: toNumber(row.war_total, null),
          overall_rating: toNumber(player.overall_rating, null),
          off_rating: toNumber(player.off_rating, null),
          def_rating: toNumber(player.def_rating, null),
        };
      })
      .filter(Boolean);

    return jsonWithCache(payload, 300);
  } catch (error) {
    return jsonError(error.message || "Failed to load roster builder players");
  }
}
