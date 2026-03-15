#!/usr/bin/env python3
"""
Build RAPM (Regularized Adjusted Plus-Minus) from NHL play-by-play.
Uses hockey-scraper for 100% game coverage (old NHL shift API had ~37% coverage).
Fetches 3 seasons and combines with season weights:
  25-26 stints: ×1.0  |  24-25 stints: ×0.7  |  23-24 stints: ×0.5

BEFORE RUNNING: add columns to the Supabase players table:
    alter table players add column if not exists rapm_off     float8;
    alter table players add column if not exists rapm_def     float8;
    alter table players add column if not exists rapm_off_pct float8;
    alter table players add column if not exists rapm_def_pct float8;

USAGE:
    export SUPABASE_URL=...
    export SUPABASE_KEY=...
    python build_rapm.py

    # To refresh game IDs (add recent games), delete the season cache:
    rm data/game_ids_2526.json   # re-fetch 25-26 IDs
    rm data/game_ids_2425.json   # re-fetch 24-25 IDs
    rm data/game_ids_2324.json   # re-fetch 23-24 IDs

Data source: hockey-scraper (wraps NHL HTML shift reports + JSON play-by-play)
  - Shift times come in seconds from period start (no MM:SS parsing needed)
  - Near-zero NaN player IDs (vs many in old shift API)
  - 100% game coverage across all tested regular-season games
"""

import json, os, re, time, math, sys, warnings, unicodedata
from collections import defaultdict
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
TEST_MODE  = False  # Set True to limit to TEST_GAMES per season for validation
TEST_GAMES = 50
BATCH_SIZE = 50     # Games per hockey-scraper batch

SCHEDULE_API = "https://api-web.nhle.com/v1"
DATA_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
PATCH_FILE   = os.path.join(DATA_DIR, 'player_id_patch.json')
os.makedirs(DATA_DIR, exist_ok=True)

# Player IDs used for quality gate before uploading
MCDAVID_ID   = 8478402
DRAISAITL_ID = 8477934

# Season configuration — newest first (25-26 resume priority preserved)
SEASON_CONFIGS = {
    '25-26': {
        'start_date': date(2025, 10, 1),
        'end_date':   date(2026, 4, 18),
        'id_base':    2025000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_2526.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_2526.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint.csv'),
        'weight':     1.0,
    },
    '24-25': {
        'start_date': date(2024, 10, 1),
        'end_date':   date(2025, 4, 18),
        'id_base':    2024000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_2425.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_2425.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_2425.csv'),
        'weight':     0.7,
    },
    '23-24': {
        'start_date': date(2023, 10, 1),
        'end_date':   date(2024, 4, 18),
        'id_base':    2023000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_2324.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_2324.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_2324.csv'),
        'weight':     0.5,
    },
}

CARD_SEASON_WEIGHTS = {
    '25-26': 0.50,
    '24-25': 0.30,
    '23-24': 0.20,
}
MIN_TOI_MINUTES = 200
MAX_RAPM = 5.0
QOT_QOC_TOI_SHRINK = 600.0
QOT_QOC_MAX_ABS = 2.5
QOT_IMPACT_OFF_WEIGHT = 0.7
QOT_IMPACT_DEF_WEIGHT = 0.3

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

NAME_PREFIX_ALIASES = {
    "JOSEPH ": "JOE ",
    "MIKEY ": "MICHAEL ",
    "JOSH ": "JOSHUA ",
    "SAM ": "SAMUEL ",
}


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


def _hs_id_to_full(hs_id, base):
    """
    Convert hockey-scraper 5-digit game ID ('20001') → full 10-digit int.
    base varies by season: 2025000000 / 2024000000 / 2023000000.
    """
    return base + int(hs_id)


def _normalize_player_name(name):
    """
    Normalize player names for ID patch lookup.
    Handles accents, spacing drift, and common nickname/official-name mismatches.
    """
    value = str(name or "").strip().upper()
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"\s+", " ", value).strip()
    for src, dst in NAME_PREFIX_ALIASES.items():
        if value.startswith(src):
            value = dst + value[len(src):]
            break
    return value


PLAYER_ID_PATCH_NORM = {
    _normalize_player_name(name): player_id
    for name, player_id in PLAYER_ID_PATCH.items()
}


def _lookup_player_patch(name):
    raw_name = str(name or "").strip().upper()
    return PLAYER_ID_PATCH.get(raw_name) or PLAYER_ID_PATCH_NORM.get(_normalize_player_name(name))


def _coerce_scrape_frame(frame):
    return frame if isinstance(frame, pd.DataFrame) else pd.DataFrame()


