#!/usr/bin/env python3
"""
Build RAPM (Regularized Adjusted Plus-Minus) from 2025-26 NHL API play-by-play.

BEFORE RUNNING: add columns to the Supabase players table in the SQL editor:
    alter table players add column if not exists rapm_off     float8;
    alter table players add column if not exists rapm_def     float8;
    alter table players add column if not exists rapm_off_pct float8;
    alter table players add column if not exists rapm_def_pct float8;

USAGE:
    export SUPABASE_URL=...
    export SUPABASE_KEY=...
    python build_rapm.py

Data sources:
  - NHL play-by-play: api-web.nhle.com/v1/gamecenter/{id}/play-by-play  (xG events)
  - NHL shift chart:  api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId={id}  (lineup timing)
"""

import json, os, time, math, sys
import requests
import pandas as pd
import numpy as np
from datetime import date, timedelta
from scipy import sparse
from sklearn.linear_model import RidgeCV
from supabase import create_client

# ── Config ────────────────────────────────────────────────────────────────────
PBP_API    = "https://api-web.nhle.com/v1"
SHIFT_API  = "https://api.nhle.com/stats/rest/en"
DATA_DIR   = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
GAME_IDS_FILE = os.path.join(DATA_DIR, 'game_ids_2526.json')
STINTS_FILE   = os.path.join(DATA_DIR, 'stints_2526.csv')
FAILED_FILE   = os.path.join(DATA_DIR, 'failed_games_2526.json')
os.makedirs(DATA_DIR, exist_ok=True)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "nhl-analytics/1.0"})


# ── Helpers ───────────────────────────────────────────────────────────────────
def _period_sec(period, time_str):
    """Convert (period, 'MM:SS') to absolute seconds from puck drop."""
    try:
        m, s = map(int, time_str.split(':'))
    except Exception:
        return None
    return (period - 1) * 1200 + m * 60 + s


def shot_xg(event):
    """Distance-based xG.  Uses distanceFromNet if present, else xCoord/yCoord."""
    details = event.get('details') or {}
    dist = details.get('distanceFromNet')
    if dist is None:
        x = details.get('xCoord')
        y = details.get('yCoord')
        if x is not None and y is not None:
            # nearest net is at (±89, 0)
            dist = min(math.sqrt((x - 89) ** 2 + y ** 2),
                       math.sqrt((x + 89) ** 2 + y ** 2))
        else:
            dist = 60
    if dist < 20:
        return 0.35
    elif dist < 40:
        return 0.10
    return 0.03


# ── Step 1: Fetch all 2025-26 regular-season game IDs ────────────────────────
def fetch_game_ids():
    if os.path.exists(GAME_IDS_FILE):
        with open(GAME_IDS_FILE) as f:
            ids = json.load(f)
        print(f"Loaded {len(ids)} game IDs from cache")
        return ids

    game_ids = set()
    current  = date(2025, 10, 1)
    today    = date.today()
    print(f"Fetching schedule 2025-10-01 → {today}...")
    while current <= today:
        url = f"{PBP_API}/schedule/{current.isoformat()}"
        try:
            r = SESSION.get(url, timeout=15)
            r.raise_for_status()
            for week_day in r.json().get('gameWeek', []):
                for g in week_day.get('games', []):
                    if g.get('gameType') == 2:
                        game_ids.add(g['id'])
        except Exception as e:
            print(f"  Warning {current}: {e}")
        current += timedelta(days=7)
        time.sleep(0.3)

    ids = sorted(game_ids)
    with open(GAME_IDS_FILE, 'w') as f:
        json.dump(ids, f)
    print(f"Found {len(ids)} regular-season games")
    return ids


