-- Goalie rating percentile columns
alter table players add column if not exists sv_pct_pct float8;
alter table players add column if not exists gaa_pct float8;
alter table players add column if not exists win_pct_pct float8;
alter table players add column if not exists shutout_pct float8;
