"""compute_historical_percentiles.py

Compute per-season percentile ranks (within position group) for:
  rapm_off, rapm_def, war_total, pts_per_82, goals, ixg

Sources:
  - data/per_season_rapm.json  → rapm_off, rapm_def
  - historical_war table       → war_total
  - career_stats table         → pts_per_82, g, ixg

Run after:
  1. migrations/add_historical_percentiles.sql executed in Supabase
  2. build_rapm.py has been run (per_season_rapm.json present)
  3. compute_historical_war.py has been run

Usage:
  cd ~/Desktop/nhl-analytics/data-pipeline
  python3 -u -c "
  import os, sys
  with open('../.env.local') as f:
      for line in f:
          line=line.strip()
          if '=' in line and not line.startswith('#'):
              k,v=line.split('=',1)
              os.environ[k]=v
              if k.startswith('NEXT_PUBLIC_'):
                  os.environ[k[len('NEXT_PUBLIC_'):]]=v
  if 'SUPABASE_KEY' not in os.environ:
      os.environ['SUPABASE_KEY']=os.environ.get('SUPABASE_ANON_KEY','')
  exec(open('compute_historical_percentiles.py').read())
  "
"""

import json, os
from supabase import create_client

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_KEY') or os.environ.get('NEXT_PUBLIC_SUPABASE_ANON_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')


# ── helpers ────────────────────────────────────────────────────────────────────

