-- Penalty event aggregation columns
-- Run in Supabase SQL editor before running upload_penalties.py

alter table players add column if not exists penalties_drawn int;
alter table players add column if not exists penalties_taken int;
alter table players add column if not exists penalty_minutes_drawn int;
alter table players add column if not exists penalty_minutes_taken int;

alter table player_seasons add column if not exists penalties_drawn int;
alter table player_seasons add column if not exists penalties_taken int;
alter table player_seasons add column if not exists penalty_minutes_drawn int;
alter table player_seasons add column if not exists penalty_minutes_taken int;
