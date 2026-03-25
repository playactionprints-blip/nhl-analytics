-- historical_nst: per-player per-season NST on-ice data (07-08 through 22-23)
-- Stores PP/PK/5v5 time-on-ice and xG metrics for historical WAR computation.
-- Run in Supabase SQL editor before executing upload_historical_nst.py.

create table if not exists historical_nst (
  id          bigserial primary key,
  player_id   bigint not null,
  season      text not null,
  toi_pp      float8,
  xgf_pp      float8,
  toi_pk      float8,
  xga_pk      float8,
  toi_5v5     float8,
  xgf_pct     float8,
  hdcf_pct    float8,
  cf_pct      float8,
  unique (player_id, season)
);

create index if not exists historical_nst_player_idx on historical_nst (player_id);
create index if not exists historical_nst_season_idx on historical_nst (season);