# ── Step 2: Extract 5v5 stints via shift chart + play-by-play ────────────────
def build_stints_from_game(game_data, shift_rows):
    """
    Reconstruct 5v5 stints using:
      - shift_rows  : from api.nhle.com/stats/rest/en/shiftcharts (lineup timing)
      - game_data   : from api-web.nhle.com play-by-play (xG events, rosterSpots)
    """
    game_id      = game_data.get('id')
    home_team_id = (game_data.get('homeTeam') or {}).get('id')

    # Identify goalies from rosterSpots
    goalie_ids = set()
    for spot in game_data.get('rosterSpots', []):
        if spot.get('positionCode') == 'G':
            goalie_ids.add(spot.get('playerId'))

    # --- Parse shifts into per-player intervals (regulation periods only) ---
    # player_intervals[pid] = [(start_sec, end_sec, team_id), ...]
    player_intervals = {}
    for sh in shift_rows:
        period = sh.get('period', 0)
        if not isinstance(period, int) or period > 3:
            continue
        pid = sh.get('playerId')
        tid = sh.get('teamId')
        if not pid or not tid:
            continue
        if pid in goalie_ids:
            continue   # ignore goalie shifts
        start = _period_sec(period, sh.get('startTime') or '0:00')
        end   = _period_sec(period, sh.get('endTime')   or '0:00')
        if start is None or end is None or end <= start:
            continue
        player_intervals.setdefault(pid, []).append((start, end, tid))

    if not player_intervals:
        return []

    # --- Collect all change points (shift starts/ends) ---
    change_pts = set()
    for ivs in player_intervals.values():
        for s, e, _ in ivs:
            change_pts.add(s)
            change_pts.add(e)
    # Also add period boundaries as hard break points
    for p in range(1, 4):
        change_pts.add((p - 1) * 1200)
        change_pts.add(p * 1200)
    change_pts = sorted(change_pts)

    # --- Build xG event lookup: abs_sec → (xg, is_home) ---
    xg_events = []
    for ev in game_data.get('plays', []):
        if ev.get('typeDescKey') not in ('shot-on-goal', 'goal'):
            continue
        period = (ev.get('periodDescriptor') or {}).get('number') or ev.get('period', 0)
        if period > 3:
            continue
        t = _period_sec(period, ev.get('timeInPeriod', '0:00'))
        if t is None:
            continue
        owner   = (ev.get('details') or {}).get('eventOwnerTeamId')
        is_home = (owner == home_team_id)
        xg_events.append((t, shot_xg(ev), is_home))

    # --- Build stints from intervals between change points ---
    stints = []
    for i in range(len(change_pts) - 1):
        t_start = change_pts[i]
        t_end   = change_pts[i + 1]
        dur     = t_end - t_start
        if dur <= 0:
            continue
        # Skip interval that crosses a period boundary (period 1→2, etc.)
        p_start = t_start // 1200 + 1
        p_end   = t_end   // 1200 + 1
        if p_start != p_end:
            continue

        # Who is on ice for this entire interval?
        t_mid = (t_start + t_end) / 2.0
        home_sk, away_sk = set(), set()
        for pid, ivs in player_intervals.items():
            for s, e, tid in ivs:
                if s <= t_mid < e:
                    if tid == home_team_id:
                        home_sk.add(pid)
                    else:
                        away_sk.add(pid)
                    break  # one match per player per interval

        if len(home_sk) != 5 or len(away_sk) != 5:
            continue   # not 5v5

        # Accumulate xG (strict: event at exactly t_start is included, t_end is not)
        h_xg = sum(xg for t, xg, ih in xg_events if t_start <= t < t_end and ih)
        a_xg = sum(xg for t, xg, ih in xg_events if t_start <= t < t_end and not ih)

        stints.append({
            'game_id':          game_id,
            'period':           p_start,
            'start_sec':        t_start,
            'end_sec':          t_end,
            'duration_seconds': dur,
            'home_players':     '|'.join(str(p) for p in sorted(home_sk)),
            'away_players':     '|'.join(str(p) for p in sorted(away_sk)),
            'home_xg':          round(h_xg, 4),
            'away_xg':          round(a_xg, 4),
        })

    return stints


STINT_COLS = [
    'game_id', 'period', 'start_sec', 'end_sec', 'duration_seconds',
    'home_players', 'away_players', 'home_xg', 'away_xg',
]


