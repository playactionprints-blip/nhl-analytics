alter table predictions_log
  add column if not exists home_odds int,
  add column if not exists away_odds int;
