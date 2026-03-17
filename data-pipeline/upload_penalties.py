#!/usr/bin/env python3
"""
Extract player penalty events from NHL API play-by-play and upload season totals.

Outputs:
- players: current-season penalties_drawn / penalties_taken / penalty_minutes_drawn / penalty_minutes_taken
- player_seasons: same columns for 25-26 / 24-25 / 23-24

Notes:
- This is a first-pass penalties pipeline for WAR support.
- Only standard 2-minute minors are counted for now.
- Double-minors, majors, and misconduct-only penalties are excluded until they can
  be valued separately.
"""

import json
import os
import sys
import time
from collections import defaultdict

import requests
from supabase import create_client
from sync_log import install_sync_logger

install_sync_logger("players")

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
KNOWN_PLAYER_IDS = {r['player_id'] for r in sb.table('players').select('player_id').execute().data}

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
SLEEP = 0.07
VALID_DURATIONS = {2}
CURRENT_SEASON = '25-26'

SEASON_FILES = {
    '25-26': os.path.join(DATA_DIR, 'game_ids_2526.json'),
    '24-25': os.path.join(DATA_DIR, 'game_ids_2425.json'),
    '23-24': os.path.join(DATA_DIR, 'game_ids_2324.json'),
}

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "nhl-analytics/1.0"})


def get_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            r = SESSION.get(url, timeout=20)
            r.raise_for_status()
            return r
        except Exception:
            if attempt < max_retries - 1:
                time.sleep(3.0)
            else:
                raise


def load_game_ids(path):
    with open(path) as f:
        return json.load(f)


def seasons_to_run():
    if len(sys.argv) > 1:
        return [s for s in sys.argv[1:] if s in SEASON_FILES]
    return list(SEASON_FILES.keys())


def blank_totals():
    return {
        'penalties_drawn': 0,
        'penalties_taken': 0,
        'penalty_minutes_drawn': 0,
        'penalty_minutes_taken': 0,
    }


def add_penalty(totals, key_count, key_minutes, minutes):
    totals[key_count] += 1
    totals[key_minutes] += minutes


def extract_penalties_for_game(game_id):
    url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
    data = get_with_retry(url).json()

    player_totals = defaultdict(blank_totals)
    for ev in data.get('plays', []):
        if ev.get('typeDescKey') != 'penalty':
            continue
        det = ev.get('details', {}) or {}
        duration = det.get('duration')
        if duration not in VALID_DURATIONS:
            continue

        committed = det.get('committedByPlayerId')
        drawn = det.get('drawnByPlayerId')

        if committed:
            add_penalty(player_totals[int(committed)], 'penalties_taken', 'penalty_minutes_taken', int(duration))
        if drawn:
            add_penalty(player_totals[int(drawn)], 'penalties_drawn', 'penalty_minutes_drawn', int(duration))

    return player_totals


def upload_current_season_to_players(totals_by_pid):
    reset = {
        'penalties_drawn': None,
        'penalties_taken': None,
        'penalty_minutes_drawn': None,
        'penalty_minutes_taken': None,
    }
    print("\nClearing current player penalty totals...")
    for pid in KNOWN_PLAYER_IDS:
        sb.table('players').update(reset).eq('player_id', pid).execute()

    valid = {pid: totals for pid, totals in totals_by_pid.items() if pid in KNOWN_PLAYER_IDS}
    missing = len(totals_by_pid) - len(valid)
    print(f"\nUploading current-season penalty totals to players ({len(valid)} players)...")
    updated = 0
    for pid, totals in valid.items():
        result = sb.table('players').update(totals).eq('player_id', pid).execute()
        if result.data:
            updated += 1
    print(f"  Done: {updated} updates{' | skipped unknown IDs: ' + str(missing) if missing else ''}")


def upload_all_seasons_to_player_seasons(rows):
    season_keys = sorted({row['season'] for row in rows})
    reset = {
        'penalties_drawn': None,
        'penalties_taken': None,
        'penalty_minutes_drawn': None,
        'penalty_minutes_taken': None,
    }
    print(f"\nClearing player_seasons penalty totals for: {', '.join(season_keys)}")
    existing_rows = sb.table('player_seasons').select('player_id,season').in_('season', season_keys).execute().data
    for row in existing_rows:
        sb.table('player_seasons').update(reset).eq('player_id', row['player_id']).eq('season', row['season']).execute()

    valid = [row for row in rows if row['player_id'] in KNOWN_PLAYER_IDS]
    missing = len(rows) - len(valid)
    print(f"\nUploading player_seasons penalty totals ({len(valid)} rows)...")
    for i in range(0, len(valid), 200):
        sb.table('player_seasons').upsert(valid[i:i+200], on_conflict='player_id,season').execute()
    print(f"  Done{' | skipped unknown IDs: ' + str(missing) if missing else ''}")


def main():
    seasons = seasons_to_run()
    print(f"Running penalties pipeline for seasons: {', '.join(seasons)}")

    season_rows = []
    current_totals = defaultdict(blank_totals)

    for season in seasons:
        ids_file = SEASON_FILES[season]
        game_ids = load_game_ids(ids_file)
        print(f"\n=== {season} ===")
        print(f"Games: {len(game_ids)}")

        totals_by_pid = defaultdict(blank_totals)
        for idx, gid in enumerate(game_ids, start=1):
            game_totals = extract_penalties_for_game(gid)
            for pid, totals in game_totals.items():
                totals_by_pid[pid]['penalties_drawn'] += totals['penalties_drawn']
                totals_by_pid[pid]['penalties_taken'] += totals['penalties_taken']
                totals_by_pid[pid]['penalty_minutes_drawn'] += totals['penalty_minutes_drawn']
                totals_by_pid[pid]['penalty_minutes_taken'] += totals['penalty_minutes_taken']

            if idx % 100 == 0 or idx == len(game_ids):
                print(f"  {idx}/{len(game_ids)} games")
            time.sleep(SLEEP)

        for pid, totals in totals_by_pid.items():
            season_rows.append({'player_id': pid, 'season': season, **totals})

        if season == CURRENT_SEASON:
            current_totals = totals_by_pid

        print(f"  Players with penalty events: {len(totals_by_pid)}")

    if season_rows:
        upload_all_seasons_to_player_seasons(season_rows)
    if current_totals:
        upload_current_season_to_players(current_totals)

    print("\nDone.")


if __name__ == '__main__':
    main()
