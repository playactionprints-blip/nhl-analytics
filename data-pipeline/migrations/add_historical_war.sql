-- historical_war: per-player per-season WAR breakdown (07-08 onward)
-- Computed by compute_historical_war.py from career_stats + historical_nst + per_season_rapm.json.
-- Run in Supabase SQL editor before executing compute_historical_war.py.

create table if not exists historical_war (
  id              bigserial primary key,
  player_id       bigint not null,
  season          text not null,
  war_total       float8,
  war_ev_off      float8,
  war_ev_def      float8,
  war_pp          float8,
  war_pk          float8,
  war_shooting    float8,
  war_penalties   float8,
  unique (player_id, season)
);

create index if not exists historical_war_player_idx on historical_war (player_id);
create index if not exists historical_war_season_idx on historical_war (season);