def safe(v):
    """Convert to float, return None for NaN/None/non-numeric."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if f != f else f  # NaN check
    except (TypeError, ValueError):
        return None


def pct_rank_in_group(value, group_values):
    """Percentile rank of value within group_values (0-100, one decimal)."""
    vals = [v for v in group_values if v is not None]
    if not vals or value is None:
        return None
    return round(sum(1 for v in vals if v <= value) / len(vals) * 100, 1)


def paginate(table, select):
    """Fetch all rows from a Supabase table using range pagination."""
    rows, start = [], 0
    while True:
        batch = sb.from_(table).select(select).range(start, start + 999).execute()
        if not batch.data:
            break
        rows.extend(batch.data)
        if len(batch.data) < 1000:
            break
        start += 1000
    return rows


# ── load data ──────────────────────────────────────────────────────────────────

print("Loading per_season_rapm.json...")
rapm_path = os.path.join(DATA_DIR, 'per_season_rapm.json')
if not os.path.exists(rapm_path):
    raise FileNotFoundError(f"Missing {rapm_path} — run build_rapm.py first")
with open(rapm_path) as f:
    per_season_rapm = json.load(f)

print("Loading historical_war table...")
war_rows = paginate('historical_war', 'player_id,season,war_total')
war_idx = {(int(r['player_id']), r['season']): r for r in war_rows}
print(f"  {len(war_rows)} WAR rows")

print("Loading career_stats table...")
career_rows = paginate('career_stats', 'player_id,season,g,ixg,pts_per_82')
career_idx = {(int(r['player_id']), r['season']): r for r in career_rows}
print(f"  {len(career_rows)} career_stats rows")

print("Loading player position maps...")
pos_rows = paginate('players', 'player_id,position')
pos_map = {int(r['player_id']): r['position'] for r in pos_rows}

pn_rows = paginate('player_names', 'player_id,position')
for r in pn_rows:
    pid = int(r['player_id'])
    if pid not in pos_map and r.get('position'):
        pos_map[pid] = r['position']
print(f"  {len(pos_map)} players with positions")


# ── position group ─────────────────────────────────────────────────────────────

FORWARD_POSITIONS = {'C', 'L', 'R', 'LW', 'RW', 'W', 'F'}

def pos_group(pid):
    pos = pos_map.get(pid, '')
    return 'D' if pos == 'D' else 'F'


# ── compute percentiles per season ────────────────────────────────────────────

all_seasons = sorted(per_season_rapm.keys())
output_rows = []

for season in all_seasons:
    rapm_season = per_season_rapm[season]

    # Collect all player IDs for this season
    all_pids = set(int(p) for p in rapm_season.keys())
    for (pid, s) in career_idx:
        if s == season:
            all_pids.add(pid)
    for (pid, s) in war_idx:
        if s == season:
            all_pids.add(pid)

    # Build per-group value lists for percentile ranking
    group_vals = {
        'F': {'rapm_off': [], 'rapm_def': [], 'war_total': [], 'pts82': [], 'goals': [], 'ixg': []},
        'D': {'rapm_off': [], 'rapm_def': [], 'war_total': [], 'pts82': [], 'goals': [], 'ixg': []},
    }

    for pid in all_pids:
        g = pos_group(pid)
        rapm = rapm_season.get(str(pid), {})
        war  = war_idx.get((pid, season), {})
        cs   = career_idx.get((pid, season), {})

        v = safe(rapm.get('rapm_off'))
        if v is not None: group_vals[g]['rapm_off'].append(v)

        v = safe(rapm.get('rapm_def'))
        if v is not None: group_vals[g]['rapm_def'].append(v)

        v = safe(war.get('war_total'))
        if v is not None: group_vals[g]['war_total'].append(v)

        v = safe(cs.get('pts_per_82'))
        if v is not None: group_vals[g]['pts82'].append(v)

        v = safe(cs.get('g'))
        if v is not None: group_vals[g]['goals'].append(v)

        v = safe(cs.get('ixg'))
        if v is not None: group_vals[g]['ixg'].append(v)

    # Compute percentile ranks for every player
    for pid in all_pids:
        g = pos_group(pid)
        rapm = rapm_season.get(str(pid), {})
        war  = war_idx.get((pid, season), {})
        cs   = career_idx.get((pid, season), {})
        gv   = group_vals[g]

        row = {
            'player_id':     pid,
            'season':        season,
            'position_group': g,
            'rapm_off_pct':  pct_rank_in_group(safe(rapm.get('rapm_off')),  gv['rapm_off']),
            'rapm_def_pct':  pct_rank_in_group(safe(rapm.get('rapm_def')),  gv['rapm_def']),
            'war_total_pct': pct_rank_in_group(safe(war.get('war_total')),   gv['war_total']),
            'pts82_pct':     pct_rank_in_group(safe(cs.get('pts_per_82')),   gv['pts82']),
            'goals_pct':     pct_rank_in_group(safe(cs.get('g')),            gv['goals']),
            'ixg_pct':       pct_rank_in_group(safe(cs.get('ixg')),          gv['ixg']),
        }
        output_rows.append(row)

    n_f = len(group_vals['F']['rapm_off'])
    n_d = len(group_vals['D']['rapm_off'])
    print(f"  {season}: {len(all_pids)} players  ({n_f}F / {n_d}D with RAPM)")

# ── upsert ────────────────────────────────────────────────────────────────────

print(f"\nUpserting {len(output_rows)} rows to historical_percentiles...")
BATCH = 500
for i in range(0, len(output_rows), BATCH):
    chunk = output_rows[i:i + BATCH]
    sb.from_('historical_percentiles').upsert(
        chunk, on_conflict='player_id,season'
    ).execute()
    print(f"  {min(i + BATCH, len(output_rows))}/{len(output_rows)}")

# ── spot checks ───────────────────────────────────────────────────────────────

print("\nSpot checks:")
checks = [
    (8478402, '22-23', 'McDavid 22-23'),
    (8478402, '18-19', 'McDavid 18-19'),
    (8471214, '09-10', 'Ovechkin 09-10'),
]
for pid, season, label in checks:
    r = sb.from_('historical_percentiles').select('*') \
        .eq('player_id', pid).eq('season', season).execute()
    if r.data:
        d = r.data[0]
        print(f"  {label}: rapm_off={d.get('rapm_off_pct')}, "
              f"war={d.get('war_total_pct')}, pts82={d.get('pts82_pct')}")
    else:
        print(f"  {label}: no data")

print("\nDone.")