def fetch_all_stints(game_ids):
    if os.path.exists(STINTS_FILE):
        df = pd.read_csv(STINTS_FILE)
        if len(df) > 0:
            print(f"Loaded {len(df)} stints from cache")
            return df

    failed = []
    rows   = []
    total  = len(game_ids)
    print(f"Fetching PBP + shifts for {total} games (two requests each)...")

    for i, gid in enumerate(game_ids, 1):
        try:
            pbp_url   = f"{PBP_API}/gamecenter/{gid}/play-by-play"
            shift_url = f"{SHIFT_API}/shiftcharts?cayenneExp=gameId={gid}"

            r_pbp = SESSION.get(pbp_url,   timeout=20)
            r_pbp.raise_for_status()
            time.sleep(0.3)

            r_sh  = SESSION.get(shift_url, timeout=20)
            r_sh.raise_for_status()

            stints = build_stints_from_game(r_pbp.json(), r_sh.json().get('data', []))
            rows.extend(stints)

        except Exception as e:
            failed.append(gid)
            if len(failed) <= 10:
                print(f"  ✗ Game {gid}: {e}")

        if i % 50 == 0:
            print(f"  {i}/{total} games processed ({len(rows)} stints so far)...")
        time.sleep(0.3)

    if failed:
        with open(FAILED_FILE, 'w') as f:
            json.dump(failed, f)
        print(f"  {len(failed)} games failed → {FAILED_FILE}")

    df = pd.DataFrame(rows, columns=STINT_COLS) if rows else pd.DataFrame(columns=STINT_COLS)
    df.to_csv(STINTS_FILE, index=False)
    print(f"\nTotal stints: {len(df)} → {STINTS_FILE}")
    return df


# ── Step 3: Build RAPM regression ────────────────────────────────────────────
def build_rapm(stints_df):
    """Fit offensive + defensive RidgeCV RAPM models."""
    stints_df = stints_df[stints_df['duration_seconds'] >= 3].copy()
    n_stints  = len(stints_df)
    if n_stints == 0:
        raise ValueError("No stints to fit — check game fetch above")

    # Collect unique player IDs
    all_pids = set()
    for col in ('home_players', 'away_players'):
        for cell in stints_df[col].dropna():
            for p in str(cell).split('|'):
                if p.strip():
                    all_pids.add(int(p))

    all_pids  = sorted(all_pids)
    pid_idx   = {p: i for i, p in enumerate(all_pids)}
    n_players = len(all_pids)
    n_rows = n_stints  # one row per stint

    print(f"Building RAPM matrix: {n_rows} rows × {n_players} players")

    r_idx, c_idx, vals = [], [], []
    y_off   = np.zeros(n_rows)
    y_def   = np.zeros(n_rows)
    weights = np.zeros(n_rows)

    for i, (_, stint) in enumerate(stints_df.iterrows()):
        dur   = float(stint['duration_seconds'])
        dur_h = dur / 3600.0
        w     = math.sqrt(dur)

        hxg = float(stint['home_xg']) / dur_h
        axg = float(stint['away_xg']) / dur_h

        h_pids = [int(p) for p in str(stint['home_players']).split('|') if p.strip()]
        a_pids = [int(p) for p in str(stint['away_players']).split('|') if p.strip()]

        for pid in h_pids:
            if pid in pid_idx:
                r_idx.append(i); c_idx.append(pid_idx[pid]); vals.append(1.0)
        for pid in a_pids:
            if pid in pid_idx:
                r_idx.append(i); c_idx.append(pid_idx[pid]); vals.append(-1.0)

        # Offensive target: home team's xGF rate (different from defensive target)
        y_off[i] = hxg
        # Defensive target: home team's xGA rate (what they allow); flip later
        y_def[i] = axg
        weights[i] = w

    X = sparse.csr_matrix((vals, (r_idx, c_idx)), shape=(n_rows, n_players))

    alphas = [0.01, 0.1, 1, 10, 100, 1000]

    print("Fitting offensive RAPM (RidgeCV)...")
    m_off = RidgeCV(alphas=alphas, fit_intercept=True)
    m_off.fit(X, y_off, sample_weight=weights)
    print(f"  Best alpha: {m_off.alpha_}")

    print("Fitting defensive RAPM (RidgeCV)...")
    m_def = RidgeCV(alphas=alphas, fit_intercept=True)
    m_def.fit(X, y_def, sample_weight=weights)
    print(f"  Best alpha: {m_def.alpha_}")

    results = pd.DataFrame({
        'player_id':  all_pids,
        'rapm_off':   m_off.coef_,
        'rapm_def':  -m_def.coef_,  # flipped: higher = better defender
    })
    results['rapm_off_pct'] = results['rapm_off'].rank(pct=True) * 100
    results['rapm_def_pct'] = results['rapm_def'].rank(pct=True) * 100

    return results


