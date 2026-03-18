-- Market value and age curve columns for the players table.
-- Run this in the Supabase SQL editor before executing build_market_value.py.

alter table players add column if not exists market_value    float8;
alter table players add column if not exists surplus_value   float8;
alter table players add column if not exists war_trajectory  jsonb default '[]';
alter table players add column if not exists peak_age        int;
alter table players add column if not exists age_curve_phase text;
