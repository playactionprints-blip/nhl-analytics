-- Run in Supabase SQL editor before using season-level RAPM / WAR card pipeline.

-- Per-season RAPM + context on player_seasons
alter table player_seasons add column if not exists rapm_off float8;
alter table player_seasons add column if not exists rapm_def float8;
alter table player_seasons add column if not exists rapm_off_pct float8;
alter table player_seasons add column if not exists rapm_def_pct float8;

alter table player_seasons add column if not exists qot_impact float8;
alter table player_seasons add column if not exists qoc_impact float8;
alter table player_seasons add column if not exists qot_impact_pct float8;
alter table player_seasons add column if not exists qoc_impact_pct float8;

-- Per-season WAR components on player_seasons
alter table player_seasons add column if not exists war_total float8;
alter table player_seasons add column if not exists war_ev_off float8;
alter table player_seasons add column if not exists war_ev_def float8;
alter table player_seasons add column if not exists war_pp float8;
alter table player_seasons add column if not exists war_pk float8;
alter table player_seasons add column if not exists war_shooting float8;
alter table player_seasons add column if not exists war_penalties float8;

-- Projected context on players
alter table players add column if not exists qot_impact float8;
alter table players add column if not exists qoc_impact float8;
alter table players add column if not exists qot_impact_pct float8;
alter table players add column if not exists qoc_impact_pct float8;