def _extract_batch_stints(batch, result, id_base, failed):
    pbp_all = _coerce_scrape_frame(result.get('pbp') if isinstance(result, dict) else None)
    sh_all = _coerce_scrape_frame(result.get('shifts') if isinstance(result, dict) else None)
    if pbp_all.empty or sh_all.empty:
        failed.extend(batch)
        return []

    pbp_all = pbp_all.copy()
    sh_all = sh_all.copy()
    pbp_all['_gid_full'] = pbp_all['Game_Id'].apply(lambda x: _hs_id_to_full(x, id_base))
    sh_all['_gid_full'] = sh_all['Game_Id'].apply(lambda x: _hs_id_to_full(x, id_base))

    rows = []
    for gid in batch:
        game_pbp = pbp_all[pbp_all['_gid_full'] == gid]
        game_sh = sh_all[sh_all['_gid_full'] == gid]
        if game_pbp.empty or game_sh.empty:
            failed.append(gid)
            continue
        rows.extend(build_stints_from_game_hs(gid, game_pbp, game_sh))
    return rows


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


def parse_player_ids(cell):
    if pd.isna(cell):
        return []
    return [int(p) for p in str(cell).split('|') if p.strip()]


def filter_qualified_results(results_df, min_toi_minutes=MIN_TOI_MINUTES, max_rapm=MAX_RAPM):
    """Apply a 5v5 TOI floor and drop physically impossible RAPM values."""
    qualified = results_df[results_df['toi_5v5_total'] >= min_toi_minutes].copy()
    qualified = qualified[
        (qualified['rapm_off'].abs() <= max_rapm) &
        (qualified['rapm_def'].abs() <= max_rapm)
    ].copy()
    if qualified.empty:
        return qualified

    qualified['rapm_off_pct'] = qualified['rapm_off'].rank(pct=True) * 100
    qualified['rapm_def_pct'] = qualified['rapm_def'].rank(pct=True) * 100
    return qualified


def compute_context_metrics(stints_df, results_df):
    """
    First-pass QoT/QoC from season RAPM, shrunk toward neutral context.
    QoT = TOI-weighted average teammate impact.
    QoC = TOI-weighted average opponent impact.
    """
    if results_df.empty:
        return pd.DataFrame(columns=['player_id', 'qot_impact', 'qoc_impact', 'qot_impact_pct', 'qoc_impact_pct'])

    impact_map = {
        int(row.player_id): (float(row.rapm_off) * QOT_IMPACT_OFF_WEIGHT) + (float(row.rapm_def) * QOT_IMPACT_DEF_WEIGHT)
        for row in results_df.itertuples()
    }
    toi_map = {
        int(row.player_id): float(getattr(row, 'toi_5v5_total', 0.0) or 0.0)
        for row in results_df.itertuples()
    }
    qot_num = defaultdict(float)
    qot_den = defaultdict(float)
    qoc_num = defaultdict(float)
    qoc_den = defaultdict(float)

    for stint in stints_df[stints_df['duration_seconds'] >= 10].itertuples():
        home_pids = parse_player_ids(stint.home_players)
        away_pids = parse_player_ids(stint.away_players)
        duration_min = float(stint.duration_seconds) / 60.0
        if duration_min <= 0:
            continue

        home_impacts = {pid: impact_map[pid] for pid in home_pids if pid in impact_map}
        away_impacts = {pid: impact_map[pid] for pid in away_pids if pid in impact_map}
        if not home_impacts and not away_impacts:
            continue

        home_opp_avg = sum(away_impacts.values()) / len(away_impacts) if away_impacts else None
        away_opp_avg = sum(home_impacts.values()) / len(home_impacts) if home_impacts else None

        for pid in home_pids:
            if pid not in impact_map:
                continue
            teammate_vals = [impact_map[t] for t in home_pids if t != pid and t in impact_map]
            if teammate_vals:
                qot_num[pid] += (sum(teammate_vals) / len(teammate_vals)) * duration_min
                qot_den[pid] += duration_min
            if home_opp_avg is not None:
                qoc_num[pid] += home_opp_avg * duration_min
                qoc_den[pid] += duration_min

        for pid in away_pids:
            if pid not in impact_map:
                continue
            teammate_vals = [impact_map[t] for t in away_pids if t != pid and t in impact_map]
            if teammate_vals:
                qot_num[pid] += (sum(teammate_vals) / len(teammate_vals)) * duration_min
                qot_den[pid] += duration_min
            if away_opp_avg is not None:
                qoc_num[pid] += away_opp_avg * duration_min
                qoc_den[pid] += duration_min

    rows = []
    for pid in results_df['player_id'].tolist():
        qot_raw = qot_num[pid] / qot_den[pid] if qot_den[pid] > 0 else None
        qoc_raw = qoc_num[pid] / qoc_den[pid] if qoc_den[pid] > 0 else None
        toi_minutes = toi_map.get(int(pid), 0.0)
        shrink = toi_minutes / (toi_minutes + QOT_QOC_TOI_SHRINK) if toi_minutes > 0 else 0.0
        qot = max(-QOT_QOC_MAX_ABS, min(QOT_QOC_MAX_ABS, qot_raw * shrink)) if qot_raw is not None else None
        qoc = max(-QOT_QOC_MAX_ABS, min(QOT_QOC_MAX_ABS, qoc_raw * shrink)) if qoc_raw is not None else None
        rows.append({
            'player_id': int(pid),
            'qot_impact': qot,
            'qoc_impact': qoc,
        })

    context_df = pd.DataFrame(rows)
    if context_df.empty:
        return context_df

    if context_df['qot_impact'].notna().any():
        context_df['qot_impact_pct'] = context_df['qot_impact'].rank(pct=True) * 100
    else:
        context_df['qot_impact_pct'] = None

    if context_df['qoc_impact'].notna().any():
        context_df['qoc_impact_pct'] = context_df['qoc_impact'].rank(pct=True) * 100
    else:
        context_df['qoc_impact_pct'] = None

    return context_df


