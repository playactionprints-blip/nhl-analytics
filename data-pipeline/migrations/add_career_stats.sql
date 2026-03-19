-- Career stats table — historical per-season, per-team stats from Evolving Hockey.
-- Seasons go back to 2007-08.  Season labels match EH format ("07-08", "24-25", etc.)
-- Run this in the Supabase SQL editor before executing upload_career_stats.py.

create table if not exists career_stats (
  id          bigserial primary key,
  player_id   bigint   not null,
  season      text     not null,  -- e.g. "24-25"
  team        text     not null,  -- NHL abbreviation: "EDM", "TBL", etc.
  gp          int,
  g           int,
  a           int,
  pts         int,
  toi_total   float8,             -- total ice time (minutes)
  ixg         float8,
  pts_per_82  float8,
  unique (player_id, season, team)
);

create index if not exists career_stats_player_idx on career_stats (player_id);
create index if not exists career_stats_season_idx  on career_stats (season);
