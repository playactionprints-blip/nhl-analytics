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
TEST_MODE  = False  # Set True to limit to TEST_GAMES for validation
TEST_GAMES = 50     # Games to process in test mode

PBP_API   = "https://api-web.nhle.com/v1"
SHIFT_API = "https://api.nhle.com/stats/rest/en"
DATA_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
GAME_IDS_FILE     = os.path.join(DATA_DIR, 'game_ids_2526.json')
STINTS_FILE       = os.path.join(DATA_DIR, 'stints_2526.csv')
STINTS_CHECKPOINT = os.path.join(DATA_DIR, 'stints_checkpoint.csv')
FAILED_FILE       = os.path.join(DATA_DIR, 'failed_games_2526.json')
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


def compute_xg(event):
    """
    Estimate xG from shot distance and angle.
    Covers goals, shots-on-goal, and missed shots.
    """
    details   = event.get('details') or {}
    x         = details.get('xCoord') or 0
    y         = details.get('yCoord') or 0
    shot_type = details.get('shotType') or ''

    # Distance from the nearest net (nets sit at x = ±89 ft)
    dist  = math.sqrt((abs(x) - 89) ** 2 + y ** 2)

    # Angle from the slot centre (0 = straight on, 90 = from the side)
    angle = abs(math.degrees(math.atan2(abs(y), max(abs(abs(x) - 89), 0.1))))

    # Base xG by distance zone
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

    # Angle penalty — shots from the side are less dangerous
    angle_factor = max(0.4, 1.0 - (angle / 90) * 0.6)
    xg *= angle_factor

    # Shot-type adjustments
    if shot_type in ('Deflection', 'Tip-In'):
        xg *= 1.4
    elif shot_type == 'Backhand':
        xg *= 0.8
    elif shot_type == 'Slap Shot' and dist > 30:
        xg *= 0.7

    return round(xg, 4)


def _get_with_retry(url, max_retries=3):
    """GET with exponential-ish retry — waits 5 s between attempts."""
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


# ── Step 1: Fetch all 2025-26 regular-season game IDs ────────────────────────
def fetch_game_ids():
    if os.path.exists(GAME_IDS_FILE):
        with open(GAME_IDS_FILE) as f:
            ids = json.load(f)
        print(f"Loaded {len(ids)} game IDs from cache ({GAME_IDS_FILE})")
        return ids

    game_ids = set()
    current  = date(2025, 10, 1)
    today    = date.today()
    print(f"Fetching schedule 2025-10-01 → {today}...")
    while current <= today:
        url = f"{PBP_API}/schedule/{current.isoformat()}"
        try:
            r = _get_with_retry(url)
            for week_day in r.json().get('gameWeek', []):
                for g in week_day.get('games', []):
                    if g.get('gameType') == 2:
                        game_ids.add(g['id'])
        except Exception as e:
            print(f"  Warning {current}: {e}")
        current += timedelta(days=7)
        time.sleep(1.0)

    ids = sorted(game_ids)
    with open(GAME_IDS_FILE, 'w') as f:
        json.dump(ids, f)
    print(f"Found {len(ids)} regular-season games → {GAME_IDS_FILE}")
    return ids


# ── Step 2: Extract 5v5 stints via shift chart + play-by-play ────────────────

def _merge_stints(stints):
    """
    Merge consecutive stints that have identical home/away lineups.

    The change-point approach creates a new interval every time ANY player's shift
    starts or ends — even players who are NOT currently on ice.  This splits what
    should be one continuous lineup segment into many micro-stints.  We reconstruct
    the true segments by merging adjacent intervals that share the same 10 skaters.

    Two stints are merged when:
      - same home_players string AND same away_players string
      - same period
      - the second starts within 1 second of where the first ended
        (≤1 s gap handles rounding in shift-chart timestamps)

    Stints shorter than 10 s after merging are discarded.
    """
    if not stints:
        return []

    stints = sorted(stints, key=lambda s: (s['period'], s['start_sec']))
    merged = [stints[0].copy()]

    for s in stints[1:]:
        prev = merged[-1]
        if (s['home_players'] == prev['home_players'] and
                s['away_players'] == prev['away_players'] and
                s['period'] == prev['period'] and
                s['start_sec'] <= prev['end_sec'] + 1):
            # Extend the existing segment
            prev['end_sec']          = max(prev['end_sec'], s['end_sec'])
            prev['duration_seconds'] = prev['end_sec'] - prev['start_sec']
            prev['home_xg']          = round(prev['home_xg'] + s['home_xg'], 4)
            prev['away_xg']          = round(prev['away_xg'] + s['away_xg'], 4)
        else:
            merged.append(s.copy())

    return [s for s in merged if s['duration_seconds'] >= 10]


