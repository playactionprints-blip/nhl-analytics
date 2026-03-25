#!/usr/bin/env python3
"""compute_historical_war.py — Compute historical WAR for all seasons.

Sources:
  - career_stats table: G, A, ixG, TOI (from EH CSV)
  - historical_nst table: PP/PK/5v5 on-ice TOI + xG rates
  - data/per_season_rapm.json: per-season RAPM from build_rapm.py

WAR components:
  1. EV Off WAR: RAPM-based (null for seasons without RAPM data)
  2. EV Def WAR: RAPM-based (null for seasons without RAPM data)
  3. PP WAR: xGF rate vs league PP baseline, shrinkage by TOI
  4. PK WAR: xGA rate vs league PK baseline, shrinkage by TOI
  5. Shooting WAR: goals vs ixG, shrinkage by ixG volume
  6. Penalties WAR: (drawn - taken) minutes * net xG rate

Requires:
  - Run migrations/add_historical_war.sql in Supabase SQL editor first
  - Run upload_historical_nst.py to populate historical_nst
  - Run build_rapm.py to generate data/per_season_rapm.json

Usage (from data-pipeline/):
    python3 -u -c "
import os
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
exec(open('compute_historical_war.py').read())
"
"""

import json
import os

import numpy as np
from supabase import create_client

# ── env ───────────────────────────────────────────────────────────────────────
try:
    with open('../.env.local') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                os.environ.setdefault(k, v)
                if k.startswith('NEXT_PUBLIC_'):
                    os.environ.setdefault(k[len('NEXT_PUBLIC_'):], v)
except FileNotFoundError:
    pass

if 'SUPABASE_KEY' not in os.environ:
    os.environ['SUPABASE_KEY'] = os.environ.get('SUPABASE_ANON_KEY', '')

SUPABASE_URL = os.environ['SUPABASE_URL']
SUPABASE_KEY = os.environ['SUPABASE_KEY']
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

DATA_DIR = os.path.join(os.getcwd(), 'data')

# ── WAR constants (match compute_ratings.py) ──────────────────────────────────
GOALS_PER_WIN          = 6.0
SHOOTING_XG_SHRINK     = 20.0
NET_XG_PER_PENALTY_MIN = 0.11
PP_WAR_SHRINK_TOI      = 120.0
PK_WAR_SHRINK_TOI      = 120.0

# ── helpers ───────────────────────────────────────────────────────────────────

def safe(v):
    try:
        f = float(v)
        return None if (f != f) else f  # NaN check
    except (TypeError, ValueError):
        return None


def paginate(table, select, filters=None):
    """Fetch all rows from a Supabase table with pagination."""
    rows = []
    start = 0
    while True:
        q = sb.from_(table).select(select).range(start, start + 999)
        if filters:
            for col, val in filters.items():
                q = q.eq(col, val)
        batch = q.execute()
        if not batch.data:
            break
        rows.extend(batch.data)
        start += 1000
        if len(batch.data) < 1000:
            break
    return rows


# ── Step 1: Load position map from players table ──────────────────────────────
print("Step 1: Loading player positions...")
player_rows = paginate('players', 'player_id,position')
position_map = {r['player_id']: r['position'] for r in player_rows}
# Also load from player_names for retired players
pn_rows = paginate('player_names', 'player_id,position')
for r in pn_rows:
    if r['player_id'] not in position_map and r.get('position'):
        position_map[r['player_id']] = r['position']
print(f"  {len(position_map)} players with position data")

# ── Step 2: Load career_stats ─────────────────────────────────────────────────
print("\nStep 2: Loading career_stats...")
career_rows = paginate('career_stats', 'player_id,season,gp,g,a,pts,toi_total,ixg')
# career_stats has no penalty columns — penalties_war will be null for historical seasons
print(f"  {len(career_rows)} career_stats rows")

# ── Step 3: Load historical_nst ───────────────────────────────────────────────
print("\nStep 3: Loading historical_nst...")
nst_rows = paginate('historical_nst', 'player_id,season,toi_pp,xgf_pp,toi_pk,xga_pk,toi_5v5,xgf_pct,hdcf_pct,cf_pct')
print(f"  {len(nst_rows)} historical_nst rows")

# ── Step 4: Load per_season_rapm.json ─────────────────────────────────────────
print("\nStep 4: Loading per_season_rapm.json...")
rapm_json_path = os.path.join(DATA_DIR, 'per_season_rapm.json')
per_season_rapm = {}
if os.path.exists(rapm_json_path):
    with open(rapm_json_path) as f:
        per_season_rapm = json.load(f)
    total_ps = sum(len(v) for v in per_season_rapm.values())
    print(f"  Loaded RAPM for seasons: {sorted(per_season_rapm.keys())} ({total_ps} player-seasons)")