def project_season_results(season_results):
    """Weighted 3-year projection from season RAPM/context into the players table."""
    grouped = defaultdict(dict)
    for season_key, df in season_results.items():
        for row in df.itertuples():
            grouped[int(row.player_id)][season_key] = row

    rows = []
    for pid, season_map in grouped.items():
        data = {'player_id': pid}
        toi_weighted = 0.0
        weight_sum = 0.0
        for season_key, row in season_map.items():
            weight = CARD_SEASON_WEIGHTS.get(season_key, 0.0)
            toi_weighted += weight * float(getattr(row, 'toi_5v5_total', 0.0) or 0.0)
            weight_sum += weight
        data['toi_5v5_total'] = round(toi_weighted, 1) if weight_sum > 0 else 0.0

        for metric in ('rapm_off', 'rapm_def', 'qot_impact', 'qoc_impact'):
            num = 0.0
            den = 0.0
            for season_key, row in season_map.items():
                weight = CARD_SEASON_WEIGHTS.get(season_key, 0.0)
                if metric in ('qot_impact', 'qoc_impact'):
                    reliability = min(1.0, float(getattr(row, 'toi_5v5_total', 0.0) or 0.0) / 500.0)
                    weight *= reliability
                value = getattr(row, metric, None)
                if value is None or pd.isna(value):
                    continue
                num += float(value) * weight
                den += weight
            data[metric] = (num / den) if den > 0 else None
        rows.append(data)

    projected = pd.DataFrame(rows)
    if projected.empty:
        return projected

    for metric in ('rapm_off', 'rapm_def', 'qot_impact', 'qoc_impact'):
        pct_col = f'{metric}_pct'
        if projected[metric].notna().any():
            projected[pct_col] = projected[metric].rank(pct=True) * 100
        else:
            projected[pct_col] = None
    return projected


# ── Step 1: Fetch regular-season game IDs for one season ─────────────────────
def fetch_game_ids(season_cfg):
    """
    Load game IDs from cache or fetch from NHL schedule API.
    For completed seasons the end_date is fixed; for the current season
    we stop at today so we don't request future dates.
    """
    ids_file   = season_cfg['ids_file']
    start_date = season_cfg['start_date']
    end_date   = min(season_cfg['end_date'], date.today())

    if os.path.exists(ids_file):
        with open(ids_file) as f:
            ids = json.load(f)
        print(f"  Loaded {len(ids)} game IDs from cache ({os.path.basename(ids_file)})")
        return ids

    game_ids = set()
    current  = start_date
    print(f"  Fetching schedule {start_date} → {end_date}...")
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
        time.sleep(1.0)

    ids = sorted(game_ids)
    with open(ids_file, 'w') as f:
        json.dump(ids, f)
    print(f"  Found {len(ids)} regular-season games → {os.path.basename(ids_file)}")
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
                s.get('home_score_diff') == prev.get('home_score_diff') and
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
        # Apply patch for NaN IDs using normalized player name
        if pd.isna(pid):
            pid = _lookup_player_patch(sh.get('Player', ''))
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

    # xG events from PBP
    # xC/yC used when available; fall back to distance parsed from Description
    XG_TYPES = {'SHOT', 'GOAL', 'MISS'}
    xg_events = []
    goal_events = []
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
        if str(ev.get('Event', '')).upper() == 'GOAL':
            goal_events.append((t, is_home))

    for goal_time, _ in goal_events:
        change_pts.add(goal_time)
    change_pts = sorted(change_pts)

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
        home_goals_before = sum(1 for t, ih in goal_events if t < t_start and ih)
        away_goals_before = sum(1 for t, ih in goal_events if t < t_start and not ih)

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
            'home_score_diff':  int(home_goals_before - away_goals_before),
        })

    return _merge_stints(raw_stints)


