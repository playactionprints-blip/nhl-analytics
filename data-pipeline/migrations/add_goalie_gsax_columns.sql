alter table players add column if not exists goals_against int;
alter table players add column if not exists shots_against int;
alter table players add column if not exists expected_goals_against float8;
alter table players add column if not exists expected_save_pct float8;
alter table players add column if not exists gsax float8;
alter table players add column if not exists gsax_pct float8;
alter table players add column if not exists gsax_per_xga float8;
alter table players add column if not exists save_pct_above_expected float8;
