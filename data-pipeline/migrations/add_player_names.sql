-- player_names: fast name lookup for /history page dropdown
-- Stores all skaters (active + retired) to avoid runtime NHL API calls
create table if not exists player_names (
  player_id bigint primary key,
  full_name text not null,
  position  text,
  is_active boolean default false
);
create index if not exists player_names_name_idx on player_names (full_name);
