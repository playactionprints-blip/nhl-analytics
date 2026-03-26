import { createServerClient } from "@/app/lib/supabase";
import { TEAM_COLOR } from "@/app/lib/nhlTeams";

const CURRENT_SEASON = "25-26";

const PS_COLS = "player_id,season,gp,toi,toi_5v5,g,a1,a2,ixg,icf,iff,hits,blk,gva,tka,fow,fol,cf_pct,xgf_pct,hdcf_pct,scf_pct,rapm_off,rapm_def,war_total,war_ev_off,war_ev_def,war_pp,war_pk,war_shooting,war_penalties";

function formatAvgToi(totalMin, gp) {
  if (!totalMin || !gp) return null;
  const avg = totalMin / gp;
  const mins = Math.floor(avg);
  const secs = Math.round((avg - mins) * 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function mapSeasonRows(rows, playerLookup) {
  return rows.map((ps) => {
    const player = playerLookup[ps.player_id] || {};
    const assists = (ps.a1 || 0) + (ps.a2 || 0);
    const pts = (ps.g || 0) + assists;
    return {
      ...player,
      player_id: ps.player_id,
      team: ps.team || player.team || "",
      teamColor: TEAM_COLOR[ps.team] || TEAM_COLOR[player.team] || "#4a6a88",
      gp: ps.gp,
      g: ps.g,
      a: assists,
      pts,
      toi: formatAvgToi(ps.toi, ps.gp),
      toi_5v5: ps.toi_5v5 ?? null,
      cf_pct: ps.cf_pct,
      xgf_pct: ps.xgf_pct,
      hdcf_pct: ps.hdcf_pct,
      scf_pct: ps.scf_pct,
      ixg: ps.ixg,
      icf: ps.icf,
      iff: ps.iff,
      tka: ps.tka,
      gva: ps.gva,
      blk: ps.blk,
      hits: ps.hits,
      fow: ps.fow,
      fol: ps.fol,
      plus_minus: null,
      ppp: null,
      off_rating: null,
      def_rating: null,
      overall_rating: null,
      war_total: ps.war_total ?? null,
      war_ev_off: ps.war_ev_off ?? null,
      war_ev_def: ps.war_ev_def ?? null,
      war_pp: ps.war_pp ?? null,
      war_pk: ps.war_pk ?? null,
      war_shooting: ps.war_shooting ?? null,
      war_penalties: ps.war_penalties ?? null,
      rapm_off: ps.rapm_off ?? null,
      rapm_def: ps.rapm_def ?? null,
      percentiles: player.percentiles || {},
      warTrend: [],
    };
  }).sort((a, b) => (b.pts || 0) - (a.pts || 0));
}

export async function fetchPlayerCardPageData() {
  const supabase = createServerClient();
  const [
    { data: players },
    { data: ps2526 },
    { data: ps2425 },
    { data: ps2324 },
    { data: defaultWarRows },
  ] = await Promise.all([
    supabase.from("players").select("*").order("pts", { ascending: false, nullsFirst: false }).limit(1000),
    supabase.from("player_seasons").select(PS_COLS).eq("season", "25-26"),
    supabase.from("player_seasons").select(PS_COLS).eq("season", "24-25"),
    supabase.from("player_seasons").select(PS_COLS).eq("season", "23-24"),
    supabase
      .from("player_seasons")
      .select("player_id,team,war_total")
      .eq("season", CURRENT_SEASON)
      .order("war_total", { ascending: false, nullsFirst: false })
      .limit(5),
  ]);

  const safePlayers = (players || []).map((player) => ({
    ...player,
    percentiles: player.percentiles || {},
    warTrend: player.warTrend || [],
    teamColor: TEAM_COLOR[player.team] || "#4a6a88",
    initials: `${(player.first_name || "?")[0]}${(player.last_name || "?")[0]}`,
    name: player.full_name,
    firstName: player.first_name,
    lastName: player.last_name,
  }));

  const playerLookup = {};
  safePlayers.forEach((player) => {
    playerLookup[player.player_id] = player;
  });

  const seasonStats = {
    "25-26": mapSeasonRows(ps2526 || [], playerLookup),
    "24-25": mapSeasonRows(ps2425 || [], playerLookup),
    "23-24": mapSeasonRows(ps2324 || [], playerLookup),
  };

  const defaultSearchPlayers = (defaultWarRows || [])
    .map((row) => {
      const player = playerLookup[row.player_id];
      if (!player) return null;
      return {
        ...player,
        team: row.team || player.team,
        war_total: row.war_total ?? player.war_total ?? null,
      };
    })
    .filter(Boolean);

  return {
    players: safePlayers,
    seasonStats,
    defaultSearchPlayers,
  };
}