STINT_COLS = [
    'game_id', 'period', 'start_sec', 'end_sec', 'duration_seconds',
    'home_players', 'away_players', 'home_xg', 'away_xg', 'home_score_diff',
]


def fetch_all_stints(game_ids, season_cfg):
    """
    Scrape all games for one season and extract merged 5v5 stints.
    Resumes automatically from existing stints_file or ckpt_file.
    Saves a checkpoint every 5 batches (~250 games).
    """
    stints_file = season_cfg['stints_file']
    ckpt_file   = season_cfg['ckpt_file']
    id_base     = season_cfg['id_base']

    # Load existing stints to find already-processed games
    existing_rows = []
    done_games    = set()
    for fpath in (stints_file, ckpt_file):
        if os.path.exists(fpath):
            try:
                df_ex = pd.read_csv(fpath)
                if len(df_ex) > 0:
                    existing_rows = df_ex.to_dict('records')
                    done_games    = set(df_ex['game_id'].unique())
                    print(f"  Resuming from {os.path.basename(fpath)}: "
                          f"{len(done_games)} games done, {len(existing_rows)} stints loaded")
                    break
            except Exception as e:
                print(f"  Warning: could not load {fpath}: {e}")

    todo = [gid for gid in game_ids if gid not in done_games]

    if TEST_MODE:
        todo = todo[:TEST_GAMES]
        print(f"  TEST_MODE: processing {len(todo)} games")

    if not todo:
        df = (pd.DataFrame(existing_rows, columns=STINT_COLS)
              if existing_rows else pd.DataFrame(columns=STINT_COLS))
        print(f"  All games already processed ({len(df)} stints total)")
        return df

    total        = len(todo)
    n_batches    = math.ceil(total / BATCH_SIZE)
    new_rows     = []
    failed       = []
    batches_done = 0

    print(f"  Processing {total} remaining games "
          f"({n_batches} batches of {BATCH_SIZE})...")

    for batch_start in range(0, total, BATCH_SIZE):
        batch         = todo[batch_start : batch_start + BATCH_SIZE]
        batches_done += 1

        try:
            result = hockey_scraper.scrape_games(batch, True, data_format='pandas')
            if result is None:
                raise ValueError("scraper returned None")

            batch_failed = []
            batch_rows = _extract_batch_stints(batch, result, id_base, batch_failed)
            if not batch_rows:
                raise ValueError("empty batch result")
            new_rows.extend(batch_rows)
            failed.extend(batch_failed)

            progress = batch_start + len(batch)
            print(f"  Batch {batches_done}/{n_batches}  ({progress}/{total} games) | "
                  f"stints so far: {len(existing_rows) + len(new_rows):,}")

        except Exception as e:
            print(f"  Batch {batches_done}/{n_batches} failed: {e}")
            for gid in batch:
                try:
                    single_result = hockey_scraper.scrape_games([gid], True, data_format='pandas')
                    single_failed = []
                    single_rows = _extract_batch_stints([gid], single_result, id_base, single_failed)
                    if single_rows:
                        new_rows.extend(single_rows)
                    else:
                        failed.extend(single_failed or [gid])
                except Exception as game_err:
                    print(f"    Game {gid} failed: {game_err}")
                    failed.append(gid)

        # Checkpoint every 5 batches (~250 games)
        if batches_done % 5 == 0:
            cp_rows = existing_rows + new_rows
            pd.DataFrame(cp_rows, columns=STINT_COLS).to_csv(ckpt_file, index=False)
            print(f"  Checkpoint: {len(cp_rows):,} stints → {os.path.basename(ckpt_file)}")

    if failed:
        print(f"  {len(failed)} games could not be processed")

    all_rows = existing_rows + new_rows
    df = (pd.DataFrame(all_rows, columns=STINT_COLS)
          if all_rows else pd.DataFrame(columns=STINT_COLS))

    if TEST_MODE:
        print(f"  [TEST] {len(df)} stints (not written in TEST_MODE)")
    else:
        df.to_csv(stints_file, index=False)
        print(f"  Total stints: {len(df):,} → {os.path.basename(stints_file)}")

    return df


