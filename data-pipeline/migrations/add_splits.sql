-- Run once in Supabase SQL editor before running upload_nst_splits.py

-- 5v5 splits
alter table players add column if not exists toi_5v5 float8;
alter table players add column if not exists cf_5v5 float8;
alter table players add column if not exists ca_5v5 float8;
alter table players add column if not exists xgf_5v5 float8;
alter table players add column if not exists xga_5v5 float8;
alter table players add column if not exists cf_pct_5v5 float8;
alter table players add column if not exists xgf_pct_5v5 float8;

-- PP splits
alter table players add column if not exists toi_pp float8;
alter table players add column if not exists cf_pp float8;
alter table players add column if not exists xgf_pp float8;
alter table players add column if not exists cf_pct_pp float8;

-- PK splits
alter table players add column if not exists toi_pk float8;
alter table players add column if not exists cf_pk float8;
alter table players add column if not exists xga_pk float8;
alter table players add column if not exists cf_pct_pk float8;

-- Finishing rating
alter table players add column if not exists finishing_pct float8;

-- Same splits on player_seasons
alter table player_seasons add column if not exists toi_5v5 float8;
alter table player_seasons add column if not exists cf_5v5 float8;
alter table player_seasons add column if not exists ca_5v5 float8;
alter table player_seasons add column if not exists xgf_5v5 float8;
alter table player_seasons add column if not exists xga_5v5 float8;
alter table player_seasons add column if not exists cf_pct_5v5 float8;
alter table player_seasons add column if not exists xgf_pct_5v5 float8;
alter table player_seasons add column if not exists toi_pp float8;
alter table player_seasons add column if not exists cf_pp float8;
alter table player_seasons add column if not exists xgf_pp float8;
alter table player_seasons add column if not exists cf_pct_pp float8;
alter table player_seasons add column if not exists toi_pk float8;
alter table player_seasons add column if not exists cf_pk float8;
alter table player_seasons add column if not exists xga_pk float8;
alter table player_seasons add column if not exists cf_pct_pk float8;