else:
    print(f"  WARNING: {rapm_json_path} not found — EV WAR components will be null for all seasons")

# ── Step 5: Index data ────────────────────────────────────────────────────────
print("\nStep 5: Indexing data...")

# career_stats: (player_id, season) → row
career_idx = {(r['player_id'], r['season']): r for r in career_rows}

# historical_nst: (player_id, season) → row
nst_idx = {(r['player_id'], r['season']): r for r in nst_rows}

# per_season_rapm: (player_id_str, season) → {rapm_off, rapm_def}
# Keys are string player_ids
rapm_idx = {}
for season_key, players in per_season_rapm.items():
    for pid_str, vals in players.items():
        rapm_idx[(int(pid_str), season_key)] = vals

# All (player_id, season) pairs to process
all_pairs = set(career_idx.keys()) | set(nst_idx.keys())
print(f"  {len(all_pairs)} unique (player, season) pairs to process")

# ── Step 6: Compute PP/PK league baselines per season ────────────────────────
print("\nStep 6: Computing PP/PK baselines...")
pp_baselines = {}
pk_baselines = {}

seasons_with_nst = {r['season'] for r in nst_rows}
for season in seasons_with_nst:
    pp_xgf_total = pp_toi_total = 0.0
    pk_xga_total = pk_toi_total = 0.0
    for r in nst_rows:
        if r['season'] != season:
            continue
        toi_pp = safe(r.get('toi_pp'))
        xgf_pp = safe(r.get('xgf_pp'))
        if toi_pp and toi_pp > 0 and xgf_pp is not None:
            pp_xgf_total += xgf_pp
            pp_toi_total += toi_pp
        toi_pk = safe(r.get('toi_pk'))
        xga_pk = safe(r.get('xga_pk'))
        if toi_pk and toi_pk > 0 and xga_pk is not None:
            pk_xga_total += xga_pk
            pk_toi_total += toi_pk
    pp_baselines[season] = (pp_xgf_total / pp_toi_total * 60.0) if pp_toi_total > 0 else 6.8
    pk_baselines[season] = (pk_xga_total / pk_toi_total * 60.0) if pk_toi_total > 0 else 6.8

# ── Step 7: Compute RAPM replacement levels ───────────────────────────────────
# Use the mean/35th-pctile from all available per_season_rapm data
print("\nStep 7: Computing RAPM replacement levels...")
all_rapm_off  = [v['rapm_off'] for vals in per_season_rapm.values() for v in vals.values() if v.get('rapm_off') is not None]
all_rapm_def_fwd = []
all_rapm_def_d   = []
for pid_str, vals in [(pid, v) for season_vals in per_season_rapm.values() for pid, v in season_vals.items()]:
    rd = vals.get('rapm_def')
    if rd is None:
        continue
    pos = position_map.get(int(pid_str))
    if pos == 'D':
        all_rapm_def_d.append(rd)
    else:
        all_rapm_def_fwd.append(rd)

ev_off_replacement     = float(np.mean(all_rapm_off))                    if all_rapm_off     else 0.0
ev_def_replacement_fwd = float(np.percentile(all_rapm_def_fwd, 35))      if all_rapm_def_fwd else 0.0
ev_def_replacement_d   = float(np.percentile(all_rapm_def_d,   35))      if all_rapm_def_d   else 0.0
print(f"  EV Off replacement:     {ev_off_replacement:.4f}")
print(f"  EV Def replacement Fwd: {ev_def_replacement_fwd:.4f}")
print(f"  EV Def replacement D:   {ev_def_replacement_d:.4f}")

# ── Step 8: Compute WAR for each (player, season) ────────────────────────────
print("\nStep 8: Computing WAR...")
war_rows = []

