-- Add WAR columns to players table
-- Run in Supabase SQL editor before executing compute_ratings.py

alter table players add column if not exists war_total  float8;
alter table players add column if not exists war_ev_off float8;
alter table players add column if not exists war_ev_def float8;
alter table players add column if not exists war_pp     float8;
alter table players add column if not exists war_pk     float8;