# ── Step 3: Build RAPM regression ─────────────────────────────────────────────
def build_rapm(stints_df):
    """
    Fit offense/defense RAPM on combined stints with separate coefficient blocks.
    Each observation models one team's xG rate in a stint:
      - offensive columns for the attacking skaters
      - defensive columns for the defending skaters
    This avoids the earlier leakage where elite offensive players could inherit
    artificially strong defensive coefficients from one blended player term.
    """
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
    context_features = ['is_home_attack', 'score_state', 'score_state_abs', 'period_2', 'period_3']
    n_context = len(context_features)

    # Vectorised per-player 5v5 TOI (seconds) — used later for min-TOI filter
    def _explode_toi(col):
        s = stints_df[[col, 'duration_seconds']].copy()
        s[col] = s[col].str.split('|')
        s = s.explode(col)
        s = s[s[col].str.strip() != '']
        s[col] = s[col].astype(int)
        return s.groupby(col)['duration_seconds'].sum()

    toi_home = _explode_toi('home_players')
    toi_away = _explode_toi('away_players')
    player_toi_sec = toi_home.add(toi_away, fill_value=0)

    has_season_weight = 'season_weight' in stints_df.columns
    print(f"Building RAPM matrix: {n_stints*2:,} rows × {n_players * 2 + n_context} features"
          + (" (season-weighted)" if has_season_weight else ""))

    r_idx, c_idx, vals = [], [], []
    y = np.zeros(n_stints * 2)
    weights = np.zeros(n_stints * 2)
    off_offset = 0
    def_offset = n_players
    ctx_offset = n_players * 2

    for i, (_, stint) in enumerate(stints_df.iterrows()):
        dur    = float(stint['duration_seconds'])
        dur_h  = dur / 3600.0
        seas_w = float(stint['season_weight']) if has_season_weight else 1.0
        w      = math.sqrt(dur) * seas_w

        hxg = float(stint['home_xg']) / dur_h
        axg = float(stint['away_xg']) / dur_h

        h_pids = [int(p) for p in str(stint['home_players']).split('|') if p.strip()]
        a_pids = [int(p) for p in str(stint['away_players']).split('|') if p.strip()]

        home_row = i * 2
        away_row = home_row + 1
        home_score_state = max(-2.0, min(2.0, float(stint.get('home_score_diff', 0) or 0)))
        away_score_state = -home_score_state
        period = int(stint.get('period', 0) or 0)

        for pid in h_pids:
            if pid in pid_idx:
                col = pid_idx[pid]
                r_idx.append(home_row); c_idx.append(off_offset + col); vals.append(1.0)
                r_idx.append(away_row); c_idx.append(def_offset + col); vals.append(1.0)
        for pid in a_pids:
            if pid in pid_idx:
                col = pid_idx[pid]
                r_idx.append(away_row); c_idx.append(off_offset + col); vals.append(1.0)
                r_idx.append(home_row); c_idx.append(def_offset + col); vals.append(1.0)

        for row_idx, is_home_attack, score_state in (
            (home_row, 1.0, home_score_state),
            (away_row, 0.0, away_score_state),
        ):
            ctx_vals = [
                is_home_attack,
                score_state,
                abs(score_state),
                1.0 if period == 2 else 0.0,
                1.0 if period == 3 else 0.0,
            ]
            for ctx_col, ctx_val in enumerate(ctx_vals):
                if ctx_val == 0.0:
                    continue
                r_idx.append(row_idx)
                c_idx.append(ctx_offset + ctx_col)
                vals.append(ctx_val)

        y[home_row] = hxg
        y[away_row] = axg
        weights[home_row] = w
        weights[away_row] = w

    X = sparse.csr_matrix((vals, (r_idx, c_idx)), shape=(n_stints * 2, n_players * 2 + n_context))

    alphas = [0.001, 0.01, 0.1, 1.0, 10.0, 100.0]

    print("Fitting joint offense/defense RAPM (RidgeCV)...")
    model = RidgeCV(alphas=alphas, fit_intercept=True)
    model.fit(X, y, sample_weight=weights)
    print(f"  Best alpha: {model.alpha_}")

    coef = model.coef_
    rapm_off = coef[:n_players]
    rapm_def = -coef[n_players:n_players * 2]  # lower xGA allowed = better defense

    results = pd.DataFrame({
        'player_id':     all_pids,
        'rapm_off':      rapm_off,
        'rapm_def':      rapm_def,
        'toi_5v5_total': [round(float(player_toi_sec.get(p, 0)) / 60.0, 1) for p in all_pids],
    })
    results['rapm_off_pct'] = results['rapm_off'].rank(pct=True) * 100
    results['rapm_def_pct'] = results['rapm_def'].rank(pct=True) * 100

    return results


