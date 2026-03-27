-- Historical per-season percentile ranks for the season card UI
-- Run this in the Supabase SQL editor before running compute_historical_percentiles.py

create table if not exists historical_percentiles (
  id              bigserial primary key,
  player_id       bigint not null,
  season          text not null,
  position_group  text,          -- 'F' or 'D'
  rapm_off_pct    float8,
  rapm_def_pct    float8,
  war_total_pct   float8,
  pts82_pct       float8,
  goals_pct       float8,
  ixg_pct         float8,
  unique (player_id, season)
);

create index if not exists hist_pct_player_idx on historical_percentiles (player_id);
create index if not exists hist_pct_season_idx on historical_percentiles (season);
