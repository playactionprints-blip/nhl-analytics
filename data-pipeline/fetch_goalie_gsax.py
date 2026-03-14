#!/usr/bin/env python3
"""
Compute current-season goalie goals saved above expected from NHL play-by-play.

Model notes:
  - xGA is built from NHL API play-by-play shot locations.
  - Official NHL goalie summary stats are preferred for shots/goals against so
    GSAx aligns with the league stat line and does not drift on shootout handling.
  - Expected goals are computed from the same public shot-location model used elsewhere
    in this project, so this is GSAx-style conceptually, not a MoneyPuck clone.

Requires SQL migration first:
  Run data-pipeline/migrations/add_goalie_gsax_columns.sql in Supabase SQL editor.
"""
import json
import math
import os
import re
import time
from collections import defaultdict
from datetime import date

import requests
from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "nhl-analytics/1.0"})

SEASON_CONFIGS = {
    '25-26': {
        'start_date': date(2025, 10, 1),
        'end_date':   date(2026, 4, 18),
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_2526.json'),
    },
}

SHOT_EVENTS = {'shot-on-goal', 'goal', 'missed-shot'}
SHOT_TYPE_MAP = {
    'wrist': 'WRIST SHOT',
    'slap': 'SLAP SHOT',
    'snap': 'SNAP SHOT',
    'backhand': 'BACKHAND',
    'tip-in': 'TIP-IN',
    'deflected': 'DEFLECTED',
    'wrap-around': 'WRAP-AROUND',
    'between-legs': 'BETWEEN LEGS',
    'poke': 'POKE',
}


def _get_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            r = SESSION.get(url, timeout=20)
            r.raise_for_status()
            return r
        except Exception:
            if attempt < max_retries - 1:
                time.sleep(2.0)
            else:
                raise


def compute_xg_xy(x, y, shot_type=''):
    dist = math.sqrt((abs(x) - 89) ** 2 + y ** 2)
    angle = abs(math.degrees(math.atan2(abs(y), max(abs(abs(x) - 89), 0.1))))

    if dist < 10:
        xg = 0.35
    elif dist < 20:
        xg = 0.18
    elif dist < 30:
        xg = 0.09
    elif dist < 40:
        xg = 0.05
    else:
        xg = 0.02

    angle_factor = max(0.4, 1.0 - (angle / 90) * 0.6)
    xg *= angle_factor

    st = str(shot_type).upper()
    if 'DEFLECT' in st or 'TIP' in st:
        xg *= 1.4
    elif 'BACK' in st:
        xg *= 0.8
    elif 'SLAP' in st and dist > 30:
        xg *= 0.7

    return round(xg, 4)


def load_game_ids(season_key):
    ids_file = SEASON_CONFIGS[season_key]['ids_file']
    if not os.path.exists(ids_file):
        raise FileNotFoundError(f"Missing {ids_file}. Run build_rapm.py first to generate game IDs.")
    with open(ids_file) as f:
        ids = json.load(f)
    print(f"Loaded {len(ids)} game IDs from {os.path.basename(ids_file)}")
    return ids


def aggregate_goalie_shots(game_ids):
    totals = defaultdict(lambda: {
        'expected_goals_against': 0.0,
    })
    failed = []

    for idx, game_id in enumerate(game_ids, start=1):
        try:
            url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
            data = _get_with_retry(url).json()
            for ev in data.get('plays', []):
                ev_type = ev.get('typeDescKey')
                if ev_type not in SHOT_EVENTS:
                    continue
                if ev.get('periodDescriptor', {}).get('periodType') == 'SO':
                    continue
                det = ev.get('details', {})
                goalie_id = det.get('goalieInNetId')
                xc = det.get('xCoord')
                yc = det.get('yCoord')
                if goalie_id is None or xc is None or yc is None:
                    continue

                shot_type = SHOT_TYPE_MAP.get(det.get('shotType', ''), det.get('shotType', ''))
                xg = compute_xg_xy(float(xc), float(yc), shot_type)
                totals[int(goalie_id)]['expected_goals_against'] += xg
        except Exception as e:
            failed.append((game_id, str(e)))

        if idx % 100 == 0 or idx == len(game_ids):
            print(f"  {idx}/{len(game_ids)} games")

    if failed:
        print(f"  Failed games: {len(failed)}")
        for game_id, err in failed[:10]:
            print(f"    {game_id}: {err}")
    return totals