# ── Step 3b: Test diagnostics ──────────────────────────────────────────────────
def print_test_diagnostics(stints_df):
    MCDAVID_ID_STR   = str(MCDAVID_ID)
    DRAISAITL_ID_STR = str(DRAISAITL_ID)

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

    mc = df[df['home_players'].str.contains(MCDAVID_ID_STR, na=False) |
            df['away_players'].str.contains(MCDAVID_ID_STR, na=False)]
    if len(mc) == 0:
        print("\nMcDavid: 0 stints (not in these games)")
    else:
        mc_home = mc[mc['home_players'].str.contains(MCDAVID_ID_STR, na=False)]
        mc_away = mc[mc['away_players'].str.contains(MCDAVID_ID_STR, na=False)]
        xgf = mc_home['home_xg'].sum() + mc_away['away_xg'].sum()
        xga = mc_home['away_xg'].sum() + mc_away['home_xg'].sum()
        sec = mc['duration_seconds'].sum()
        drai_in_mc = mc[mc['home_players'].str.contains(DRAISAITL_ID_STR, na=False) |
                        mc['away_players'].str.contains(DRAISAITL_ID_STR, na=False)]
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
            'qot_impact':   round(float(row['qot_impact']), 4) if pd.notna(row.get('qot_impact')) else None,
            'qoc_impact':   round(float(row['qoc_impact']), 4) if pd.notna(row.get('qoc_impact')) else None,
            'qot_impact_pct': round(float(row['qot_impact_pct']), 1) if pd.notna(row.get('qot_impact_pct')) else None,
            'qoc_impact_pct': round(float(row['qoc_impact_pct']), 1) if pd.notna(row.get('qoc_impact_pct')) else None,
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
            print("      alter table players add column if not exists qot_impact float8;")
            print("      alter table players add column if not exists qoc_impact float8;")
            print("      alter table players add column if not exists qot_impact_pct float8;")
            print("      alter table players add column if not exists qoc_impact_pct float8;")

    print(f"\nUploaded RAPM for {updated} players")
    if not_found:
        print(f"  {len(not_found)} IDs not in Supabase: {not_found[:20]}"
              f"{'...' if len(not_found) > 20 else ''}")


