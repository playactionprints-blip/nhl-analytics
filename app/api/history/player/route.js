import { createServerClient } from "@/app/lib/supabase";
import { jsonError, jsonWithCache } from "@/app/lib/apiCache";

export const revalidate = 300;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get("id");

    if (!playerId) return jsonError("Missing player id", 400);

    const supabase = createServerClient();

    const [
      { data: careerStats },
      { data: recentSeasons },
      { data: playerInfo },
    ] = await Promise.all([
      supabase
        .from("career_stats")
        .select("*")
        .eq("player_id", playerId)
        .order("season"),
      supabase
        .from("player_seasons")
        .select(
          "player_id,season,gp,g,a1,a2,toi,ixg,war_total,war_ev_off,war_ev_def,war_pp,war_pk,xgf_pct,hdcf_pct"
        )
        .eq("player_id", playerId)
        .order("season"),
      supabase
        .from("players")
        .select(
          "player_id,full_name,position,team,headshot_url,jersey,percentiles,war_total,rapm_off,rapm_def,off_rating,def_rating,overall_rating"
        )
        .eq("player_id", playerId)
        .single(),
    ]);

    // Build unified season map
    const seasonMap = {};

    for (const row of careerStats || []) {
      seasonMap[row.season] = {
        season: row.season,
        team: row.team,
        gp: row.gp,
        g: row.g,
        a: row.a,
        pts: row.pts,
        toi_total: row.toi_total,
        ixg: row.ixg,
        pts_per_82: row.pts_per_82,
        war_total: null,
        war_ev_off: null,
        war_ev_def: null,
        war_pp: null,
        war_pk: null,
        xgf_pct: null,
      };
    }

    for (const row of recentSeasons || []) {
      const assists = (row.a1 || 0) + (row.a2 || 0);
      const pts = (row.g || 0) + assists;
      const gp = row.gp || 0;
      const pts_per_82 = gp > 0 ? Math.round((pts / gp) * 82 * 10) / 10 : null;

      if (seasonMap[row.season]) {
        seasonMap[row.season].war_total = row.war_total;
        seasonMap[row.season].war_ev_off = row.war_ev_off;
        seasonMap[row.season].war_ev_def = row.war_ev_def;
        seasonMap[row.season].war_pp = row.war_pp;
        seasonMap[row.season].war_pk = row.war_pk;
        seasonMap[row.season].xgf_pct = row.xgf_pct;
      } else {
        seasonMap[row.season] = {
          season: row.season,
          team: null,
          gp,
          g: row.g,
          a: assists,
          pts,
          toi_total: row.toi,
          ixg: row.ixg,
          pts_per_82,
          war_total: row.war_total,
          war_ev_off: row.war_ev_off,
          war_ev_def: row.war_ev_def,
          war_pp: row.war_pp,
          war_pk: row.war_pk,
          xgf_pct: row.xgf_pct,
        };
      }
    }

    const seasons = Object.values(seasonMap).sort((a, b) =>
      a.season.localeCompare(b.season)
    );

    // Fetch birth year from NHL API for age curve
    let birthYear = null;
    try {
      const r = await fetch(`https://api-web.nhle.com/v1/player/${playerId}/landing`, {
        next: { revalidate: 86400 },
      });
      if (r.ok) {
        const d = await r.json();
        birthYear = d.birthDate ? parseInt(d.birthDate.split("-")[0]) : null;
      }
    } catch {
      // age curve will be hidden
    }

    const seasonsWithAge = seasons.map((s) => {
      const startYear = 2000 + parseInt(s.season.split("-")[0]);
      const age = birthYear ? startYear - birthYear : null;
      return { ...s, age };
    });

    return jsonWithCache({ player: playerInfo, seasons: seasonsWithAge, birthYear }, 300);
  } catch (error) {
    return jsonError(error.message || "Failed to load player history", 500);
  }
}
