import { createServerClient } from "@/app/lib/supabase";
import { jsonError, jsonWithCache } from "@/app/lib/apiCache";

export const revalidate = 300;

const MISSING_SEASONS = ["17-18", "18-19", "19-20", "20-21", "21-22", "22-23"];

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get("id");

    if (!playerId) return jsonError("Missing player id", 400);

    const supabase = createServerClient();

    const [
      { data: careerStats },
      { data: recentSeasons },
      { data: historicalWarData },
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
        .from("historical_war")
        .select("player_id,season,war_pp,war_pk")
        .eq("player_id", playerId)
        .order("season"),
    ]);

    let playerInfo = null;
    const { data: activePlayer } = await supabase
      .from("players")
      .select(
        "player_id,full_name,position,team,headshot_url,jersey,percentiles,war_total,rapm_off,rapm_def,off_rating,def_rating,overall_rating"
      )
      .eq("player_id", playerId)
      .single();

    if (activePlayer) {
      playerInfo = activePlayer;
    } else {
      // Retired player — fetch from NHL API
      try {
        const r = await fetch(
          `https://api-web.nhle.com/v1/player/${playerId}/landing`,
          { next: { revalidate: 86400 } }
        );
        if (r.ok) {
          const d = await r.json();
          playerInfo = {
            player_id: playerId,
            full_name: `${d.firstName?.default || ""} ${d.lastName?.default || ""}`.trim(),
            position: d.position || null,
            team: d.currentTeamAbbrev || "Retired",
            headshot_url: d.headshot || null,
            jersey: d.sweaterNumber || null,
            percentiles: null,
            war_total: null,
            rapm_off: null,
            rapm_def: null,
            off_rating: null,
            def_rating: null,
            overall_rating: null,
            is_retired: true,
          };
        }
      } catch {}
    }

    // Build unified season map
    const seasonMap = {};

    // Index historical_war by season for quick lookup
    const warIdx = {};
    for (const row of historicalWarData || []) {
      warIdx[row.season] = row;
    }

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
        war_pp: warIdx[row.season]?.war_pp ?? null,
        war_pk: warIdx[row.season]?.war_pk ?? null,
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

    // Fill missing seasons 17-18 through 22-23 from NHL API game-log
    const missingSeasonsForPlayer = MISSING_SEASONS.filter((s) => !seasonMap[s]);

    if (missingSeasonsForPlayer.length > 0) {
      await Promise.all(
        missingSeasonsForPlayer.map(async (seasonLabel) => {
          const [start] = seasonLabel.split("-");
          const startYear = 2000 + parseInt(start);
          const nhlSeasonId = `${startYear}${startYear + 1}`;

          try {
            const r = await fetch(
              `https://api-web.nhle.com/v1/player/${playerId}/game-log/${nhlSeasonId}/2`,
              { next: { revalidate: 86400 } }
            );
            if (!r.ok) return;
            const d = await r.json();

            const games = d.gameLog || [];
            if (games.length === 0) return;

            const gp = games.length;
            const g = games.reduce((sum, gm) => sum + (gm.goals || 0), 0);
            const a = games.reduce((sum, gm) => sum + (gm.assists || 0), 0);
            const pts = g + a;
            const pts_per_82 =
              gp > 0 ? Math.round((pts / gp) * 82 * 10) / 10 : null;
            const toi_total = games.reduce((sum, gm) => {
              const [m, sec] = (gm.toi || "0:00").split(":").map(Number);
              return sum + m + sec / 60;
            }, 0);

            const teamCounts = {};
            games.forEach((gm) => {
              const t = gm.teamAbbrev || "";
              teamCounts[t] = (teamCounts[t] || 0) + 1;
            });
            const team =
              Object.entries(teamCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
              null;

            seasonMap[seasonLabel] = {
              season: seasonLabel,
              team,
              gp,
              g,
              a,
              pts,
              toi_total: Math.round(toi_total * 100) / 100,
              ixg: null,
              pts_per_82,
              war_total: null,
              war_ev_off: null,
              war_ev_def: null,
              war_pp: null,
              war_pk: null,
              xgf_pct: null,
            };
          } catch {
            // Season not found for this player — skip silently
          }
        })
      );
    }

    const seasons = Object.values(seasonMap).sort((a, b) =>
      a.season.localeCompare(b.season)
    );

    // Fetch birth year from NHL API for age curve
    let birthYear = null;
    try {
      const r = await fetch(
        `https://api-web.nhle.com/v1/player/${playerId}/landing`,
        { next: { revalidate: 86400 } }
      );
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

    // Fetch historical percentile ranks for season card
    const { data: histPercentiles } = await supabase
      .from("historical_percentiles")
      .select("season,rapm_off_pct,rapm_def_pct,war_total_pct,pts82_pct,goals_pct,ixg_pct,pp_war_pct,pk_war_pct")
      .eq("player_id", playerId);

    const pctMap = {};
    for (const row of (histPercentiles || [])) {
      pctMap[row.season] = row;
    }

    const seasonsWithPct = seasonsWithAge.map((s) => ({
      ...s,
      rapm_off_pct:  pctMap[s.season]?.rapm_off_pct  ?? null,
      rapm_def_pct:  pctMap[s.season]?.rapm_def_pct  ?? null,
      war_total_pct: pctMap[s.season]?.war_total_pct ?? null,
      pts82_pct:     pctMap[s.season]?.pts82_pct     ?? null,
      goals_pct:     pctMap[s.season]?.goals_pct     ?? null,
      ixg_pct:       pctMap[s.season]?.ixg_pct       ?? null,
      pp_war_pct:    pctMap[s.season]?.pp_war_pct    ?? null,
      pk_war_pct:    pctMap[s.season]?.pk_war_pct    ?? null,
    }));

    return jsonWithCache(
      { player: playerInfo, seasons: seasonsWithPct, birthYear },
      300
    );
  } catch (error) {
    return jsonError(error.message || "Failed to load player history", 500);
  }
}