for (player_id, season) in sorted(all_pairs):
    cs   = career_idx.get((player_id, season), {})
    nst  = nst_idx.get((player_id, season), {})
    rapm = rapm_idx.get((player_id, season))

    position = position_map.get(player_id)
    is_defense = position == 'D'
    def_replacement = ev_def_replacement_d if is_defense else ev_def_replacement_fwd

    # ── EV components (RAPM-based) ────────────────────────────────────────────
    ev_off = ev_def = None
    if rapm:
        rapm_off_v = safe(rapm.get('rapm_off'))
        rapm_def_v = safe(rapm.get('rapm_def'))
        toi_5v5 = safe(nst.get('toi_5v5'))
        if toi_5v5 is None:
            toi_5v5 = safe(cs.get('toi_total'))  # fallback: total TOI as proxy
        if rapm_off_v is not None and toi_5v5 and toi_5v5 > 0:
            ev_off = (rapm_off_v - ev_off_replacement) * (toi_5v5 / 60.0) / GOALS_PER_WIN
        if rapm_def_v is not None and toi_5v5 and toi_5v5 > 0:
            ev_def = (rapm_def_v - def_replacement) * (toi_5v5 / 60.0) / GOALS_PER_WIN

    # ── PP WAR ────────────────────────────────────────────────────────────────
    pp_war = None
    toi_pp = safe(nst.get('toi_pp'))
    xgf_pp = safe(nst.get('xgf_pp'))
    if toi_pp and toi_pp > 0 and xgf_pp is not None:
        pp_rate    = xgf_pp / toi_pp * 60.0
        pp_baseline = pp_baselines.get(season, 6.8)
        pp_shrink  = toi_pp / (toi_pp + PP_WAR_SHRINK_TOI)
        pp_war     = ((pp_rate - pp_baseline) * pp_shrink) * (toi_pp / 60.0) / GOALS_PER_WIN

    # ── PK WAR ────────────────────────────────────────────────────────────────
    pk_war = None
    toi_pk = safe(nst.get('toi_pk'))
    xga_pk = safe(nst.get('xga_pk'))
    if toi_pk and toi_pk > 0 and xga_pk is not None:
        pk_rate    = xga_pk / toi_pk * 60.0
        pk_baseline = pk_baselines.get(season, 6.8)
        pk_shrink  = toi_pk / (toi_pk + PK_WAR_SHRINK_TOI)
        pk_war     = ((pk_baseline - pk_rate) * pk_shrink) * (toi_pk / 60.0) / GOALS_PER_WIN

    # ── Shooting WAR ──────────────────────────────────────────────────────────
    shooting_war = None
    g_val   = safe(cs.get('g'))
    ixg_val = safe(cs.get('ixg'))
    if g_val is not None and ixg_val is not None and ixg_val > 0:
        excess_goals = g_val - ixg_val
        shrink       = ixg_val / (ixg_val + SHOOTING_XG_SHRINK)
        shooting_war = (excess_goals * shrink) / GOALS_PER_WIN

    # ── Penalties WAR ─────────────────────────────────────────────────────────
    # career_stats does not store penalty minutes — null for historical seasons
    penalties_war = None

    # ── Total WAR ─────────────────────────────────────────────────────────────
    components = [ev_off, ev_def, pp_war, pk_war, shooting_war, penalties_war]
    total_war = sum(v for v in components if v is not None)
    # Only write a row if we have at least one component
    if all(v is None for v in components):
        continue

    war_rows.append({
        'player_id':    player_id,
        'season':       season,
        'war_total':    round(total_war, 2),
        'war_ev_off':   round(ev_off,        2) if ev_off        is not None else None,
        'war_ev_def':   round(ev_def,        2) if ev_def        is not None else None,
        'war_pp':       round(pp_war,        2) if pp_war        is not None else None,
        'war_pk':       round(pk_war,        2) if pk_war        is not None else None,
        'war_shooting': round(shooting_war,  2) if shooting_war  is not None else None,
        'war_penalties': None,
    })

print(f"  Computed WAR for {len(war_rows)} player-season rows")

# ── Step 9: Upsert to historical_war ─────────────────────────────────────────
print("\nStep 9: Upserting to historical_war...")
BATCH = 500
upserted = 0
errors = 0
for i in range(0, len(war_rows), BATCH):
    chunk = war_rows[i:i + BATCH]
    try:
        sb.from_('historical_war').upsert(chunk, on_conflict='player_id,season').execute()
        upserted += len(chunk)
        print(f"  {upserted}/{len(war_rows)}", flush=True)
    except Exception as e:
        errors += len(chunk)
        print(f"  ERROR on batch {i}–{i+BATCH}: {e}")

print(f"\n✅  Done. {upserted} rows upserted, {errors} errors.")

# ── Spot-checks ───────────────────────────────────────────────────────────────
print("\nSpot-checks (career WAR leaders):")
if war_rows:
    from collections import defaultdict
    totals = defaultdict(float)
    for r in war_rows:
        totals[r['player_id']] += (r['war_total'] or 0.0)
    top = sorted(totals.items(), key=lambda x: x[1], reverse=True)[:10]
    # Build reverse lookup from players table
    pl_rows = paginate('player_names', 'player_id,full_name')
    pid_name = {r['player_id']: r['full_name'] for r in pl_rows}
    for pid, war in top:
        print(f"  {pid_name.get(pid, str(pid)):<28}  career WAR: {war:.1f}")
