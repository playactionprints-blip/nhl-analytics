#!/usr/bin/env python3
"""
Build RAPM (Regularized Adjusted Plus-Minus) from 2025-26 NHL play-by-play.
Uses hockey-scraper for 100% game coverage (old NHL shift API had ~37% coverage).

BEFORE RUNNING: add columns to the Supabase players table:
    alter table players add column if not exists rapm_off     float8;
    alter table players add column if not exists rapm_def     float8;
    alter table players add column if not exists rapm_off_pct float8;
    alter table players add column if not exists rapm_def_pct float8;

USAGE:
    export SUPABASE_URL=...
    export SUPABASE_KEY=...
    python build_rapm.py

    # To refresh game IDs (add recent games), delete the cache first:
    rm data/game_ids_2526.json

Data source: hockey-scraper (wraps NHL HTML shift reports + JSON play-by-play)
  - Shift times come in seconds from period start (no MM:SS parsing needed)
  - Near-zero NaN player IDs (vs many in old shift API)
  - 100% game coverage across all tested regular-season games
"""

import json, os, re, time, math, sys, warnings
import requests
import hockey_scraper
import pandas as pd
import numpy as np
from datetime import date, timedelta
from scipy import sparse
from sklearn.linear_model import RidgeCV
from supabase import create_client

warnings.filterwarnings('ignore')

# ── Config ────────────────────────────────────────────────────────────────────
TEST_MODE  = False  # Set True to limit to TEST_GAMES for validation
TEST_GAMES = 50     # Games to process in test mode
BATCH_SIZE = 50     # Games per hockey-scraper batch

SCHEDULE_API      = "https://api-web.nhle.com/v1"
DATA_DIR          = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
GAME_IDS_FILE     = os.path.join(DATA_DIR, 'game_ids_2526.json')
STINTS_FILE       = os.path.join(DATA_DIR, 'stints_2526.csv')
STINTS_CHECKPOINT = os.path.join(DATA_DIR, 'stints_checkpoint.csv')
PATCH_FILE        = os.path.join(DATA_DIR, 'player_id_patch.json')
os.makedirs(DATA_DIR, exist_ok=True)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "nhl-analytics/1.0"})

# Load player ID patch (name → ID for hockey-scraper PBP name mismatches)
PLAYER_ID_PATCH = {}
if os.path.exists(PATCH_FILE):
    with open(PATCH_FILE) as f:
        PLAYER_ID_PATCH = json.load(f)
    print(f"Loaded player_id_patch: {len(PLAYER_ID_PATCH)} entries")


# ── Helpers ───────────────────────────────────────────────────────────────────
def compute_xg_xy(x, y, shot_type=''):
    """
    Estimate xG from shot coordinates and type.
    x, y: rink coordinates (nets at ±89 ft on the x-axis, origin at centre ice).
    The formula uses the NEARER net — abs(x)-89 is symmetric for both ends.
    """
    dist  = math.sqrt((abs(x) - 89) ** 2 + y ** 2)
    angle = abs(math.degrees(math.atan2(abs(y), max(abs(abs(x) - 89), 0.1))))

    if dist < 10:   xg = 0.35
    elif dist < 20: xg = 0.18
    elif dist < 30: xg = 0.09
    elif dist < 40: xg = 0.05
    else:           xg = 0.02

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


_DIST_RE = re.compile(r'(\d+)\s*ft', re.IGNORECASE)

def _parse_dist(desc):
    """Parse shot distance (feet) from hockey-scraper Description text."""
    m = _DIST_RE.search(str(desc))
    return int(m.group(1)) if m else None


def _hs_id_to_full(hs_id):
    """Convert hockey-scraper 5-digit game ID ('20001') → full 10-digit int (2025020001)."""
    return 2025000000 + int(hs_id)


def _get_with_retry(url, max_retries=3):
    """GET with exponential retry for NHL schedule API."""
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
        url = f"{SCHEDULE_API}/schedule/{current.isoformat()}"
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


