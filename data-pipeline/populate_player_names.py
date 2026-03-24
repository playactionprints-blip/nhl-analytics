#!/usr/bin/env python3
"""populate_player_names.py — Build the player_names lookup table.

Combines active players (from Supabase players table) with retired players
(from career_stats) whose names are resolved via the NHL API landing endpoint.
This table powers the /history page dropdown with no runtime NHL API calls.

Usage:
    cd ~/Desktop/nhl-analytics/data-pipeline
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
exec(open('populate_player_names.py').read())
"
"""

import json
import os
import time

import requests
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

url = os.environ['SUPABASE_URL']
key = os.environ['SUPABASE_KEY']
sb  = create_client(url, key)

# ── Step 1: Active players ────────────────────────────────────────────────────
print("Step 1: Loading active players from players table...")
active_rows = []
start = 0
while True:
    batch = sb.from_('players').select('player_id,full_name,position').range(start, start + 999).execute()
    if not batch.data:
        break
    active_rows.extend(batch.data)
    start += 1000
    if len(batch.data) < 1000:
        break
print(f"  {len(active_rows)} active players")

active_ids = {r['player_id'] for r in active_rows}

# ── Step 2: Retired player IDs from career_stats ──────────────────────────────
print("Step 2: Loading career_stats player_ids...")
all_career_ids = set()
start = 0
while True:
    batch = sb.from_('career_stats').select('player_id').range(start, start + 999).execute()
    if not batch.data:
        break
    all_career_ids.update(r['player_id'] for r in batch.data)
    start += 1000
    if len(batch.data) < 1000:
        break

retired_ids = sorted(all_career_ids - active_ids)
print(f"  {len(retired_ids)} retired players to resolve")

# ── Step 3: Fetch retired names from NHL API ──────────────────────────────────
CACHE_FILE = os.path.join(os.getcwd(), 'data', 'retired_player_names_cache.json')

print("Step 3: Fetching retired player names from NHL API...")
retired_rows = []
failed = []

# Load cache if available to skip re-fetching
if os.path.exists(CACHE_FILE):
    with open(CACHE_FILE) as f:
        cached = json.load(f)
    cached_ids = {r['player_id'] for r in cached}
    retired_rows = cached
    failed = [pid for pid in retired_ids if pid not in cached_ids]
    print(f"  Loaded {len(retired_rows)} from cache, {len(failed)} still to fetch")
    ids_to_fetch = failed
    failed = []
else:
    ids_to_fetch = retired_ids

for i, pid in enumerate(ids_to_fetch):
    try:
        r = requests.get(
            f"https://api-web.nhle.com/v1/player/{pid}/landing",
            timeout=10,
        )
        if r.ok:
            d = r.json()
            first = (d.get('firstName') or {}).get('default', '')
            last  = (d.get('lastName')  or {}).get('default', '')
            pos   = d.get('position', '')
            name  = f"{first} {last}".strip()
            if name:
                retired_rows.append({
                    'player_id': pid,
                    'full_name': name,
                    'position':  pos,
                    'is_active': False,
                })
            else:
                failed.append(pid)
        else:
            failed.append(pid)
    except Exception:
        failed.append(pid)

    if (i + 1) % 20 == 0:
        print(f"  {i + 1}/{len(ids_to_fetch)} done...", flush=True)
        time.sleep(0.5)

# Save cache for future re-runs
os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
with open(CACHE_FILE, 'w') as f:
    json.dump(retired_rows, f)

print(f"  Resolved {len(retired_rows)}, failed {len(failed)}")
if failed:
    print(f"  Failed IDs (first 10): {failed[:10]}")

# ── Step 4: Upsert to player_names ────────────────────────────────────────────
print("Step 4: Upserting to player_names table...")

active_upsert = [
    {
        'player_id': r['player_id'],
        'full_name': r['full_name'],
        'position':  r['position'],
        'is_active': True,
    }
    for r in active_rows
    if r.get('position', '') != 'G'   # skip goalies — history page is skaters only
]

all_rows = active_upsert + retired_rows
for i in range(0, len(all_rows), 500):
    chunk = all_rows[i:i + 500]
    sb.from_('player_names').upsert(chunk, on_conflict='player_id').execute()
    print(f"  Upserted {min(i + 500, len(all_rows))}/{len(all_rows)}", flush=True)

print(f"\nDone. {len(all_rows)} players in player_names table.")
print(f"  Active skaters : {len(active_upsert)}")
print(f"  Retired skaters: {len(retired_rows)}")