# ── Step 4: Upload to Supabase ────────────────────────────────────────────────
def upload_rapm(results_df):
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("✗ SUPABASE_URL / SUPABASE_KEY not set")
        return

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    existing = {r['player_id'] for r in
                sb.table('players').select('player_id').execute().data}

    not_found = []
    updated   = 0

    column_error_shown = False
    for _, row in results_df.iterrows():
        pid = int(row['player_id'])
        if pid not in existing:
            not_found.append(pid)
            continue
        data = {
            'rapm_off':     round(float(row['rapm_off']),     4),
            'rapm_def':     round(float(row['rapm_def']),     4),
            'rapm_off_pct': round(float(row['rapm_off_pct']), 1),
            'rapm_def_pct': round(float(row['rapm_def_pct']), 1),
        }
        result = sb.table('players').update(data).eq('player_id', pid).execute()
        if result.data:
            updated += 1
        elif not column_error_shown:
            column_error_shown = True
            print("\n  ✗ Upload failed — columns may not exist. Run in Supabase SQL editor:")
            print("      alter table players add column if not exists rapm_off     float8;")
            print("      alter table players add column if not exists rapm_def     float8;")
            print("      alter table players add column if not exists rapm_off_pct float8;")
            print("      alter table players add column if not exists rapm_def_pct float8;")

    print(f"\nUploaded RAPM for {updated} players")
    if not_found:
        print(f"  {len(not_found)} IDs not in Supabase: {not_found[:20]}"
              f"{'...' if len(not_found) > 20 else ''}")


def print_leaderboards(results_df):
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    sb   = create_client(SUPABASE_URL, SUPABASE_KEY)
    info = {p['player_id']: p for p in
            sb.table('players').select('player_id,full_name,position').execute().data}

    df = results_df.copy()
    df['full_name'] = df['player_id'].map(lambda p: info.get(p, {}).get('full_name', str(p)))
    df['position']  = df['player_id'].map(lambda p: info.get(p, {}).get('position', '?'))

    print("\n--- TOP 15 OFFENSIVE RAPM ---")
    top = df.nlargest(15, 'rapm_off')[['full_name', 'position', 'rapm_off', 'rapm_off_pct']]
    print(top.to_string(index=False, float_format=lambda x: f"{x:7.3f}"))

    print("\n--- TOP 15 DEFENSIVE RAPM ---")
    top = df.nlargest(15, 'rapm_def')[['full_name', 'position', 'rapm_def', 'rapm_def_pct']]
    print(top.to_string(index=False, float_format=lambda x: f"{x:7.3f}"))


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 60)
    print("Step 1 — Fetch 2025-26 game IDs")
    print("=" * 60)
    game_ids = fetch_game_ids()
    print(f"Total games: {len(game_ids)}")

    print("\n" + "=" * 60)
    print("Step 2 — Fetch PBP + shifts, extract 5v5 stints")
    print("=" * 60)
    stints_df = fetch_all_stints(game_ids)

    print("\n" + "=" * 60)
    print("Step 3 — Build RAPM regression matrix")
    print("=" * 60)
    results = build_rapm(stints_df)

    print("\n" + "=" * 60)
    print("Step 4 — Upload to Supabase")
    print("=" * 60)
    upload_rapm(results)
    print_leaderboards(results)

    print("\n✓ Done. Run compute_ratings.py to refresh overall ratings.")