# ── Step 2: Extract 5v5 stints ────────────────────────────────────────────────
def _merge_stints(stints):
    """
    Merge adjacent stints with identical home/away lineups.
    Two stints merge when: same lineup + same period + next start ≤ prev_end + 1 sec.
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
            prev['end_sec']          = max(prev['end_sec'], s['end_sec'])
            prev['duration_seconds'] = prev['end_sec'] - prev['start_sec']
            prev['home_xg']          = round(prev['home_xg'] + s['home_xg'], 4)
            prev['away_xg']          = round(prev['away_xg'] + s['away_xg'], 4)
        else:
            merged.append(s.copy())

    return [s for s in merged if s['duration_seconds'] >= 10]


def build_stints_from_game_hs(full_game_id, pbp_df, shifts_df):
    """
    Reconstruct 5v5 stints for one game using hockey-scraper DataFrames.

    shifts_df columns used: Period, Team, Player, Player_Id, Start, End
      - Start/End are seconds from period start (no MM:SS parsing needed)
    pbp_df columns used: Home_Team, Home_Goalie_Id, Away_Goalie_Id,
                         Event, Seconds_Elapsed, Period, xC, yC, Type,
                         Ev_Team, Description
    """
    if pbp_df.empty or shifts_df.empty:
        return []

    home_team = str(pbp_df['Home_Team'].iloc[0]).upper().strip()

    # Collect goalie IDs to exclude from skater lineups
    goalie_ids = set()
    for col in ('Home_Goalie_Id', 'Away_Goalie_Id'):
        if col in pbp_df.columns:
            for v in pbp_df[col].dropna().unique():
                try:
                    goalie_ids.add(int(float(v)))
                except (ValueError, TypeError):
                    pass

    # Parse shifts → per-player on-ice intervals (regulation only)
    player_intervals = {}
    for _, sh in shifts_df.iterrows():
        try:
            period = int(sh.get('Period', 0))
        except (ValueError, TypeError):
            continue
        if period not in (1, 2, 3):
            continue

        pid = sh.get('Player_Id')
        # Apply patch for NaN IDs using uppercase player name
        if pd.isna(pid):
            pid = PLAYER_ID_PATCH.get(str(sh.get('Player', '')).strip().upper())
        if pd.isna(pid) or not pid:
            continue
        try:
            pid = int(float(pid))
        except (ValueError, TypeError):
            continue

        if pid in goalie_ids:
            continue

        start_s = sh.get('Start', 0)
        end_s   = sh.get('End',   0)
        if pd.isna(start_s) or pd.isna(end_s):
            continue

        # Convert period-relative seconds → absolute game seconds
        abs_start = (period - 1) * 1200 + int(float(start_s))
        abs_end   = (period - 1) * 1200 + int(float(end_s))
        if abs_end <= abs_start:
            continue

        is_home = (str(sh.get('Team', '')).upper().strip() == home_team)
        player_intervals.setdefault(pid, []).append((abs_start, abs_end, is_home))

    if not player_intervals:
        return []

    # Change points from every shift boundary + hard period boundaries
    change_pts = set()
    for ivs in player_intervals.values():
        for s, e, _ in ivs:
            change_pts.add(s)
            change_pts.add(e)
    for p in range(1, 4):
        change_pts.add((p - 1) * 1200)
        change_pts.add(p * 1200)
    change_pts = sorted(change_pts)

    # xG events from PBP
    # xC/yC used when available; fall back to distance parsed from Description
    XG_TYPES = {'SHOT', 'GOAL', 'MISS'}
    xg_events = []
    for _, ev in pbp_df.iterrows():
        if str(ev.get('Event', '')).upper() not in XG_TYPES:
            continue
        try:
            period = int(ev.get('Period', 0))
        except (ValueError, TypeError):
            continue
        if period not in (1, 2, 3):
            continue
        secs = ev.get('Seconds_Elapsed', 0)
        if pd.isna(secs):
            continue
        t         = (period - 1) * 1200 + int(float(secs))
        xc        = ev.get('xC')
        yc        = ev.get('yC')
        shot_type = str(ev.get('Type', ''))

        if pd.notna(xc) and pd.notna(yc):
            xg = compute_xg_xy(float(xc), float(yc), shot_type)
        else:
            dist = _parse_dist(ev.get('Description', ''))
            if dist is None:
                continue
            # Straight-on approximation (angle_factor = 1.0) for description fallback
            xg = compute_xg_xy(89.0 - dist, 0.0, shot_type)

        is_home = (str(ev.get('Ev_Team', '')).upper().strip() == home_team)
        xg_events.append((t, xg, is_home))

    # Build micro-stints from consecutive change-point intervals
    raw_stints = []
    for i in range(len(change_pts) - 1):
        t_start = change_pts[i]
        t_end   = change_pts[i + 1]
        dur     = t_end - t_start
        if dur <= 0:
            continue
        # Drop intervals that straddle a period boundary (unless t_end is exact boundary)
        if t_start // 1200 != t_end // 1200 and t_end % 1200 != 0:
            continue
        p_start = t_start // 1200 + 1
        if p_start > 3:
            continue

        # Determine on-ice skaters using midpoint check
        t_mid = (t_start + t_end) / 2.0
        home_sk, away_sk = set(), set()
        for pid, ivs in player_intervals.items():
            for s, e, is_h in ivs:
                if s <= t_mid < e:
                    (home_sk if is_h else away_sk).add(pid)
                    break

        if len(home_sk) != 5 or len(away_sk) != 5:
            continue

        h_xg = sum(xg for t, xg, ih in xg_events if t_start <= t < t_end and ih)
        a_xg = sum(xg for t, xg, ih in xg_events if t_start <= t < t_end and not ih)

        raw_stints.append({
            'game_id':          full_game_id,
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
    Scrape all games with hockey-scraper and extract merged 5v5 stints.
    - Resumes automatically from stints_2526.csv or stints_checkpoint.csv.
    - Processes remaining games in batches of BATCH_SIZE.
    - Saves a checkpoint every 5 batches (~250 games).
    """
    # Load existing stints to find already-processed games
    existing_rows = []
    done_games    = set()
    for fpath in (STINTS_FILE, STINTS_CHECKPOINT):
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

    total        = len(todo)
    n_batches    = math.ceil(total / BATCH_SIZE)
    new_rows     = []
    failed       = []
    batches_done = 0

    print(f"Processing {total} remaining games with hockey-scraper "
          f"({n_batches} batches of {BATCH_SIZE})...")

    for batch_start in range(0, total, BATCH_SIZE):
        batch         = todo[batch_start : batch_start + BATCH_SIZE]
        batches_done += 1

        try:
            result  = hockey_scraper.scrape_games(batch, True, data_format='pandas')
            pbp_all = result.get('pbp', pd.DataFrame())
            sh_all  = result.get('shifts', pd.DataFrame())

            if pbp_all.empty or sh_all.empty:
                print(f"  Batch {batches_done}/{n_batches}: empty result — "
                      f"{len(batch)} games skipped")
                failed.extend(batch)
                continue

            # Add full 10-digit game ID column for filtering
            pbp_all['_gid_full'] = pbp_all['Game_Id'].apply(_hs_id_to_full)
            sh_all['_gid_full']  = sh_all['Game_Id'].apply(_hs_id_to_full)

            for gid in batch:
                game_pbp = pbp_all[pbp_all['_gid_full'] == gid]
                game_sh  = sh_all[sh_all['_gid_full']  == gid]
                if game_pbp.empty or game_sh.empty:
                    failed.append(gid)
                    continue
                stints = build_stints_from_game_hs(gid, game_pbp, game_sh)
                new_rows.extend(stints)

            progress = batch_start + len(batch)
            print(f"  Batch {batches_done}/{n_batches}  ({progress}/{total} games) | "
                  f"stints so far: {len(existing_rows) + len(new_rows):,}")

        except Exception as e:
            print(f"  Batch {batches_done}/{n_batches} failed: {e}")
            failed.extend(batch)

        # Checkpoint every 5 batches (~250 games)
        if batches_done % 5 == 0:
            cp_rows = existing_rows + new_rows
            pd.DataFrame(cp_rows, columns=STINT_COLS).to_csv(STINTS_CHECKPOINT, index=False)
            print(f"  Checkpoint saved ({len(cp_rows)} stints → {STINTS_CHECKPOINT})")

    if failed:
        print(f"  {len(failed)} games could not be processed")

    all_rows = existing_rows + new_rows
    df = (pd.DataFrame(all_rows, columns=STINT_COLS)
          if all_rows else pd.DataFrame(columns=STINT_COLS))

    if TEST_MODE:
        print(f"\n[TEST] {len(df)} stints (not written to {STINTS_FILE} in TEST_MODE)")
    else:
        df.to_csv(STINTS_FILE, index=False)
        print(f"\nTotal stints: {len(df)} → {STINTS_FILE}")

    return df