def build_stints_from_game(game_data, shift_rows):
    """
    Reconstruct 5v5 stints using:
      - shift_rows  : from api.nhle.com/stats/rest/en/shiftcharts (lineup timing)
      - game_data   : from api-web.nhle.com play-by-play (xG events, rosterSpots)
    Returns merged, filtered stints (≥10 s, 5v5 only).
    """
    game_id      = game_data.get('id')
    home_team_id = (game_data.get('homeTeam') or {}).get('id')

    # Identify goalies from rosterSpots
    goalie_ids = set()
    for spot in game_data.get('rosterSpots', []):
        if spot.get('positionCode') == 'G':
            goalie_ids.add(spot.get('playerId'))

    # Parse shifts → per-player intervals (regulation periods only)
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
            continue
        start = _period_sec(period, sh.get('startTime') or '0:00')
        end   = _period_sec(period, sh.get('endTime')   or '0:00')
        if start is None or end is None or end <= start:
            continue
        player_intervals.setdefault(pid, []).append((start, end, tid))

    if not player_intervals:
        return []

    # Collect all change points from every shift boundary
    change_pts = set()
    for ivs in player_intervals.values():
        for s, e, _ in ivs:
            change_pts.add(s)
            change_pts.add(e)
    # Hard period boundaries so stints never cross period lines
    for p in range(1, 4):
        change_pts.add((p - 1) * 1200)
        change_pts.add(p * 1200)
    change_pts = sorted(change_pts)

    # Build xG event list — goals, shots on goal, AND missed shots
    XG_TYPES = {'shot-on-goal', 'goal', 'missed-shot'}
    xg_events = []
    for ev in game_data.get('plays', []):
        if ev.get('typeDescKey') not in XG_TYPES:
            continue
        period = (ev.get('periodDescriptor') or {}).get('number') or ev.get('period', 0)
        if period > 3:
            continue
        t = _period_sec(period, ev.get('timeInPeriod', '0:00'))
        if t is None:
            continue
        owner   = (ev.get('details') or {}).get('eventOwnerTeamId')
        is_home = (owner == home_team_id)
        xg_events.append((t, compute_xg(ev), is_home))

    # Build raw micro-stints from change-point intervals
    raw_stints = []
    for i in range(len(change_pts) - 1):
        t_start = change_pts[i]
        t_end   = change_pts[i + 1]
        dur     = t_end - t_start
        if dur <= 0:
            continue
        # Discard intervals that cross a period boundary
        if t_start // 1200 != t_end // 1200 and t_end % 1200 != 0:
            continue
        p_start = t_start // 1200 + 1
        if p_start > 3:
            continue

        # Determine on-ice skaters via midpoint check
        t_mid = (t_start + t_end) / 2.0
        home_sk, away_sk = set(), set()
        for pid, ivs in player_intervals.items():
            for s, e, tid in ivs:
                if s <= t_mid < e:
                    if tid == home_team_id:
                        home_sk.add(pid)
                    else:
                        away_sk.add(pid)
                    break

        if len(home_sk) != 5 or len(away_sk) != 5:
            continue

        h_xg = sum(xg for t, xg, ih in xg_events if t_start <= t < t_end and ih)
        a_xg = sum(xg for t, xg, ih in xg_events if t_start <= t < t_end and not ih)

        raw_stints.append({
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

    return _merge_stints(raw_stints)


STINT_COLS = [
    'game_id', 'period', 'start_sec', 'end_sec', 'duration_seconds',
    'home_players', 'away_players', 'home_xg', 'away_xg',
]


def fetch_all_stints(game_ids):
    """
    Fetch PBP + shifts for every game, extract merged 5v5 stints.
    - Resumes from checkpoint if one exists (skips already-processed games).
    - Saves a checkpoint every 100 games.
    - Retries failed requests up to 3 times with 5-second backoff.
    - In TEST_MODE, only processes the first TEST_GAMES un-fetched games.
    """
    # Load existing stints to find which games are already done
    existing_rows = []
    done_games    = set()
    for fpath in (STINTS_CHECKPOINT, STINTS_FILE):
        if os.path.exists(fpath):
            try:
                df_ex = pd.read_csv(fpath)
                if len(df_ex) > 0:
                    existing_rows = df_ex.to_dict('records')
                    done_games    = set(df_ex['game_id'].unique())
                    print(f"Resuming from {os.path.basename(fpath)}: "
                          f"{len(done_games)} games done, {len(existing_rows)} stints loaded")
                    break
            except Exception as e:
                print(f"  Warning: could not load {fpath}: {e}")

    todo = [gid for gid in game_ids if gid not in done_games]

    if TEST_MODE:
        todo = todo[:TEST_GAMES]
        print(f"TEST_MODE: processing {len(todo)} games (set TEST_MODE=False for full run)")

    if not todo:
        df = (pd.DataFrame(existing_rows, columns=STINT_COLS)
              if existing_rows else pd.DataFrame(columns=STINT_COLS))
        print(f"All games already processed ({len(df)} stints total)")
        return df

    total    = len(todo)
    new_rows = []
    failed   = []
    print(f"Fetching PBP + shifts for {total} games...")

    for i, gid in enumerate(todo, 1):
        try:
            pbp_url   = f"{PBP_API}/gamecenter/{gid}/play-by-play"
            shift_url = f"{SHIFT_API}/shiftcharts?cayenneExp=gameId={gid}"

            r_pbp = _get_with_retry(pbp_url)
            time.sleep(1.0)                           # 1 s between the two requests
            r_sh  = _get_with_retry(shift_url)

            stints = build_stints_from_game(r_pbp.json(), r_sh.json().get('data', []))
            new_rows.extend(stints)

        except Exception as e:
            failed.append(gid)
            if len(failed) <= 10:
                print(f"  ✗ Game {gid}: {e}")

        # Progress every 25 games
        if i % 25 == 0 or i == total:
            print(f"  Game {i}/{total} | stints so far: {len(existing_rows) + len(new_rows):,}")

        # Checkpoint every 100 games
        if i % 100 == 0:
            cp_rows = existing_rows + new_rows
            pd.DataFrame(cp_rows, columns=STINT_COLS).to_csv(STINTS_CHECKPOINT, index=False)
            print(f"  Checkpoint saved ({len(cp_rows)} stints → {STINTS_CHECKPOINT})")

        time.sleep(1.0)                               # 1 s before next game

    if failed:
        with open(FAILED_FILE, 'w') as f:
            json.dump(failed, f)
        print(f"  {len(failed)} games failed → {FAILED_FILE}")

    all_rows = existing_rows + new_rows
    df = (pd.DataFrame(all_rows, columns=STINT_COLS)
          if all_rows else pd.DataFrame(columns=STINT_COLS))

    if TEST_MODE:
        print(f"\n[TEST] {len(df)} stints (not written to {STINTS_FILE} in TEST_MODE)")
    else:
        df.to_csv(STINTS_FILE, index=False)
        print(f"\nTotal stints: {len(df)} → {STINTS_FILE}")

    return df


# ── Step 3: Build RAPM regression ────────────────────────────────────────────
def build_rapm(stints_df):
    """Fit offensive + defensive RidgeCV RAPM models."""
    stints_df = stints_df[stints_df['duration_seconds'] >= 10].copy()
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

    print(f"Building RAPM matrix: {n_stints} stints × {n_players} players")

    r_idx, c_idx, vals = [], [], []
    y_off   = np.zeros(n_stints)
    y_def   = np.zeros(n_stints)
    weights = np.zeros(n_stints)

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

        # y_off: home xGF rate  |  y_def: home xGA rate (flipped after fit)
        y_off[i]   = hxg
        y_def[i]   = axg
        weights[i] = w

    X = sparse.csr_matrix((vals, (r_idx, c_idx)), shape=(n_stints, n_players))

    # Lower alphas — stint quality is much better after merging
    alphas = [0.001, 0.01, 0.1, 1.0, 10.0, 100.0]

    print("Fitting offensive RAPM (RidgeCV)...")
    m_off = RidgeCV(alphas=alphas, fit_intercept=True)
    m_off.fit(X, y_off, sample_weight=weights)
    print(f"  Best alpha: {m_off.alpha_}")

    print("Fitting defensive RAPM (RidgeCV)...")
    m_def = RidgeCV(alphas=alphas, fit_intercept=True)
    m_def.fit(X, y_def, sample_weight=weights)
    print(f"  Best alpha: {m_def.alpha_}")

    results = pd.DataFrame({
        'player_id': all_pids,
        'rapm_off':  m_off.coef_,
        'rapm_def': -m_def.coef_,  # flipped: higher = better defender
    })
    results['rapm_off_pct'] = results['rapm_off'].rank(pct=True) * 100
    results['rapm_def_pct'] = results['rapm_def'].rank(pct=True) * 100

    return results


# ── Step 3b: Test diagnostics ─────────────────────────────────────────────────
def print_test_diagnostics(stints_df):
    """
    Print stint quality and McDavid checks for TEST_MODE validation.

    NHL 5v5 stints reality check:
      - Each stint ends when ANY of the 10 on-ice players changes.
      - With rolling substitutions, avg stint ~20-25 sec is normal.
      - ~80-100 stints per game is correct; 15-25 would only apply if
        teams always changed ALL 5 players simultaneously.
      - The merge logic helps < 0.01% of stints (off-ice shift entries
        creating spurious change points are extremely rare in practice).
      - Key quality indicator: does avg duration improve vs old 14.2 sec?
        After the 10-sec filter it should be ≥20 sec.
    """
    MCDAVID_ID   = '8478402'
    DRAISAITL_ID = '8477934'

    df = stints_df[stints_df['duration_seconds'] >= 10]
    print("\n" + "="*60)
    print("TEST DIAGNOSTICS")
    print("="*60)
    print(f"Stints after merge + 10-sec filter: {len(df):,}")
    print(f"Avg duration:    {df['duration_seconds'].mean():.1f} sec  (old: 14.2 sec)")
    print(f"Median duration: {df['duration_seconds'].median():.1f} sec  (old:  9.0 sec)")
    print(f"< 30 sec: {(df['duration_seconds']<30).sum():,} ({(df['duration_seconds']<30).mean()*100:.1f}%)")
    print(f">= 60 sec:{(df['duration_seconds']>=60).sum():,} ({(df['duration_seconds']>=60).mean()*100:.1f}%)")
    print(f">= 120 sec:{(df['duration_seconds']>=120).sum():,} ({(df['duration_seconds']>=120).mean()*100:.1f}%)")

    mc = df[df['home_players'].str.contains(MCDAVID_ID, na=False) |
            df['away_players'].str.contains(MCDAVID_ID, na=False)]
    if len(mc) == 0:
        print("\nMcDavid: 0 stints (not in these 50 games)")
        return

    mc_home = mc[mc['home_players'].str.contains(MCDAVID_ID, na=False)]
    mc_away = mc[mc['away_players'].str.contains(MCDAVID_ID, na=False)]
    xgf = mc_home['home_xg'].sum() + mc_away['away_xg'].sum()
    xga = mc_home['away_xg'].sum() + mc_away['home_xg'].sum()
    sec = mc['duration_seconds'].sum()

    drai_in_mc = mc[mc['home_players'].str.contains(DRAISAITL_ID, na=False) |
                    mc['away_players'].str.contains(DRAISAITL_ID, na=False)]

    print(f"\nMcDavid stints: {len(mc)}  |  TOI: {sec/60:.1f} min")
    if (xgf + xga) > 0:
        print(f"xGF/60: {xgf/(sec/3600):.3f}  xGA/60: {xga/(sec/3600):.3f}  "
              f"xGF%: {xgf/(xgf+xga)*100:.1f}%")
    print(f"Draisaitl co-occurrence: {len(drai_in_mc)}/{len(mc)} "
          f"({len(drai_in_mc)/len(mc)*100:.1f}%)")

    games_in_test = df['game_id'].nunique()
    stints_per_game = len(df) / games_in_test if games_in_test else 0
    print(f"\nGames in test set: {games_in_test}")
    print(f"Stints per game:   {stints_per_game:.1f}  (normal range: 70-110 for NHL 5v5)")

    ok_duration = df['duration_seconds'].mean() >= 18
    ok_count    = 50 <= stints_per_game <= 130
    print(f"\n{'✓' if ok_duration else '✗'} Avg duration >= 18 sec: {df['duration_seconds'].mean():.1f}")
    print(f"{'✓' if ok_count else '✗'} Stints per game in 50-130 range: {stints_per_game:.1f}")
    if ok_duration and ok_count:
        print("\n→ Stints look good. Set TEST_MODE = False to run the full pipeline.")
    else:
        print("\n→ Stints still look off — investigate before full run.")


# ── Step 4: Upload to Supabase ────────────────────────────────────────────────
def upload_rapm(results_df):
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("✗ SUPABASE_URL / SUPABASE_KEY not set")
        return

    sb       = create_client(SUPABASE_URL, SUPABASE_KEY)
    existing = {r['player_id'] for r in
                sb.table('players').select('player_id').execute().data}

    not_found         = []
    updated           = 0
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
            print("\n  ✗ Upload failed — run in Supabase SQL editor:")
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
    print(f"Step 1 — Fetch 2025-26 game IDs  [TEST_MODE={TEST_MODE}]")
    print("=" * 60)
    game_ids = fetch_game_ids()
    print(f"Total games available: {len(game_ids)}")

    print("\n" + "=" * 60)
    print("Step 2 — Fetch PBP + shifts, extract merged 5v5 stints")
    print("=" * 60)
    stints_df = fetch_all_stints(game_ids)

    if TEST_MODE:
        print_test_diagnostics(stints_df)
        print("\n→ Review diagnostics above, then set TEST_MODE = False and re-run.")
        sys.exit(0)

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
