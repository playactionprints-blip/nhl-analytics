#!/usr/bin/env python3
"""fetch_historical_game_ids.py — Fetch NHL regular-season game IDs for 07-08 through 17-18.

Walks the NHL schedule API week-by-week for each season and saves game IDs
to JSON files in data/. Files that already exist are skipped.

Usage (from data-pipeline/):
    python3 fetch_historical_game_ids.py
"""

import json
import os
import time
from datetime import date, timedelta

import requests

SCHEDULE_API = "https://api-web.nhle.com/v1"
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "nhl-analytics/1.0"})

SEASON_CONFIGS = {
    '07-08': {
        'start': date(2007, 10,  1),
        'end':   date(2008,  4,  7),
        'file':  os.path.join(DATA_DIR, 'game_ids_0708.json'),
    },
    '08-09': {
        'start': date(2008, 10,  1),
        'end':   date(2009,  4, 12),
        'file':  os.path.join(DATA_DIR, 'game_ids_0809.json'),
    },
    '09-10': {
        'start': date(2009, 10,  1),
        'end':   date(2010,  4, 11),
        'file':  os.path.join(DATA_DIR, 'game_ids_0910.json'),
    },
    '10-11': {
        'start': date(2010, 10,  7),
        'end':   date(2011,  4, 10),
        'file':  os.path.join(DATA_DIR, 'game_ids_1011.json'),
    },
    '11-12': {
        'start': date(2011, 10,  6),
        'end':   date(2012,  4,  7),
        'file':  os.path.join(DATA_DIR, 'game_ids_1112.json'),
    },
    '12-13': {  # lockout-shortened season
        'start': date(2013,  1, 19),
        'end':   date(2013,  5,  4),
        'file':  os.path.join(DATA_DIR, 'game_ids_1213.json'),
    },
    '13-14': {
        'start': date(2013, 10,  1),
        'end':   date(2014,  4, 13),
        'file':  os.path.join(DATA_DIR, 'game_ids_1314.json'),
    },
    '14-15': {
        'start': date(2014, 10,  8),
        'end':   date(2015,  4, 11),
        'file':  os.path.join(DATA_DIR, 'game_ids_1415.json'),
    },
    '15-16': {
        'start': date(2015, 10,  7),
        'end':   date(2016,  4, 10),
        'file':  os.path.join(DATA_DIR, 'game_ids_1516.json'),
    },
    '16-17': {
        'start': date(2016, 10, 12),
        'end':   date(2017,  4,  9),
        'file':  os.path.join(DATA_DIR, 'game_ids_1617.json'),
    },
    '17-18': {
        'start': date(2017, 10,  4),
        'end':   date(2018,  4,  8),
        'file':  os.path.join(DATA_DIR, 'game_ids_1718.json'),
    },
}


def _get_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            r = SESSION.get(url, timeout=20)
            r.raise_for_status()
            return r
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"    Retry {attempt + 1}/{max_retries - 1} for {url}: {e}")
                time.sleep(5.0)
            else:
                raise


def fetch_season(label, cfg):
    ids_file   = cfg['file']
    start_date = cfg['start']
    end_date   = cfg['end']

    if os.path.exists(ids_file):
        with open(ids_file) as f:
            ids = json.load(f)
        print(f"  {label}: {len(ids)} games (cached — {os.path.basename(ids_file)})")
        return ids

    game_ids = set()
    current  = start_date
    n_weeks  = 0
    print(f"  {label}: fetching {start_date} → {end_date}...", flush=True)

    while current <= end_date:
        url = f"{SCHEDULE_API}/schedule/{current.isoformat()}"
        try:
            r = _get_with_retry(url)
            for week_day in r.json().get('gameWeek', []):
                for g in week_day.get('games', []):
                    if g.get('gameType') == 2:
                        game_ids.add(g['id'])
        except Exception as e:
            print(f"    Warning {current}: {e}")
        current += timedelta(days=7)
        n_weeks += 1
        if n_weeks % 5 == 0:
            print(f"    ...{current.isoformat()} ({len(game_ids)} games so far)", flush=True)
        time.sleep(1.0)

    ids = sorted(game_ids)
    os.makedirs(os.path.dirname(ids_file), exist_ok=True)
    with open(ids_file, 'w') as f:
        json.dump(ids, f)
    print(f"  {label}: {len(ids)} games → {os.path.basename(ids_file)}")
    return ids


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    print("Fetching historical NHL game IDs (07-08 through 17-18)")
    print("=" * 56)

    results = {}
    for label, cfg in SEASON_CONFIGS.items():
        results[label] = fetch_season(label, cfg)

    print("\nSummary:")
    print("-" * 30)
    for label, ids in results.items():
        print(f"  {label}: {len(ids):4d} games")
    print(f"\n  Total: {sum(len(v) for v in results.values())} games across {len(results)} seasons")


if __name__ == '__main__':
    main()