def upload_season_rapm(season_key, results_df):
    """Upload season RAPM/context to player_seasons."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("✗ SUPABASE_URL / SUPABASE_KEY not set")
        return

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    existing = {
        (r['player_id'], r['season'])
        for r in sb.table('player_seasons').select('player_id,season').eq('season', season_key).execute().data
    }
    updated = 0
    missing = 0
    for row in results_df.itertuples():
        key = (int(row.player_id), season_key)
        if key not in existing:
            missing += 1
            continue
        data = {
            'rapm_off': round(float(row.rapm_off), 4),
            'rapm_def': round(float(row.rapm_def), 4),
            'rapm_off_pct': round(float(row.rapm_off_pct), 1),
            'rapm_def_pct': round(float(row.rapm_def_pct), 1),
            'qot_impact': round(float(row.qot_impact), 4) if pd.notna(getattr(row, 'qot_impact', None)) else None,
            'qoc_impact': round(float(row.qoc_impact), 4) if pd.notna(getattr(row, 'qoc_impact', None)) else None,
            'qot_impact_pct': round(float(row.qot_impact_pct), 1) if pd.notna(getattr(row, 'qot_impact_pct', None)) else None,
            'qoc_impact_pct': round(float(row.qoc_impact_pct), 1) if pd.notna(getattr(row, 'qoc_impact_pct', None)) else None,
        }
        result = (
            sb.table('player_seasons')
            .update(data)
            .eq('player_id', int(row.player_id))
            .eq('season', season_key)
            .execute()
        )
        if result.data:
            updated += 1

    print(f"  Uploaded season RAPM/context for {season_key}: {updated} rows")
    if missing:
        print(f"    Missing player_seasons rows skipped: {missing}")


def null_impossible_rapm(sb):
    """
    Set rapm_off/rapm_def to NULL in Supabase for any player where
    abs(rapm_off) > 5.0 or abs(rapm_def) > 5.0.
    These values are physically impossible and indicate small-sample regression blow-up.
    """
    rows = sb.table('players').select('player_id,rapm_off,rapm_def').execute().data
    to_null = [
        r['player_id'] for r in rows
        if (r.get('rapm_off') is not None and abs(float(r['rapm_off'])) > 5.0)
        or (r.get('rapm_def') is not None and abs(float(r['rapm_def'])) > 5.0)
    ]
    if not to_null:
        print("  No impossible RAPM values found (all abs() ≤ 5.0)")
        return
    print(f"  Nulling out {len(to_null)} players with |RAPM| > 5.0...")
    null_data = {
        'rapm_off': None,
        'rapm_def': None,
        'rapm_off_pct': None,
        'rapm_def_pct': None,
        'qot_impact': None,
        'qoc_impact': None,
        'qot_impact_pct': None,
        'qoc_impact_pct': None,
    }
    sb.table('players').update(null_data).in_('player_id', to_null).execute()
    print(f"  Done — {len(to_null)} impossible RAPM values cleared")


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

    forwards = df[df['position'] != 'D'].copy()
    defense = df[df['position'] == 'D'].copy()
    if not forwards.empty:
        print("\n--- TOP 10 OFFENSIVE FORWARDS ---")
        top = forwards.nlargest(10, 'rapm_off')[['full_name', 'position', 'rapm_off', 'rapm_off_pct']]
        print(top.to_string(index=False, float_format=lambda x: f"{x:7.3f}"))

        print("\n--- TOP 10 DEFENSIVE FORWARDS ---")
        top = forwards.nlargest(10, 'rapm_def')[['full_name', 'position', 'rapm_def', 'rapm_def_pct']]
        print(top.to_string(index=False, float_format=lambda x: f"{x:7.3f}"))
    if not defense.empty:
        print("\n--- TOP 10 OFFENSIVE DEFENCEMEN ---")
        top = defense.nlargest(10, 'rapm_off')[['full_name', 'position', 'rapm_off', 'rapm_off_pct']]
        print(top.to_string(index=False, float_format=lambda x: f"{x:7.3f}"))

        print("\n--- TOP 10 DEFENSIVE DEFENCEMEN ---")
        top = defense.nlargest(10, 'rapm_def')[['full_name', 'position', 'rapm_def', 'rapm_def_pct']]
        print(top.to_string(index=False, float_format=lambda x: f"{x:7.3f}"))

    # Spotlight: key players
    spotlight = {
        'Connor McDavid': MCDAVID_ID,
        'Leon Draisaitl': DRAISAITL_ID,
        'Nathan MacKinnon': 8478402,  # same placeholder — will be overridden by name lookup
    }
    # Use name lookup instead of hardcoded IDs for non-McDavid players
    name_to_pid = {v.get('full_name'): k for k, v in info.items()}
    spotlight = {
        'Connor McDavid':   name_to_pid.get('Connor McDavid',   MCDAVID_ID),
        'Leon Draisaitl':   name_to_pid.get('Leon Draisaitl',   DRAISAITL_ID),
        'Nathan MacKinnon': name_to_pid.get('Nathan MacKinnon', 0),
        'Nikita Kucherov':  name_to_pid.get('Nikita Kucherov',  0),
        'Darren Raddysh':   name_to_pid.get('Darren Raddysh',   0),
    }
    print("\n--- SPOTLIGHT PLAYERS ---")
    print(f"  {'Player':<20}  {'rapm_off':>8}  {'off_pct':>7}  {'rapm_def':>8}  {'def_pct':>7}")
    print(f"  {'-'*20}  {'-'*8}  {'-'*7}  {'-'*8}  {'-'*7}")
    for name, pid in spotlight.items():
        row = results_df[results_df['player_id'] == pid]
        if len(row) == 0:
            print(f"  {name:<20}  {'N/A':>8}")
            continue
        r = row.iloc[0]
        print(f"  {name:<20}  {r['rapm_off']:>8.3f}  {r['rapm_off_pct']:>7.1f}  "
              f"{r['rapm_def']:>8.3f}  {r['rapm_def_pct']:>7.1f}")


# ── Step 5: Quality gate before uploading ────────────────────────────────────
def check_and_maybe_upload(results_df):
    """
    Apply min-TOI filter, null impossible values, then upload projected RAPM if quality gate passes.
    Quality gate: McDavid rapm_off_pct > 70th AND Draisaitl rapm_off_pct >= 59.5th.
    """
    # ── Min-TOI filter: remove small-sample noise ─────────────────────────────
    MIN_TOI_MINUTES = 200
    n_before = len(results_df)
    results_df = results_df[results_df['toi_5v5_total'] >= MIN_TOI_MINUTES].copy()
    n_after = len(results_df)
    print(f"\nMin-TOI filter (≥{MIN_TOI_MINUTES} min 5v5): {n_before} → {n_after} players "
          f"(removed {n_before - n_after} low-sample players)")

    # Recompute percentile ranks within the filtered qualified set
    results_df['rapm_off_pct'] = results_df['rapm_off'].rank(pct=True) * 100
    results_df['rapm_def_pct'] = results_df['rapm_def'].rank(pct=True) * 100

    # Drop remaining impossible values (physically unreachable regardless of sample size)
    MAX_RAPM = 5.0
    n_extreme = (
        (results_df['rapm_off'].abs() > MAX_RAPM) |
        (results_df['rapm_def'].abs() > MAX_RAPM)
    ).sum()
    if n_extreme:
        results_df = results_df[
            (results_df['rapm_off'].abs() <= MAX_RAPM) &
            (results_df['rapm_def'].abs() <= MAX_RAPM)
        ].copy()
        print(f"  Removed {n_extreme} players with |RAPM| > {MAX_RAPM}")
        # Recompute percentiles after removing extreme values
        results_df['rapm_off_pct'] = results_df['rapm_off'].rank(pct=True) * 100
        results_df['rapm_def_pct'] = results_df['rapm_def'].rank(pct=True) * 100

    mc_row = results_df[results_df['player_id'] == MCDAVID_ID]
    dr_row = results_df[results_df['player_id'] == DRAISAITL_ID]

    mc_pct = float(mc_row['rapm_off_pct'].values[0]) if len(mc_row) else 0.0
    dr_pct = float(dr_row['rapm_off_pct'].values[0]) if len(dr_row) else 0.0

    print(f"\nQuality gate (McDavid >70th pct AND Draisaitl >=59.5th pct):")
    print(f"  McDavid   rapm_off_pct: {mc_pct:.1f}  {'✓' if mc_pct > 70 else '✗'}")
    print(f"  Draisaitl rapm_off_pct: {dr_pct:.1f}  {'✓' if dr_pct >= 59.5 else '✗'}")

    if mc_pct > 70 and dr_pct >= 59.5:
        print("\n✓ Conditions met — uploading projected 3-year RAPM card to Supabase")
        if SUPABASE_URL and SUPABASE_KEY:
            sb = create_client(SUPABASE_URL, SUPABASE_KEY)
            null_impossible_rapm(sb)
        upload_rapm(results_df)
        print_leaderboards(results_df)
        print("\nNext steps:")
        print("  1. Season RAPM is stored on player_seasons; projected RAPM is refreshed on players")
        print("  2. Re-run: python compute_ratings.py")
        return True
    else:
        print("\n✗ Conditions not met — not uploading projected RAPM card")
        print("  The projected RAPM still doesn't clearly separate elite players.")
        if SUPABASE_URL and SUPABASE_KEY:
            sb = create_client(SUPABASE_URL, SUPABASE_KEY)
            null_impossible_rapm(sb)
        print_leaderboards(results_df)
        return False


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 60)
    print(f"RAPM Pipeline — 3-season build  [TEST_MODE={TEST_MODE}]")
    print("  Tip: delete a season's game_ids_XXXX.json to refresh its IDs.")
    print("=" * 60)

    # Steps 1+2: fetch game IDs and stints for all 3 seasons
    season_dfs = {}
    for season_key, season_cfg in SEASON_CONFIGS.items():
        print(f"\n{'='*60}")
        print(f"Season {season_key}  (weight ×{season_cfg['weight']})")
        print(f"{'='*60}")

        print(f"Step 1 — Game IDs for {season_key}")
        game_ids = fetch_game_ids(season_cfg)
        print(f"  Total: {len(game_ids)} games")

        print(f"\nStep 2 — Stints for {season_key}")
        stints = fetch_all_stints(game_ids, season_cfg)
        stints['season_weight'] = season_cfg['weight']
        season_dfs[season_key] = stints
        print(f"  {len(stints):,} stints loaded for {season_key}")

    if TEST_MODE:
        # Run diagnostics on 25-26 only and exit
        print_test_diagnostics(season_dfs['25-26'])
        print("\n→ Review diagnostics above, then set TEST_MODE = False and re-run.")
        sys.exit(0)

    # Step 3: build per-season RAPM + first-pass context
    print(f"\n{'='*60}")
    print("Step 3 — Per-season RAPM + context")
    print(f"{'='*60}")

    season_results = {}
    for season_key, stints in season_dfs.items():
        print(f"\n{season_key}: fitting season RAPM")
        raw_results = build_rapm(stints)
        qualified = filter_qualified_results(raw_results)
        print(
            f"  Qualified skaters for {season_key}: "
            f"{len(qualified)}/{len(raw_results)} (≥{MIN_TOI_MINUTES} min 5v5)"
        )
        context = compute_context_metrics(stints, qualified)
        merged = qualified.merge(context, on='player_id', how='left')
        season_results[season_key] = merged
        upload_season_rapm(season_key, merged)

    # Step 4: project per-season RAPM to 3-year card RAPM and upload to players
    print(f"\n{'='*60}")
    print("Step 4 — Project 3-year RAPM card")
    print(f"{'='*60}")
    projected = project_season_results(season_results)
    if projected.empty:
        print("✗ No projected RAPM rows were produced")
        sys.exit(1)
    check_and_maybe_upload(projected)

    print("\n✓ Done. Run compute_ratings.py, then compute_percentiles.py to refresh cards.")