# ── Step 3: Build RAPM regression ─────────────────────────────────────────────
def build_rapm(stints_df):
    """Fit offensive + defensive RidgeCV RAPM models."""
    stints_df = stints_df[stints_df['duration_seconds'] >= 10].copy()
    n_stints  = len(stints_df)
    if n_stints == 0:
        raise ValueError("No stints to fit — check game fetch above")

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

        y_off[i]   = hxg
        y_def[i]   = axg
        weights[i] = w

    X = sparse.csr_matrix((vals, (r_idx, c_idx)), shape=(n_stints, n_players))

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


# ── Step 3b: Test diagnostics ──────────────────────────────────────────────────
def print_test_diagnostics(stints_df):
    MCDAVID_ID   = '8478402'
    DRAISAITL_ID = '8477934'

    df = stints_df[stints_df['duration_seconds'] >= 10]
    print("\n" + "="*60)
    print("TEST DIAGNOSTICS")
    print("="*60)
    print(f"Stints after 10-sec filter: {len(df):,}")
    print(f"Avg duration:    {df['duration_seconds'].mean():.1f} sec")
    print(f"Median duration: {df['duration_seconds'].median():.1f} sec")
    print(f"< 30 sec:  {(df['duration_seconds']<30).sum():,} "
          f"({(df['duration_seconds']<30).mean()*100:.1f}%)")
    print(f">= 60 sec: {(df['duration_seconds']>=60).sum():,} "
          f"({(df['duration_seconds']>=60).mean()*100:.1f}%)")

    mc = df[df['home_players'].str.contains(MCDAVID_ID, na=False) |
            df['away_players'].str.contains(MCDAVID_ID, na=False)]
    if len(mc) == 0:
        print("\nMcDavid: 0 stints (not in these games)")
    else:
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
    print(f"\nGames: {games_in_test} | Stints/game: {stints_per_game:.1f}  (normal: 70-110)")

    ok_duration = df['duration_seconds'].mean() >= 18
    ok_count    = 50 <= stints_per_game <= 130
    print(f"\n{'✓' if ok_duration else '✗'} Avg duration >= 18 sec")
    print(f"{'✓' if ok_count else '✗'} Stints/game in 50-130 range")
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

    not_found          = []
    updated            = 0
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
    print("  Tip: delete data/game_ids_2526.json to refresh with latest games.")
    print("=" * 60)
    game_ids = fetch_game_ids()
    print(f"Total games available: {len(game_ids)}")

    print("\n" + "=" * 60)
    print("Step 2 — Scrape shifts + PBP, extract merged 5v5 stints")
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