def main():
    season_key = '25-26'
    print(f"Computing goalie GSAx for {season_key}")
    print("SQL migration (run in Supabase editor first if needed):")
    print("  alter table players add column if not exists expected_goals_against float8;")
    print("  alter table players add column if not exists expected_save_pct float8;")
    print("  alter table players add column if not exists gsax float8;")
    print("  alter table players add column if not exists gsax_pct float8;")
    print("  alter table players add column if not exists gsax_per_xga float8;")
    print("  alter table players add column if not exists save_pct_above_expected float8;")

    game_ids = load_game_ids(season_key)
    totals = aggregate_goalie_shots(game_ids)

    goalie_rows = sb.table('players').select(
        'player_id,full_name,position,shots_against,goals_against,save_pct'
    ).eq('position', 'G').execute().data
    gdf_rows = []
    for goalie in goalie_rows:
        pid = int(goalie['player_id'])
        t = totals.get(pid)
        official_shots = goalie.get('shots_against')
        official_goals = goalie.get('goals_against')
        if not t:
            continue
        if official_shots is None or official_goals is None:
            continue

        shots_against = int(official_shots)
        goals_against = int(official_goals)
        if shots_against <= 0:
            continue
        xga = float(t['expected_goals_against'])
        actual_sv_pct = 1 - (goals_against / shots_against)
        expected_sv_pct = 1 - (xga / shots_against)
        gsax = xga - goals_against
        gsax_per_xga = (gsax / xga * 100.0) if xga > 0 else None
        sv_pct_above_expected = actual_sv_pct - expected_sv_pct
        gdf_rows.append({
            'player_id': pid,
            'full_name': goalie['full_name'],
            'shots_against': shots_against,
            'goals_against': goals_against,
            'expected_goals_against': round(xga, 2),
            'expected_save_pct': round(expected_sv_pct, 6),
            'gsax': round(gsax, 2),
            'gsax_per_xga': round(gsax_per_xga, 2) if gsax_per_xga is not None else None,
            'save_pct_above_expected': round(sv_pct_above_expected, 6),
        })

    if not gdf_rows:
        print("No goalie shot rows computed.")
        return

    import pandas as pd
    gdf = pd.DataFrame(gdf_rows)
    gdf['gsax_pct'] = gdf['gsax'].rank(pct=True) * 100

    print("\n--- TOP 10 GOALIE GSAx ---")
    print(gdf.sort_values('gsax', ascending=False).head(10)[[
        'full_name', 'shots_against', 'goals_against', 'expected_goals_against',
        'gsax', 'gsax_per_xga', 'save_pct_above_expected'
    ]].to_string(index=False))

    updated = 0
    for row in gdf.to_dict('records'):
        payload = {
            'shots_against': row['shots_against'],
            'goals_against': row['goals_against'],
            'expected_goals_against': row['expected_goals_against'],
            'expected_save_pct': row['expected_save_pct'],
            'gsax': row['gsax'],
            'gsax_pct': round(float(row['gsax_pct']), 1),
            'gsax_per_xga': row['gsax_per_xga'],
            'save_pct_above_expected': row['save_pct_above_expected'],
        }
        result = sb.table('players').update(payload).eq('player_id', row['player_id']).execute()
        if result.data:
            updated += 1

    print(f"\nDone. Updated: {updated} goalies")


if __name__ == "__main__":
    main()
