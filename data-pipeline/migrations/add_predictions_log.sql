-- Predictions accuracy tracking table
-- Run in Supabase SQL editor

create table if not exists predictions_log (
  id uuid default gen_random_uuid() primary key,
  game_date date not null,
  game_id text not null unique,
  home_team text not null,
  away_team text not null,
  home_win_prob float8 not null,
  away_win_prob float8 not null,
  predicted_winner text not null,
  actual_winner text,
  home_score int,
  away_score int,
  model_confidence text,
  correct boolean,
  created_at timestamptz default now()
);

create index if not exists predictions_log_game_date_idx on predictions_log (game_date desc);
create index if not exists predictions_log_correct_idx on predictions_log (correct) where correct is not null;
