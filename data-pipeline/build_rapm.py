#!/usr/bin/env python3
"""
Build RAPM (Regularized Adjusted Plus-Minus) from NHL play-by-play.
Uses hockey-scraper for 100% game coverage (old NHL shift API had ~37% coverage).
Fetches 8 seasons (18-19 → 25-26) and chains them as Bayesian priors.
Card projection uses only the 3 most recent seasons (23-24/24-25/25-26).
Older seasons strengthen the prior chain without inflating recent card stats.

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
import xgboost as xgb
from supabase import create_client
from sync_log import install_sync_logger

warnings.filterwarnings('ignore')
install_sync_logger("rapm")

# ── Config ────────────────────────────────────────────────────────────────────
TEST_MODE     = False  # Set True to limit to TEST_GAMES per season for validation
TEST_GAMES    = 50
BATCH_SIZE    = 50    # Games per hockey-scraper batch
SKIP_SCRAPING = os.getenv("SKIP_SCRAPING", "").lower() in ("1", "true", "yes")  # Use cached stints only
RAPM_EXPERIMENT = os.getenv("RAPM_EXPERIMENT", "").strip()

SCHEDULE_API = "https://api-web.nhle.com/v1"
DATA_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
PATCH_FILE   = os.path.join(DATA_DIR, 'player_id_patch.json')
os.makedirs(DATA_DIR, exist_ok=True)
SHOTS_CACHE_FILE = os.path.join(DATA_DIR, 'shots_all_seasons_hs_backup.csv')
PLAYER_LOOKUP_FILE = os.path.join(DATA_DIR, 'players_base.csv')

# Player IDs used for quality gate before uploading
MCDAVID_ID   = 8478402
DRAISAITL_ID = 8477934

# Season configuration — ordered oldest-first for the daisy chain.
# 'weight' = stints weight in the regression matrix (older → lower weight).
# CARD_SEASON_WEIGHTS below controls the 3-year card projection separately.
SEASON_CONFIGS = {
    '07-08': {
        'start_date': date(2007, 10, 3),
        'end_date':   date(2008, 4, 6),
        'id_base':    2007000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_0708.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_0708.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_0708.csv'),
        'weight':     0.10,
    },
    '08-09': {
        'start_date': date(2008, 10, 4),
        'end_date':   date(2009, 4, 12),
        'id_base':    2008000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_0809.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_0809.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_0809.csv'),
        'weight':     0.10,
    },
    '09-10': {
        'start_date': date(2009, 10, 1),
        'end_date':   date(2010, 4, 11),
        'id_base':    2009000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_0910.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_0910.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_0910.csv'),
        'weight':     0.12,
    },
    '10-11': {
        'start_date': date(2010, 10, 7),
        'end_date':   date(2011, 4, 10),
        'id_base':    2010000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_1011.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_1011.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_1011.csv'),
        'weight':     0.14,
    },
    '11-12': {
        'start_date': date(2011, 10, 6),
        'end_date':   date(2012, 4, 7),
        'id_base':    2011000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_1112.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_1112.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_1112.csv'),
        'weight':     0.16,
    },
    '12-13': {
        'start_date': date(2013, 1, 19),
        'end_date':   date(2013, 5, 4),
        'id_base':    2012000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_1213.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_1213.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_1213.csv'),
        'weight':     0.16,
    },
    '13-14': {
        'start_date': date(2013, 10, 1),
        'end_date':   date(2014, 4, 13),
        'id_base':    2013000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_1314.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_1314.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_1314.csv'),
        'weight':     0.18,
    },
    '14-15': {
        'start_date': date(2014, 10, 8),
        'end_date':   date(2015, 4, 11),
        'id_base':    2014000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_1415.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_1415.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_1415.csv'),
        'weight':     0.20,
    },
    '15-16': {
        'start_date': date(2015, 10, 7),
        'end_date':   date(2016, 4, 10),
        'id_base':    2015000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_1516.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_1516.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_1516.csv'),
        'weight':     0.22,
    },
    '16-17': {
        'start_date': date(2016, 10, 12),
        'end_date':   date(2017, 4, 9),
        'id_base':    2016000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_1617.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_1617.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_1617.csv'),
        'weight':     0.25,
    },
    '17-18': {
        'start_date': date(2017, 10, 4),
        'end_date':   date(2018, 4, 8),
        'id_base':    2017000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_1718.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_1718.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_1718.csv'),
        'weight':     0.28,
    },
    '18-19': {
        'start_date': date(2018, 10, 1),
        'end_date':   date(2019, 4, 11),
        'id_base':    2018000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_1819.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_1819.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_1819.csv'),
        'weight':     0.30,
    },
    '19-20': {
        'start_date': date(2019, 10, 1),
        'end_date':   date(2020, 3, 11),   # COVID cutoff — regular season only
        'id_base':    2019000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_1920.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_1920.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_1920.csv'),
        'weight':     0.35,
    },
    '20-21': {
        'start_date': date(2021, 1, 13),   # COVID shortened — 56 games
        'end_date':   date(2021, 5, 19),
        'id_base':    2020000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_2021.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_2021.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_2021.csv'),
        'weight':     0.35,
    },
    '21-22': {
        'start_date': date(2021, 10, 12),
        'end_date':   date(2022, 4, 29),
        'id_base':    2021000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_2122.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_2122.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_2122.csv'),
        'weight':     0.45,
    },
    '22-23': {
        'start_date': date(2022, 10, 7),
        'end_date':   date(2023, 4, 13),
        'id_base':    2022000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_2223.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_2223.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_2223.csv'),
        'weight':     0.55,
    },
    '23-24': {
        'start_date': date(2023, 10, 10),
        'end_date':   date(2024, 4, 18),
        'id_base':    2023000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_2324.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_2324.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_2324.csv'),
        'weight':     0.70,
    },
    '24-25': {
        'start_date': date(2024, 10, 8),
        'end_date':   date(2025, 4, 17),
        'id_base':    2024000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_2425.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_2425.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint_2425.csv'),
        'weight':     0.85,
    },
    '25-26': {
        'start_date': date(2025, 10, 7),
        'end_date':   date(2026, 4, 17),
        'id_base':    2025000000,
        'ids_file':   os.path.join(DATA_DIR, 'game_ids_2526.json'),
        'stints_file':os.path.join(DATA_DIR, 'stints_2526.csv'),
        'ckpt_file':  os.path.join(DATA_DIR, 'stints_checkpoint.csv'),
        'weight':     1.00,
    },
}

CARD_SEASON_WEIGHTS = {
    '25-26': 0.50,
    '24-25': 0.30,
    '23-24': 0.20,
}
MIN_TOI_MINUTES = 200
MAX_RAPM = 3.0

# ── PP/PK RAPM constants ───────────────────────────────────────────────────────
# Strength states from the HOME team's perspective.
# 5v4 = home team has 5 skaters vs away's 4  →  home team is on PP.
PP_HOME_STATES = frozenset(['5v4', '5v3', '4v3'])   # home on PP, away on PK
PP_AWAY_STATES = frozenset(['4v5', '3v5', '3v4'])   # away on PP, home on PK
PP_PK_ALL_STATES = PP_HOME_STATES | PP_AWAY_STATES
# Minimum PP/PK minutes to include a player in the regression matrix.
MIN_PP_REGRESSION_TOI_SEC = 100 * 60   # 100 PP min
MIN_PK_REGRESSION_TOI_SEC = 100 * 60   # 100 PK min
QOT_QOC_TOI_SHRINK = 600.0
QOT_QOC_MAX_ABS = 2.5
QOT_IMPACT_OFF_WEIGHT = 0.7
QOT_IMPACT_DEF_WEIGHT = 0.3

# Seasons that get PP-expiry / zone-start / back-to-back augmentation
DUMMY_SEASONS = {'23-24', '24-25', '25-26'}
DUMMY_COLS    = ['home_pp_expiry', 'away_pp_expiry',
                 'home_ozs', 'away_ozs', 'nzs',
                 'home_btb', 'away_btb']
# Set QUICK_TEST=1 to run only the 3 card seasons (skips daisy-chain history)
QUICK_TEST = os.getenv("QUICK_TEST", "").lower() in ("1", "true", "yes")

SUPABASE_URL = (os.getenv("SUPABASE_URL") or
                os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""))
SUPABASE_KEY = (os.getenv("SUPABASE_KEY") or
                os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ""))

EXPERIMENT_TEAMMATE_SHARE_DEFENSE = "teammate_share_defense"
EXPERIMENT_EV_PRIOR_PARITY = "ev_prior_parity"
EXPERIMENT_XG_CONTEXT_PARITY = "xg_context_parity"
EXPERIMENT_SHORT_MISS_PARITY = "short_miss_parity"
EXPERIMENT_2425_COLLINEARITY_REALLOCATION = "collinearity_reallocation_2425"
EXPERIMENT_2425_COLLINEARITY_REALLOCATION_DEFENSE = "collinearity_reallocation_2425_defense"
EXPERIMENT_COLLINEARITY_REALLOCATION_FORWARD_2425_2526 = "collinearity_reallocation_forward_2425_2526"
EXPERIMENT_ASYMMETRIC_ALPHA_K130 = "asymmetric_alpha_k130"
EXPERIMENT_ASYMMETRIC_ALPHA_K150 = "asymmetric_alpha_k150"
EXPERIMENT_ASYMMETRIC_ALPHA_K170 = "asymmetric_alpha_k170"
PROMOTE_2425_COLLINEARITY_REALLOCATION_DEFENSE = True
PROMOTE_COLLINEARITY_REALLOCATION_FORWARD_2425_2526 = True
SUPPORTED_RAPM_EXPERIMENTS = {
    EXPERIMENT_TEAMMATE_SHARE_DEFENSE,
    EXPERIMENT_EV_PRIOR_PARITY,
    EXPERIMENT_XG_CONTEXT_PARITY,
    EXPERIMENT_SHORT_MISS_PARITY,
    EXPERIMENT_2425_COLLINEARITY_REALLOCATION,
    EXPERIMENT_2425_COLLINEARITY_REALLOCATION_DEFENSE,
    EXPERIMENT_COLLINEARITY_REALLOCATION_FORWARD_2425_2526,
    EXPERIMENT_ASYMMETRIC_ALPHA_K130,
    EXPERIMENT_ASYMMETRIC_ALPHA_K150,
    EXPERIMENT_ASYMMETRIC_ALPHA_K170,
}
_ASYMMETRIC_ALPHA_EXPERIMENTS = {
    EXPERIMENT_ASYMMETRIC_ALPHA_K130: 1.30,
    EXPERIMENT_ASYMMETRIC_ALPHA_K150: 1.50,
    EXPERIMENT_ASYMMETRIC_ALPHA_K170: 1.70,
}

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "nhl-analytics/1.0"})

# Load player ID patch (name → ID for hockey-scraper PBP name mismatches)
PLAYER_ID_PATCH = {}
if os.path.exists(PATCH_FILE):
    with open(PATCH_FILE) as f:
        PLAYER_ID_PATCH = json.load(f)
    print(f"Loaded player_id_patch: {len(PLAYER_ID_PATCH)} entries")

# ── XGBoost xG model ──────────────────────────────────────────────────────────
# Shot-type encoding (0-indexed pd.Categorical from SHOT_TYPE_ORDER in build_xg_model.py)
# DEFLECTED is merged to TIP-IN (index 4) to match training preprocessing
SHOT_TYPE_MAP = {
    'wrist': 0, 'slap': 1, 'snap': 2, 'backhand': 3,
    'tip-in': 4, 'deflected': 4,
    'wrap-around': 6, 'between-legs': 7, 'poke': 8, 'bat': 0,
}
# Prior-event encoding (0-indexed pd.Categorical from PRIOR_EVENT_ORDER)
# 'FAC' is hockey-scraper's faceoff label; PENL/CHL treated as STOP
PRIOR_EVENT_MAP = {
    'SHOT': 0, 'MISS': 1, 'GOAL': 2, 'GIVE': 3, 'TAKE': 4,
    'BLOCK': 5, 'HIT': 6, 'FACEOFF': 7, 'FAC': 7,
    'STOP': 8, 'PENL': 8, 'CHL': 8, 'NONE': 9,
}
# Game-strength encoding (0-indexed from STRENGTH_ORDER)
STRENGTH_MAP = {'5v5': 0, '5v4': 1, '4v5': 2, '4v4': 3, '3v3': 4, 'other': 5}

XG_FEATURE_NAMES = [
    'distance', 'angle', 'is_behind_net', 'is_rush', 'is_rebound',
    'pre_shot_lateral_movement', 'pre_shot_north_south_movement',
    'pre_shot_distance', 'pre_shot_speed', 'rebound_angle_change',
    'shot_type_encoded', 'prior_event_encoded', 'seconds_since_prior',
    'score_state', 'period_cat', 'is_home', 'game_strength_encoded', 'is_empty_net',
    'distance_squared', 'angle_squared', 'is_left_side',
    'is_slot', 'is_high_slot',
    'is_wrist_shot', 'is_snap_shot', 'is_slap_shot', 'is_backhand',
    'is_tip_in', 'is_wrap_around', 'is_poke',
    'prior_event_is_shot', 'prior_event_is_turnover',
    'shot_distance_x_angle',
    'shooter_is_left', 'is_off_wing',
    'score_diff_abs', 'is_tied',
]

XG_MODEL_5V5 = None
XG_MODEL_DIR = DATA_DIR
SHOOTER_HANDEDNESS = {}


def load_xg_model():
    global XG_MODEL_5V5
    model_path = os.path.join(XG_MODEL_DIR, 'xg_model_5v5.json')
    if os.path.exists(model_path):
        XG_MODEL_5V5 = xgb.Booster()
        XG_MODEL_5V5.load_model(model_path)
        print(f"Loaded XGBoost xG model from {model_path}")
    else:
        print(f"XGBoost model not found at {model_path} — falling back to bucket xG")


load_xg_model()


def load_shooter_handedness():
    global SHOOTER_HANDEDNESS
    SHOOTER_HANDEDNESS = {}
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    try:
        sb = create_client(SUPABASE_URL, SUPABASE_KEY)
        rows = []
        offset = 0
        while True:
            batch = (sb.table('players')
                       .select('player_id,shoots')
                       .range(offset, offset + 999)
                       .execute().data)
            if not batch:
                break
            rows.extend(batch)
            offset += len(batch)
            if len(batch) < 1000:
                break
        for row in rows:
            pid = row.get('player_id')
            shoots = str(row.get('shoots') or 'R').upper().strip()
            if pid is None:
                continue
            SHOOTER_HANDEDNESS[int(pid)] = 1 if shoots == 'L' else 0
        if SHOOTER_HANDEDNESS:
            print(f"Loaded shooter handedness for {len(SHOOTER_HANDEDNESS)} players")
    except Exception as exc:
        print(f"Could not load shooter handedness: {exc}")


load_shooter_handedness()

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


def compute_xg_from_model(ev, prev_ev, score_state=0, period=1, is_home=False,
                          game_strength='5v5', experiment_name=''):
    """
    Estimate xG using the trained XGBoost model.
    ev is a dict with keys: xC, yC, shot_type (or Type), t.
    prev_ev is a dict with keys: xC, yC, event_type, t (or None).
    Falls back to compute_xg_xy when model unavailable or coordinates missing.
    """
    xc = ev.get('xC')
    yc = ev.get('yC')
    raw_shot_type = str(ev.get('shot_type', ev.get('Type', ''))).strip()
    shot_type = raw_shot_type.lower().strip()
    shooter_id = ev.get('shooter_id')

    if XG_MODEL_5V5 is None:
        if pd.notna(xc) and pd.notna(yc):
            return compute_xg_xy(float(xc), float(yc), shot_type)
        return None

    try:
        if pd.isna(xc) or pd.isna(yc):
            return None

        x = float(xc)
        y = float(yc)
        use_training_context = experiment_name == EXPERIMENT_XG_CONTEXT_PARITY

        if (is_home and period % 2 == 0) or (not is_home and period % 2 == 1):
            x = -x
            y = -y

        # Distance and angle to the nearer net face at (89, 0)
        dx = abs(x) - 89.0
        dist = math.sqrt(dx ** 2 + y ** 2)
        angle = abs(math.degrees(math.atan2(abs(y), max(abs(dx), 0.1))))
        is_behind_net = int(abs(x) > 89.0)
        distance_squared = dist ** 2
        angle_squared = angle ** 2
        is_left_side = int(y < 0)
        is_slot = int(dist < 20.0 and angle < 40.0)
        is_high_slot = int(20.0 <= dist < 35.0 and angle < 30.0)
        shot_distance_x_angle = dist * angle / 100.0

        shot_enc = SHOT_TYPE_MAP.get(shot_type, 9)  # 9 = '' fallback index
        shot_type_upper = raw_shot_type.upper().strip().replace('TIP IN', 'TIP-IN')
        is_wrist_shot = int(shot_type_upper in {'WRIST SHOT', 'WRIST'})
        is_snap_shot = int(shot_type_upper in {'SNAP SHOT', 'SNAP'})
        is_slap_shot = int(shot_type_upper in {'SLAP SHOT', 'SLAP'})
        is_backhand = int(shot_type_upper == 'BACKHAND')
        is_tip_in = int(shot_type_upper in {'TIP-IN', 'DEFLECTED'})
        is_wrap_around = int(shot_type_upper in {'WRAP-AROUND', 'WRAP AROUND'})
        is_poke = int(shot_type_upper == 'POKE')

        prior_event_label = ''
        seconds_since_prior = 1200.0
        pre_shot_lateral_movement = 0.0
        pre_shot_north_south_movement = 0.0
        pre_shot_distance = 0.0
        pre_shot_speed = 0.0
        rebound_angle_change = 0.0
        is_rush = 0
        is_rebound = 0

        if prev_ev is not None:
            prior_event_label = str(prev_ev.get('event_type', prev_ev.get('Event', 'NONE'))).upper().strip()
            prev_t = prev_ev.get('t', 0)
            cur_t = ev.get('t', 0)
            try:
                dt = float(cur_t) - float(prev_t)
            except (TypeError, ValueError):
                dt = 1200.0
            seconds_since_prior = max(0.0, dt)
            if use_training_context:
                is_rush = int(seconds_since_prior < 4.0 and prior_event_label in {'TAKE', 'GIVE', 'SHOT', 'MISS', 'BLOCK'})
                is_rebound = int(seconds_since_prior < 3.0 and prior_event_label in {'SHOT', 'MISS', 'GOAL'})

            prev_xc = prev_ev.get('xC')
            prev_yc = prev_ev.get('yC')
            if pd.notna(prev_xc) and pd.notna(prev_yc):
                px = float(prev_xc)
                py = float(prev_yc)
                if (is_home and period % 2 == 0) or (not is_home and period % 2 == 1):
                    px = -px
                    py = -py
                pre_shot_lateral_movement = abs(y - py)
                if use_training_context:
                    pre_shot_north_south_movement = abs(x - px)
                else:
                    pre_shot_north_south_movement = x - px
                pre_shot_distance = math.sqrt((x - px) ** 2 + (y - py) ** 2)
                pre_shot_speed = pre_shot_distance / max(seconds_since_prior, 0.001)
                if use_training_context:
                    pre_shot_speed = min(pre_shot_speed, 120.0)

                if prior_event_label in ('SHOT', 'MISS', 'GOAL') and seconds_since_prior <= 3.0:
                    is_rebound = 1
                    pdx = abs(px) - 89.0
                    prev_angle = abs(math.degrees(math.atan2(abs(py), max(abs(pdx), 0.1))))
                    rebound_angle_change = abs(angle - prev_angle)

                if (not use_training_context) and pre_shot_distance > 20.0 and seconds_since_prior <= 4.0:
                    is_rush = 1

        prior_enc = PRIOR_EVENT_MAP.get(prior_event_label, 9)   # 9 = NONE fallback
        prior_event_is_shot = int(prior_event_label in {'SHOT', 'MISS', 'GOAL'})
        prior_event_is_turnover = int(prior_event_label in {'TAKE', 'GIVE'})
        strength_enc = STRENGTH_MAP.get(game_strength, 5)
        score_state_clipped = max(-3.0, min(3.0, float(score_state)))
        score_diff_abs = min(3.0, abs(score_state_clipped))
        is_tied = int(score_state_clipped == 0.0)
        shooter_is_left = 0
        try:
            if shooter_id is not None and not pd.isna(shooter_id):
                shooter_is_left = int(SHOOTER_HANDEDNESS.get(int(float(shooter_id)), 0))
        except (ValueError, TypeError):
            shooter_is_left = 0
        y_pos = y > 0
        is_off_wing = int(
            (shooter_is_left == 1 and not y_pos) or
            (shooter_is_left == 0 and y_pos)
        )

        features = [
            dist, angle, is_behind_net, is_rush, is_rebound,
            pre_shot_lateral_movement, pre_shot_north_south_movement,
            pre_shot_distance, pre_shot_speed, rebound_angle_change,
            shot_enc, prior_enc, seconds_since_prior,
            score_state_clipped, period - 1, int(is_home), strength_enc, 0,
            distance_squared, angle_squared, is_left_side,
            is_slot, is_high_slot,
            is_wrist_shot, is_snap_shot, is_slap_shot, is_backhand,
            is_tip_in, is_wrap_around, is_poke,
            prior_event_is_shot, prior_event_is_turnover,
            shot_distance_x_angle,
            shooter_is_left, is_off_wing,
            score_diff_abs, is_tied,
        ]

        dmat = xgb.DMatrix(
            np.array([features], dtype=np.float32),
            feature_names=XG_FEATURE_NAMES,
        )
        raw = float(XG_MODEL_5V5.predict(dmat)[0])
        return round(max(0.005, min(0.95, raw)), 4)

    except Exception:
        if pd.notna(xc) and pd.notna(yc):
            return compute_xg_xy(float(xc), float(yc), shot_type)
        return None


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
        return [], []

    pbp_all = pbp_all.copy()
    sh_all = sh_all.copy()
    pbp_all['_gid_full'] = pbp_all['Game_Id'].apply(lambda x: _hs_id_to_full(x, id_base))
    sh_all['_gid_full'] = sh_all['Game_Id'].apply(lambda x: _hs_id_to_full(x, id_base))

    rows    = []
    ev_rows = []
    for gid in batch:
        game_pbp = pbp_all[pbp_all['_gid_full'] == gid]
        game_sh = sh_all[sh_all['_gid_full'] == gid]
        if game_pbp.empty or game_sh.empty:
            failed.append(gid)
            continue
        stints_g, events_g = build_stints_from_game_hs(gid, game_pbp, game_sh)
        rows.extend(stints_g)
        ev_rows.extend(events_g)
    return rows, ev_rows


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


# ── Dummy-variable augmentation (Tasks 1, 2, 3) ───────────────────────────────

def _time_to_abs_sec(period, time_str):
    """Convert period number + 'MM:SS' to absolute game seconds."""
    try:
        parts = str(time_str).split(':')
        in_period = int(parts[0]) * 60 + int(parts[1])
    except (IndexError, ValueError):
        in_period = 0
    return (period - 1) * 1200 + in_period


def fetch_game_pbp_events(game_id):
    """
    Fetch faceoff and penalty events for one game from the NHL stats API.
    Returns dict: {faceoffs: list-of-dicts, penalties: list-of-dicts, home_team: str}

    faceoffs:  [{game_id, abs_sec, zone_code}]   zone_code ∈ {O, D, N}
                zone_code is from the HOME team's offensive perspective:
                  O = home offensive zone  D = home defensive zone  N = neutral
    penalties: [{game_id, abs_sec, duration_sec, team_is_home}]
                team_is_home=1 → home team was penalized → AWAY team has the PP
                Skip 10-min misconducts (no PP created).
    """
    url  = f"{SCHEDULE_API}/gamecenter/{game_id}/play-by-play"
    r    = _get_with_retry(url)
    data = r.json()

    home_team_id = data.get('homeTeam', {}).get('id', -1)
    faceoffs     = []
    penalties    = []

    for play in data.get('plays', []):
        type_key = play.get('typeDescKey', '')
        period   = play.get('periodDescriptor', {}).get('number', 0)
        if period not in (1, 2, 3):
            continue
        abs_sec = _time_to_abs_sec(period, play.get('timeInPeriod', '0:00'))
        details = play.get('details', {})

        if type_key == 'faceoff':
            zone = str(details.get('zoneCode', 'N')).upper()
            if zone not in ('O', 'D', 'N'):
                zone = 'N'
            faceoffs.append({'game_id': game_id, 'abs_sec': abs_sec, 'zone_code': zone})

        elif type_key == 'penalty':
            dur_min = details.get('duration', 2)
            try:
                dur_sec = int(dur_min) * 60
            except (TypeError, ValueError):
                dur_sec = 120
            if dur_sec == 0 or dur_sec >= 600:   # skip 0-sec or 10-min misconducts
                continue
            # NHL API v1: penalised team identified by eventOwnerTeamId (int)
            pen_team_id = details.get('eventOwnerTeamId')
            if pen_team_id is None:
                continue
            is_home = int(int(pen_team_id) == int(home_team_id))
            penalties.append({
                'game_id': game_id,
                'abs_sec': abs_sec,
                'duration_sec': dur_sec,
                'team_is_home': is_home,
            })

    return {'faceoffs': faceoffs, 'penalties': penalties}


def load_or_build_event_cache(game_ids, season_key, faceoffs_file, penalties_file):
    """
    Load (or fetch+save) faceoff and penalty events for every game in season_key.
    Returns (faceoffs_df, penalties_df).
    """
    faceoffs_list  = []
    penalties_list = []
    fo_done_gids   = set()
    pe_done_gids   = set()

    if os.path.exists(faceoffs_file):
        try:
            fo = pd.read_csv(faceoffs_file)
            if not fo.empty:
                faceoffs_list = fo.to_dict('records')
                fo_done_gids  = set(fo['game_id'].unique())
                print(f"  Faceoffs cache: {len(fo_done_gids)} games loaded "
                      f"({os.path.basename(faceoffs_file)})")
        except Exception as e:
            print(f"  Warning: could not load faceoffs cache: {e}")

    if os.path.exists(penalties_file):
        try:
            pe = pd.read_csv(penalties_file)
            if not pe.empty:
                penalties_list = pe.to_dict('records')
                pe_done_gids   = set(pe['game_id'].unique())
        except Exception as e:
            print(f"  Warning: could not load penalties cache: {e}")

    # A game is fully cached only when BOTH faceoffs and penalties are present
    done_gids = fo_done_gids & pe_done_gids
    todo = [gid for gid in game_ids if gid not in done_gids]
    if todo:
        # Drop stale entries for games being re-fetched to prevent duplication
        todo_set = set(todo)
        faceoffs_list  = [r for r in faceoffs_list  if r['game_id'] not in todo_set]
        penalties_list = [r for r in penalties_list if r['game_id'] not in todo_set]
        print(f"  Fetching PBP events for {len(todo)} games ({season_key})...")
        for i, gid in enumerate(todo):
            if i > 0 and i % 100 == 0:
                print(f"    {i}/{len(todo)} games done…")
            try:
                ev = fetch_game_pbp_events(gid)
                faceoffs_list.extend(ev['faceoffs'])
                penalties_list.extend(ev['penalties'])
                time.sleep(0.3)
            except Exception as e:
                print(f"    Warning: PBP fetch failed for {gid}: {e}")

        if faceoffs_list:
            pd.DataFrame(faceoffs_list).to_csv(faceoffs_file, index=False)
            print(f"  Saved faceoffs: {len(faceoffs_list)} events → "
                  f"{os.path.basename(faceoffs_file)}")
        if penalties_list:
            pd.DataFrame(penalties_list).to_csv(penalties_file, index=False)
            print(f"  Saved penalties: {len(penalties_list)} events → "
                  f"{os.path.basename(penalties_file)}")

    fo_df = (pd.DataFrame(faceoffs_list)
             if faceoffs_list
             else pd.DataFrame(columns=['game_id', 'abs_sec', 'zone_code']))
    pe_df = (pd.DataFrame(penalties_list)
             if penalties_list
             else pd.DataFrame(columns=['game_id', 'abs_sec', 'duration_sec', 'team_is_home']))
    return fo_df, pe_df


def load_or_build_game_dates_cache(season_cfg, season_key, cache_file):
    """
    Build a {str(game_id): {date, home, away}} mapping for the season.
    Used for back-to-back detection.  Caches to JSON.
    """
    if os.path.exists(cache_file):
        with open(cache_file) as f:
            data = json.load(f)
        print(f"  Game-dates cache: {len(data)} games ({os.path.basename(cache_file)})")
        return data

    start_d = season_cfg['start_date']
    end_d   = min(season_cfg['end_date'], date.today())
    result  = {}
    print(f"  Fetching game dates for {season_key} ({start_d} → {end_d})…")
    current = start_d
    while current <= end_d:
        url = f"{SCHEDULE_API}/schedule/{current.isoformat()}"
        try:
            r = _get_with_retry(url)
            for week_day in r.json().get('gameWeek', []):
                gdate = week_day.get('date', '')
                for g in week_day.get('games', []):
                    if g.get('gameType') == 2:
                        result[str(g['id'])] = {
                            'date': gdate,
                            'home': str(g.get('homeTeam', {}).get('abbrev', '')).upper(),
                            'away': str(g.get('awayTeam', {}).get('abbrev', '')).upper(),
                        }
        except Exception as e:
            print(f"    Warning {current}: {e}")
        current += timedelta(days=7)
        time.sleep(1.0)

    with open(cache_file, 'w') as f:
        json.dump(result, f)
    print(f"  Saved game-dates: {len(result)} games → {os.path.basename(cache_file)}")
    return result


def augment_stints_with_dummies(stints_df, game_ids, season_key, season_cfg):
    """
    Add 7 dummy-variable columns to a stints DataFrame:
      home_pp_expiry / away_pp_expiry  — PP-to-EV transitions  (Task 1)
      home_ozs / away_ozs / nzs        — zone starts           (Task 2)
      home_btb / away_btb              — back-to-back games    (Task 3)

    Uses cached NHL-API PBP (faceoffs + penalties) and schedule data.
    Does NOT modify the existing stints CSV files.
    """
    print(f"\n  Augmenting stints with dummy variables for {season_key}…")
    tag = season_key.replace('-', '')
    faceoffs_file   = os.path.join(DATA_DIR, f'faceoffs_{tag}.csv')
    penalties_file  = os.path.join(DATA_DIR, f'penalties_{tag}.csv')
    game_dates_file = os.path.join(DATA_DIR, f'game_dates_{tag}.json')

    # ── Task 2 + 1: faceoff and penalty caches ────────────────────────────────
    fo_df, pe_df = load_or_build_event_cache(
        game_ids, season_key, faceoffs_file, penalties_file)

    # ── Task 3: game-dates cache for back-to-back ──────────────────────────────
    game_dates = load_or_build_game_dates_cache(season_cfg, season_key, game_dates_file)

    # Build {team_abbrev: set-of-date-strings} for O(1) BTB lookup
    team_date_set: dict[str, set] = defaultdict(set)
    for info in game_dates.values():
        if info['date']:
            team_date_set[info['home']].add(info['date'])
            team_date_set[info['away']].add(info['date'])

    def _is_btb(team: str, game_date: str) -> int:
        if not team or not game_date:
            return 0
        try:
            yesterday = (date.fromisoformat(game_date) - timedelta(days=1)).isoformat()
        except ValueError:
            return 0
        return int(yesterday in team_date_set.get(team, set()))

    btb_lookup: dict[int, tuple] = {}   # game_id → (home_btb, away_btb)
    for gid_str, info in game_dates.items():
        try:
            gid = int(gid_str)
        except (ValueError, TypeError):
            continue
        btb_lookup[gid] = (_is_btb(info['home'], info['date']),
                           _is_btb(info['away'], info['date']))

    # ── Zone starts via pandas merge_asof ─────────────────────────────────────
    # fo_df zone_code is from HOME team's perspective:
    #   O = home offensive zone → home_ozs=1
    #   D = home defensive zone → away_ozs=1
    #   N = neutral             → nzs=1
    # A faceoff "starts" a stint when |fo_abs_sec - stint_start_sec| ≤ 3 s.

    # ── Build per-game event lookups (numpy arrays, sorted by abs_sec) ──────────
    FO_WINDOW = 3   # seconds: faceoff must be within 3 s of stint start
    PP_WINDOW = 5   # seconds: PP expiry within 5 s of stint start

    # Faceoff lookup: {game_id: (sorted abs_sec array, zone_code array)}
    fo_by_game: dict = {}
    if not fo_df.empty:
        fo_df2 = fo_df.astype({'game_id': int, 'abs_sec': int})
        for gid, grp in fo_df2.groupby('game_id'):
            grp_s = grp.sort_values('abs_sec')
            fo_by_game[gid] = (grp_s['abs_sec'].values, grp_s['zone_code'].values)

    # Penalty-expiry lookup split by who was penalized
    # home_pp_expiry: away team penalized (team_is_home=0) → home had PP
    # away_pp_expiry: home team penalized (team_is_home=1) → away had PP
    pe_home_exp: dict = {}   # {game_id: sorted expiry_sec array} for away-penalized
    pe_away_exp: dict = {}   # {game_id: sorted expiry_sec array} for home-penalized
    if not pe_df.empty:
        pe_df2 = pe_df.astype({'game_id': int, 'abs_sec': int,
                                'duration_sec': int, 'team_is_home': int})
        pe_df2['expiry_sec'] = pe_df2['abs_sec'] + pe_df2['duration_sec']
        for gid, grp in pe_df2.groupby('game_id'):
            home_pen = np.sort(grp.loc[grp['team_is_home'] == 1, 'expiry_sec'].values)
            away_pen = np.sort(grp.loc[grp['team_is_home'] == 0, 'expiry_sec'].values)
            if len(away_pen): pe_home_exp[gid] = away_pen  # away penalized → home PP
            if len(home_pen): pe_away_exp[gid] = home_pen  # home penalized → away PP

    # ── Vectorised per-stint lookup with numpy searchsorted ───────────────────
    game_ids_arr  = stints_df['game_id'].astype(int).values
    start_sec_arr = stints_df['start_sec'].astype(int).values
    n_stints      = len(stints_df)

    home_ozs_col       = np.zeros(n_stints, dtype=int)
    away_ozs_col       = np.zeros(n_stints, dtype=int)
    nzs_col            = np.ones(n_stints,  dtype=int)   # default = on-the-fly/neutral
    home_pp_expiry_col = np.zeros(n_stints, dtype=int)
    away_pp_expiry_col = np.zeros(n_stints, dtype=int)

    for i in range(n_stints):
        gid   = game_ids_arr[i]
        start = start_sec_arr[i]

        # Zone start: find the most recent faceoff at or before start + FO_WINDOW
        if gid in fo_by_game:
            fo_times, fo_zones = fo_by_game[gid]
            pos = int(np.searchsorted(fo_times, start + 1, side='left')) - 1
            if pos >= 0 and (start - fo_times[pos]) <= FO_WINDOW:
                zone = fo_zones[pos]
                if zone == 'O':
                    home_ozs_col[i] = 1
                    nzs_col[i] = 0
                elif zone == 'D':
                    away_ozs_col[i] = 1
                    nzs_col[i] = 0
                # zone == 'N' → nzs stays 1

        # PP expiry: find the most recent expiry at or before start + PP_WINDOW
        if gid in pe_home_exp:
            exp_arr = pe_home_exp[gid]
            pos = int(np.searchsorted(exp_arr, start + 1, side='left')) - 1
            if pos >= 0 and (start - exp_arr[pos]) <= PP_WINDOW:
                home_pp_expiry_col[i] = 1

        if gid in pe_away_exp:
            exp_arr = pe_away_exp[gid]
            pos = int(np.searchsorted(exp_arr, start + 1, side='left')) - 1
            if pos >= 0 and (start - exp_arr[pos]) <= PP_WINDOW:
                away_pp_expiry_col[i] = 1

    # ── Back-to-back (row-wise, btb_lookup is small) ──────────────────────────
    gids      = stints_df['game_id'].astype(int).values
    home_btbs = np.array([btb_lookup.get(g, (0, 0))[0] for g in gids], dtype=int)
    away_btbs = np.array([btb_lookup.get(g, (0, 0))[1] for g in gids], dtype=int)

    # ── Assemble and summarise ─────────────────────────────────────────────────
    out = stints_df.copy()
    out['home_pp_expiry'] = home_pp_expiry_col
    out['away_pp_expiry'] = away_pp_expiry_col
    out['home_ozs']       = home_ozs_col
    out['away_ozs']       = away_ozs_col
    out['nzs']            = nzs_col
    out['home_btb']       = home_btbs
    out['away_btb']       = away_btbs

    n = len(out)
    print(f"  Dummy summary ({season_key}, {n:,} stints):")
    for col in DUMMY_COLS:
        v = out[col].sum()
        print(f"    {col:<18}: {v:6,}  ({v/n*100:4.1f}%)")

    return out


def augment_events_with_stints_dummies(events_df, stints_df):
    """
    Propagate dummy-variable columns from the augmented stints DataFrame to events.
    For each event at time t in game g, find the containing 5v5 stint and copy its
    dummy variable values (home_pp_expiry, away_pp_expiry, home_ozs, away_ozs, nzs,
    home_btb, away_btb).
    """
    if events_df.empty or stints_df.empty:
        for col in DUMMY_COLS:
            events_df = events_df.copy()
            events_df[col] = 0
        return events_df

    # Build per-game sorted lookup
    dummy_present = [c for c in DUMMY_COLS if c in stints_df.columns]
    stints_by_game = {}
    stints_df_int = stints_df.copy()
    stints_df_int['game_id']   = stints_df_int['game_id'].astype(int)
    stints_df_int['start_sec'] = stints_df_int['start_sec'].astype(int)
    stints_df_int['end_sec']   = stints_df_int['end_sec'].astype(int)

    for gid, grp in stints_df_int.groupby('game_id'):
        grp_s = grp.sort_values('start_sec')
        stints_by_game[int(gid)] = {
            'starts':  grp_s['start_sec'].values,
            'ends':    grp_s['end_sec'].values,
            'dummies': {col: grp_s[col].values.astype(int) for col in dummy_present},
        }

    # Process event-by-game (vectorised within each game)
    result_parts = []
    for gid, ev_grp in events_df.groupby('game_id'):
        ev_grp = ev_grp.copy()
        gid_int = int(gid)

        # Default: all zeros
        for col in DUMMY_COLS:
            ev_grp[col] = 0

        if gid_int not in stints_by_game:
            result_parts.append(ev_grp)
            continue

        g      = stints_by_game[gid_int]
        starts = g['starts']
        ends   = g['ends']
        ts     = ev_grp['t'].astype(int).values

        pos_arr = np.searchsorted(starts, ts + 1, side='left') - 1
        valid   = (pos_arr >= 0) & (pos_arr < len(starts))
        if valid.any():
            pos_valid = pos_arr[valid].clip(0, len(starts) - 1)
            in_stint  = (starts[pos_valid] <= ts[valid]) & (ts[valid] < ends[pos_valid])
            valid[valid] &= in_stint

        for col in dummy_present:
            if col in g['dummies']:
                col_vals = np.zeros(len(ev_grp), dtype=int)
                if valid.any():
                    col_vals[valid] = g['dummies'][col][pos_arr[valid].clip(0, len(starts) - 1)]
                ev_grp[col] = col_vals

        result_parts.append(ev_grp)

    if result_parts:
        return pd.concat(result_parts, ignore_index=True)
    return events_df


def _load_shots_cache():
    """Load cached shot events from shots_all_seasons_hs_backup.csv."""
    if not os.path.exists(SHOTS_CACHE_FILE):
        print(f"  Shots cache not found: {SHOTS_CACHE_FILE}")
        return pd.DataFrame()
    df = pd.read_csv(SHOTS_CACHE_FILE)
    if df.empty:
        return df
    # Filter to 5v5, non-empty-net, non-blocked shots
    df = df[df['game_strength'] == '5v5'].copy()
    df = df[df['is_empty_net'] == 0].copy()
    df = df[~df['shot_type'].fillna('').str.contains('BLOCK', case=False, na=False)].copy()
    return df


def _apply_short_miss_parity_filter(shots_df, season_key=None):
    """
    HockeyStats excludes miss_reason='short' from Fenwick/xG totals while using
    them as context. Apply that filter when the cache carries miss_reason.
    """
    if shots_df.empty:
        return shots_df.copy(), False
    if 'miss_reason' not in shots_df.columns or 'event_type' not in shots_df.columns:
        label = f" {season_key}" if season_key else ""
        print(f"  Warning:{label} shot cache lacks miss_reason/event_type columns — short-miss parity is a no-op")
        return shots_df.copy(), False

    filtered = shots_df.copy()
    miss_reason = filtered['miss_reason'].fillna('').astype(str).str.strip().str.lower()
    event_type = filtered['event_type'].fillna('').astype(str).str.upper().str.strip()
    short_mask = miss_reason.eq('short') & event_type.eq('MISS')
    removed = int(short_mask.sum())
    if removed:
        label = f"{season_key}: " if season_key else ""
        print(f"  {label}short-miss parity removed {removed:,} shots from xG/Fenwick totals")
    return filtered.loc[~short_mask].copy(), True


def _compute_xg_for_shots(shots_df, experiment_name=''):
    """
    Compute xG for cached shot rows using the calibrated XGBoost model.
    Falls back to bucket xG only when the model path fails.
    """
    if shots_df.empty:
        return shots_df
    shots_df = shots_df.copy()
    shots_df['x_coord'] = pd.to_numeric(shots_df['x_coord'], errors='coerce')
    shots_df['y_coord'] = pd.to_numeric(shots_df['y_coord'], errors='coerce')
    shots_df = shots_df[shots_df['x_coord'].notna() & shots_df['y_coord'].notna()].copy()
    if shots_df.empty:
        return shots_df

    xg_vals = []
    for row in shots_df.itertuples(index=False):
        cur_t = float(getattr(row, 'time_seconds', 0) or 0)
        sec_since = float(getattr(row, 'seconds_since_prior', 1200.0) or 1200.0)
        prev_t = max(0.0, cur_t - sec_since)
        prev_ev = {
            'event_type': getattr(row, 'prior_event_type', ''),
            'xC': getattr(row, 'prior_event_x_coord', np.nan),
            'yC': getattr(row, 'prior_event_y_coord', np.nan),
            't': prev_t,
        }
        ev = {
            'xC': float(row.x_coord),
            'yC': float(row.y_coord),
            'shot_type': getattr(row, 'shot_type', ''),
            't': cur_t,
            'shooter_id': getattr(row, 'shooter_id', None),
        }
        xg_vals.append(compute_xg_from_model(
            ev,
            prev_ev,
            score_state=float(getattr(row, 'score_diff', 0) or 0),
            period=int(getattr(row, 'period', 1) or 1),
            is_home=bool(int(getattr(row, 'is_home', 0) or 0)),
            game_strength=str(getattr(row, 'game_strength', '5v5') or '5v5'),
            experiment_name=experiment_name,
        ))
    shots_df['xg'] = xg_vals
    return shots_df


def _rebuild_stint_xg_from_shots_cache(stints_df, shots_df, season_key, experiment_name=''):
    """
    Recompute stint xG from the clean Fenwick shot cache for the overlapping games.
    This keeps the shift-level RAPM structure intact while refreshing the xG source.
    """
    if stints_df.empty or shots_df.empty:
        return stints_df

    stints = stints_df.copy()
    stints['game_id'] = stints['game_id'].astype(int)
    stints['start_sec'] = stints['start_sec'].astype(int)
    stints['end_sec'] = stints['end_sec'].astype(int)

    shots = shots_df.copy()
    shots['game_id'] = shots['game_id'].astype(int)
    shots['time_seconds'] = pd.to_numeric(shots['time_seconds'], errors='coerce').fillna(-1).astype(int)
    shots['is_home'] = pd.to_numeric(shots['is_home'], errors='coerce').fillna(0).astype(int)
    shots = shots[shots['time_seconds'] >= 0].copy()
    if shots.empty:
        return stints_df
    shots = _compute_xg_for_shots(shots, experiment_name=experiment_name)
    shots = shots[shots['xg'].notna()].copy()
    if shots.empty:
        return stints_df

    shot_games = set(shots['game_id'].unique().tolist())
    mask = stints['game_id'].isin(shot_games)
    if not mask.any():
        print(f"  {season_key}: no overlap between stint cache and shot cache")
        return stints_df

    stints.loc[mask, 'home_xg'] = 0.0
    stints.loc[mask, 'away_xg'] = 0.0

    stints_by_game = {}
    for gid, grp in stints[mask].groupby('game_id'):
        grp_s = grp.sort_values('start_sec')
        stints_by_game[int(gid)] = {
            'starts': grp_s['start_sec'].values,
            'ends': grp_s['end_sec'].values,
            'index': grp_s.index.values,
        }

    matched = 0
    unmatched = 0
    total_xg = 0.0
    for gid, shot_grp in shots.groupby('game_id'):
        gid_int = int(gid)
        if gid_int not in stints_by_game:
            unmatched += len(shot_grp)
            continue
        g = stints_by_game[gid_int]
        starts = g['starts']
        ends = g['ends']
        ts = shot_grp['time_seconds'].values
        pos_arr = np.searchsorted(starts, ts + 1, side='left') - 1
        valid = (pos_arr >= 0) & (pos_arr < len(starts))
        if valid.any():
            pos_valid = pos_arr[valid].clip(0, len(starts) - 1)
            in_stint = (starts[pos_valid] <= ts[valid]) & (ts[valid] < ends[pos_valid])
            valid[valid] &= in_stint
        unmatched += int((~valid).sum())
        if not valid.any():
            continue
        valid_rows = shot_grp.iloc[np.where(valid)[0]]
        valid_pos = pos_arr[valid].clip(0, len(starts) - 1)
        matched += len(valid_rows)
        total_xg += float(valid_rows['xg'].sum())
        for (_, shot_row), pos in zip(valid_rows.iterrows(), valid_pos):
            stint_idx = g['index'][int(pos)]
            key = 'home_xg' if int(shot_row['is_home']) == 1 else 'away_xg'
            stints.at[stint_idx, key] = round(float(stints.at[stint_idx, key]) + float(shot_row['xg']), 4)

    print(f"  {season_key}: rebuilt stint xG from shot cache for {len(shot_games):,} games; "
          f"matched {matched:,} shots, unmatched {unmatched:,}, total_xg={total_xg:.1f}")
    return stints


def _match_shots_to_stints(shots_df, stints_df, season_key, season_weight):
    """
    Match shot events to containing stints to get on-ice players and context.
    Prints progress every 10,000 shots.
    """
    if shots_df.empty or stints_df.empty:
        return pd.DataFrame(columns=EVENT_COLS)

    stints_int = stints_df.copy()
    stints_int['game_id'] = stints_int['game_id'].astype(int)
    stints_int['start_sec'] = stints_int['start_sec'].astype(int)
    stints_int['end_sec'] = stints_int['end_sec'].astype(int)

    stints_by_game = {}
    for gid, grp in stints_int.groupby('game_id'):
        grp_s = grp.sort_values('start_sec')
        stints_by_game[int(gid)] = {
            'starts': grp_s['start_sec'].values,
            'ends': grp_s['end_sec'].values,
            'home_players': grp_s['home_players'].values,
            'away_players': grp_s['away_players'].values,
            'home_score_diff': grp_s['home_score_diff'].values,
            'duration_seconds': grp_s['duration_seconds'].values,
            'period': grp_s['period'].values,
        }

    rows = []
    processed = 0
    matched = 0

    for gid, ev_grp in shots_df.groupby('game_id'):
        ev_grp = ev_grp.copy()
        gid_int = int(gid)
        processed += len(ev_grp)
        if processed // 10000 != (processed - len(ev_grp)) // 10000:
            print(f"    {season_key}: matched {matched:,} / processed {processed:,} shots...")

        if gid_int not in stints_by_game:
            continue

        g = stints_by_game[gid_int]
        starts = g['starts']
        ends = g['ends']

        ts = ev_grp['time_seconds'].astype(int).values
        pos_arr = np.searchsorted(starts, ts + 1, side='left') - 1
        valid = (pos_arr >= 0) & (pos_arr < len(starts))
        if valid.any():
            pos_valid = pos_arr[valid].clip(0, len(starts) - 1)
            in_stint = (starts[pos_valid] <= ts[valid]) & (ts[valid] < ends[pos_valid])
            valid[valid] &= in_stint

        for idx, is_valid in enumerate(valid):
            if not is_valid:
                continue
            pos = int(pos_arr[idx])
            shot = ev_grp.iloc[idx]
            is_home_shot = int(shot.get('is_home', 0) or 0)
            home_score_diff = g['home_score_diff'][pos]
            if pd.isna(home_score_diff):
                home_score_diff = shot.get('score_diff', 0)

            rows.append({
                'game_id': int(shot['game_id']),
                't': int(shot['time_seconds']),
                'xg': float(shot['xg']),
                'is_home_shot': is_home_shot,
                'home_players': g['home_players'][pos],
                'away_players': g['away_players'][pos],
                'home_score_diff': float(home_score_diff) if home_score_diff is not None else 0.0,
                'period': int(shot.get('period', g['period'][pos])),
                'stint_duration_seconds': float(g['duration_seconds'][pos]),
                'season_weight': float(season_weight),
            })
            matched += 1

    events_df = pd.DataFrame(rows, columns=EVENT_COLS + ['season_weight'])
    return events_df


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
    n_skipped_card_guard = 0
    for pid, season_map in grouped.items():
        # Guard: player must have ≥200 min in at least one card season (23-24/24-25/25-26).
        # Prevents fringe players who only accumulated minutes in old daisy-chain seasons
        # from appearing in the projection with stale inflated prior-chain RAPM.
        has_recent_toi = any(
            float(getattr(season_map.get(s), 'toi_5v5_total', 0) or 0) >= 200.0
            for s in CARD_SEASON_WEIGHTS
            if s in season_map
        )
        if not has_recent_toi:
            n_skipped_card_guard += 1
            continue

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

    if n_skipped_card_guard:
        print(f"  Card projection guard: skipped {n_skipped_card_guard} players "
              f"with <200 min in all card seasons (23-24/24-25/25-26)")

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


def compute_top_teammate_share(stints_df):
    """Return per-player EV TOI concentration with the most common teammate."""
    total_sec = defaultdict(float)
    pair_sec = defaultdict(lambda: defaultdict(float))

    for row in stints_df.itertuples(index=False):
        dur = float(getattr(row, 'duration_seconds', 0) or 0.0)
        if dur <= 0:
            continue
        for col in ('home_players', 'away_players'):
            cell = getattr(row, col, '')
            if pd.isna(cell):
                continue
            teammates = [int(pid) for pid in str(cell).split('|') if str(pid).strip()]
            if len(teammates) < 2:
                continue
            for pid in teammates:
                total_sec[pid] += dur
            for pid in teammates:
                for mate in teammates:
                    if mate == pid:
                        continue
                    pair_sec[pid][mate] += dur

    rows = []
    for pid, sec in total_sec.items():
        teammates = pair_sec.get(pid, {})
        if teammates:
            top_teammate_id, shared_sec = max(teammates.items(), key=lambda item: item[1])
            top_share = shared_sec / sec if sec > 0 else 0.0
        else:
            top_teammate_id, shared_sec, top_share = None, 0.0, 0.0
        rows.append({
            'player_id': pid,
            'total_ev_seconds': round(sec, 1),
            'top_teammate_id': top_teammate_id,
            'top_teammate_seconds': round(shared_sec, 1),
            'top_teammate_share': float(top_share),
        })

    return pd.DataFrame(rows)


def compute_player_onice_xg_context(stints_df):
    """Return per-player EV on-ice xG context from the stint file."""
    totals = defaultdict(lambda: {'sec': 0.0, 'xgf': 0.0, 'xga': 0.0})

    for row in stints_df.itertuples(index=False):
        dur = float(getattr(row, 'duration_seconds', 0) or 0.0)
        if dur <= 0:
            continue

        try:
            home_xg = float(getattr(row, 'home_xg', 0) or 0.0)
        except Exception:
            home_xg = 0.0
        try:
            away_xg = float(getattr(row, 'away_xg', 0) or 0.0)
        except Exception:
            away_xg = 0.0

        for col, team_xg, opp_xg in (
            ('home_players', home_xg, away_xg),
            ('away_players', away_xg, home_xg),
        ):
            cell = getattr(row, col, '')
            if pd.isna(cell):
                continue
            players = [int(pid) for pid in str(cell).split('|') if str(pid).strip()]
            if not players:
                continue
            for pid in players:
                totals[pid]['sec'] += dur
                totals[pid]['xgf'] += team_xg
                totals[pid]['xga'] += opp_xg

    rows = []
    for pid, d in totals.items():
        sec = float(d['sec'])
        xgf = float(d['xgf'])
        xga = float(d['xga'])
        denom = xgf + xga
        xgf_pct = (100.0 * xgf / denom) if denom > 0 else None
        xgd60 = ((xgf - xga) * 3600.0 / sec) if sec > 0 else None
        rows.append({
            'player_id': pid,
            'onice_ev_seconds': round(sec, 1),
            'onice_xgf60': (xgf * 3600.0 / sec) if sec > 0 else None,
            'onice_xga60': (xga * 3600.0 / sec) if sec > 0 else None,
            'onice_xgf_pct': xgf_pct,
            'onice_xgd60': xgd60,
        })

    return pd.DataFrame(rows)


def teammate_share_multiplier(top_share):
    if top_share is None or pd.isna(top_share):
        return 1.0
    share = float(top_share)
    if share <= 0.60:
        return 1.0
    if share >= 0.85:
        return 0.75
    frac = (share - 0.60) / 0.25
    return 1.0 - (0.25 * frac)


def apply_teammate_share_defense_experiment(raw_results, stints_df):
    """
    Uniform conservative EV-defense shrink for players with highly concentrated
    teammate deployment. Baseline rapm_off is unchanged.
    """
    if raw_results.empty:
        return raw_results.copy()

    share_df = compute_top_teammate_share(stints_df)
    adjusted = raw_results.copy()
    adjusted = adjusted.merge(share_df, on='player_id', how='left')
    adjusted['top_teammate_share'] = adjusted['top_teammate_share'].fillna(0.0)
    adjusted['defense_share_multiplier'] = adjusted['top_teammate_share'].apply(teammate_share_multiplier)
    adjusted['baseline_rapm_def'] = adjusted['rapm_def']
    adjusted['baseline_rapm_def_pct'] = adjusted.get('rapm_def_pct')
    adjusted['rapm_def'] = adjusted['rapm_def'] * adjusted['defense_share_multiplier']
    adjusted['rapm_def_pct'] = adjusted['rapm_def'].rank(pct=True) * 100
    adjusted['rapm_def_delta'] = adjusted['rapm_def'] - adjusted['baseline_rapm_def']
    adjusted['rapm_def_pct_delta'] = adjusted['rapm_def_pct'] - adjusted['baseline_rapm_def_pct']
    return adjusted


def collinearity_share_score(top_share):
    if top_share is None or pd.isna(top_share):
        return 0.0
    share = float(top_share)
    if share <= 0.50:
        return 0.0
    if share >= 0.80:
        return 1.0
    return (share - 0.50) / 0.30


def offensive_tilt_score(xgf_pct):
    if xgf_pct is None or pd.isna(xgf_pct):
        return 0.0
    pct = float(xgf_pct)
    if pct <= 52.0:
        return 0.0
    if pct >= 60.0:
        return 1.0
    return (pct - 52.0) / 8.0


def apply_2425_collinearity_reallocation_experiment(raw_results, stints_df, defense_only=False, forward_only=False):
    """
    Collinearity reallocation experiment.

    For players with highly concentrated deployment and strong offensive on-ice tilt,
    shift part of positive EV defense credit into EV offense and add a modest
    offense bonus. This keeps the baseline live path untouched while testing
    whether Edmonton-style shared-credit inflation is the main remaining gap.

    defense_only=True  — apply only to defensemen (D position)
    forward_only=True  — apply only to forwards (non-D position)
    Both False         — apply to all skaters
    """
    if raw_results.empty:
        return raw_results.copy()

    share_df = compute_top_teammate_share(stints_df)
    xg_df = compute_player_onice_xg_context(stints_df)

    adjusted = raw_results.copy()
    # Drop any columns carried over from a prior reallocation pass to avoid merge conflicts
    _share_cols = [c for c in share_df.columns if c != 'player_id']
    _xg_cols = [c for c in xg_df.columns if c != 'player_id']
    adjusted = adjusted.drop(columns=[c for c in _share_cols + _xg_cols if c in adjusted.columns], errors='ignore')
    adjusted = adjusted.merge(share_df, on='player_id', how='left')
    adjusted = adjusted.merge(xg_df, on='player_id', how='left')
    adjusted['top_teammate_share'] = adjusted['top_teammate_share'].fillna(0.0)
    adjusted['onice_xgf_pct'] = adjusted['onice_xgf_pct'].fillna(50.0)
    adjusted['share_score'] = adjusted['top_teammate_share'].apply(collinearity_share_score)
    adjusted['offense_tilt_score'] = adjusted['onice_xgf_pct'].apply(offensive_tilt_score)
    adjusted['collinearity_reallocation_score'] = (
        adjusted['share_score'] * adjusted['offense_tilt_score']
    )

    if defense_only or forward_only:
        _, _, pid_to_pos = _load_player_identity_maps()
        adjusted['position'] = adjusted['player_id'].map(pid_to_pos)
        if defense_only:
            adjusted.loc[adjusted['position'] != 'D', 'collinearity_reallocation_score'] = 0.0
        else:  # forward_only
            adjusted.loc[adjusted['position'] == 'D', 'collinearity_reallocation_score'] = 0.0

    adjusted['baseline_rapm_off'] = adjusted['rapm_off']
    adjusted['baseline_rapm_def'] = adjusted['rapm_def']
    adjusted['baseline_rapm_off_pct'] = adjusted.get('rapm_off_pct')
    adjusted['baseline_rapm_def_pct'] = adjusted.get('rapm_def_pct')

    adjusted['defense_credit_transfer'] = (
        adjusted['rapm_def'].clip(lower=0.0) * adjusted['collinearity_reallocation_score']
    )
    adjusted['offense_collinearity_bonus'] = (
        0.16 * adjusted['collinearity_reallocation_score']
    )

    adjusted['rapm_off'] = (
        adjusted['rapm_off']
        + adjusted['offense_collinearity_bonus']
        + adjusted['defense_credit_transfer']
    )
    adjusted['rapm_def'] = adjusted['rapm_def'] - adjusted['defense_credit_transfer']

    adjusted['rapm_off_pct'] = adjusted['rapm_off'].rank(pct=True) * 100
    adjusted['rapm_def_pct'] = adjusted['rapm_def'].rank(pct=True) * 100
    adjusted['rapm_off_delta'] = adjusted['rapm_off'] - adjusted['baseline_rapm_off']
    adjusted['rapm_def_delta'] = adjusted['rapm_def'] - adjusted['baseline_rapm_def']
    adjusted['rapm_off_pct_delta'] = adjusted['rapm_off_pct'] - adjusted['baseline_rapm_off_pct']
    adjusted['rapm_def_pct_delta'] = adjusted['rapm_def_pct'] - adjusted['baseline_rapm_def_pct']
    return adjusted


def apply_promoted_baseline_rapm_adjustments(raw_season_results, season_dfs):
    """
    Apply production baseline post-fit RAPM adjustments that have graduated
    from experiment status.
    """
    adjusted_results = {
        season_key: df.copy()
        for season_key, df in raw_season_results.items()
    }

    if PROMOTE_2425_COLLINEARITY_REALLOCATION_DEFENSE and '24-25' in adjusted_results:
        print("  Baseline promotion active: 24-25 defense-only collinearity reallocation")
        adjusted_results['24-25'] = apply_2425_collinearity_reallocation_experiment(
            adjusted_results['24-25'],
            season_dfs['24-25'],
            defense_only=True,
        )

    if PROMOTE_COLLINEARITY_REALLOCATION_FORWARD_2425_2526:
        for season_key in ('24-25', '25-26'):
            if season_key in adjusted_results:
                print(f"  Baseline promotion active: {season_key} forward-only collinearity reallocation")
                adjusted_results[season_key] = apply_2425_collinearity_reallocation_experiment(
                    adjusted_results[season_key],
                    season_dfs[season_key],
                    forward_only=True,
                )

    return adjusted_results


def build_experiment_summary(projected_baseline, projected_experimental):
    summary = {}
    extra_cols = [
        c for c in (
            'top_teammate_share',
            'defense_share_multiplier',
            'onice_xgf_pct',
            'onice_xgd60',
            'share_score',
            'offense_tilt_score',
            'collinearity_reallocation_score',
            'offense_collinearity_bonus',
            'defense_credit_transfer',
        ) if c in projected_experimental.columns
    ]
    merged = projected_baseline[
        ['player_id', 'rapm_off', 'rapm_def', 'rapm_off_pct', 'rapm_def_pct']
    ].merge(
        projected_experimental[
            ['player_id', 'rapm_off', 'rapm_def', 'rapm_off_pct', 'rapm_def_pct', *extra_cols]
        ],
        on='player_id',
        suffixes=('_baseline', '_experimental'),
        how='inner',
    )
    if merged.empty:
        return summary

    merged['rapm_off_delta'] = merged['rapm_off_experimental'] - merged['rapm_off_baseline']
    merged['rapm_def_delta'] = merged['rapm_def_experimental'] - merged['rapm_def_baseline']
    merged['rapm_off_pct_delta'] = merged['rapm_off_pct_experimental'] - merged['rapm_off_pct_baseline']
    merged['rapm_def_pct_delta'] = merged['rapm_def_pct_experimental'] - merged['rapm_def_pct_baseline']
    merged['abs_off_pct_delta'] = merged['rapm_off_pct_delta'].abs()
    merged['abs_def_pct_delta'] = merged['rapm_def_pct_delta'].abs()

    summary['players_compared'] = int(len(merged))
    summary['median_abs_rapm_off_pct_delta'] = float(round(merged['abs_off_pct_delta'].median(), 3))
    summary['median_abs_rapm_def_pct_delta'] = float(round(merged['abs_def_pct_delta'].median(), 3))
    summary['share_within_10_off_pct_points'] = float(round((merged['abs_off_pct_delta'] <= 10.0).mean(), 4))
    summary['share_within_10_def_pct_points'] = float(round((merged['abs_def_pct_delta'] <= 10.0).mean(), 4))
    summary['top_movers'] = [
        {
            'player_id': int(row.player_id),
            'rapm_off_baseline': round(float(row.rapm_off_baseline), 4),
            'rapm_off_experimental': round(float(row.rapm_off_experimental), 4),
            'rapm_def_baseline': round(float(row.rapm_def_baseline), 4),
            'rapm_def_experimental': round(float(row.rapm_def_experimental), 4),
            'rapm_off_pct_baseline': round(float(row.rapm_off_pct_baseline), 2),
            'rapm_off_pct_experimental': round(float(row.rapm_off_pct_experimental), 2),
            'rapm_def_pct_baseline': round(float(row.rapm_def_pct_baseline), 2),
            'rapm_def_pct_experimental': round(float(row.rapm_def_pct_experimental), 2),
            'rapm_off_pct_delta': round(float(row.rapm_off_pct_delta), 2),
            'rapm_def_pct_delta': round(float(row.rapm_def_pct_delta), 2),
            **{
                col: round(float(getattr(row, col)), 4)
                for col in extra_cols
                if getattr(row, col, None) is not None and not pd.isna(getattr(row, col, None))
            },
        }
        for row in merged.assign(
            sort_delta=np.maximum(merged['abs_off_pct_delta'], merged['abs_def_pct_delta'])
        ).sort_values('sort_delta', ascending=False).head(25).itertuples()
    ]
    return summary


# ── Bayesian prior-informed RAPM ──────────────────────────────────────────────
def fetch_player_seasons_for_priors():
    """
    Fetch player_seasons from Supabase with the stats needed for box-score priors.
    Returns a DataFrame with columns: player_id, season, toi, g, a1, ixg, cf_pct.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("  Warning: SUPABASE_URL/KEY not set — skipping box-score priors")
        return pd.DataFrame()
    try:
        sb = create_client(SUPABASE_URL, SUPABASE_KEY)
        # Paginate to avoid the 1000-row default cap (player_seasons has ~2000 rows)
        rows = []
        offset = 0
        while True:
            batch = (sb.table('player_seasons')
                     .select('player_id,season,gp,toi,g,a1,ixg,ixg_own,cf_pct')
                     .range(offset, offset + 999)
                     .execute().data)
            if not batch:
                break
            rows.extend(batch)
            offset += len(batch)
            if len(batch) < 1000:
                break
        df = pd.DataFrame(rows)
        for col in ('gp', 'toi', 'g', 'a1', 'ixg', 'cf_pct'):
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0.0)
        # ixg_own may be NULL if build_xg_model.py hasn't run yet — keep 0.0 as fallback
        if 'ixg_own' in df.columns:
            df['ixg_own'] = pd.to_numeric(df['ixg_own'], errors='coerce').fillna(0.0)
        else:
            df['ixg_own'] = 0.0
        df['player_id'] = df['player_id'].astype(int)
        n_with_own = int((df['ixg_own'] > 0).sum())
        print(f"  Fetched player_seasons for priors: {len(df)} rows "
              f"({df['season'].nunique()} seasons, {df['player_id'].nunique()} players, "
              f"{n_with_own} rows with ixg_own>0)")
        return df
    except Exception as e:
        print(f"  Warning: could not fetch player_seasons for priors: {e}")
        return pd.DataFrame()


def compute_box_score_prior(player_seasons_df, season):
    """
    Compute a simple box-score prior for each player in a given season.
    Returns dict: {player_id: {'off_prior': float, 'def_prior': float}}
    """
    if player_seasons_df.empty:
        return {}
    season_df = player_seasons_df[player_seasons_df['season'] == season].copy()
    if season_df.empty:
        return {}

    # toi column should be in minutes — but detect seconds if values are suspiciously large
    median_toi = season_df['toi'].median() if not season_df.empty else 0.0
    print(f"    TOI diagnostic ({season}): median={median_toi:.1f}, "
          f"min={season_df['toi'].min():.1f}, max={season_df['toi'].max():.1f}")
    if median_toi > 3000:
        # Median > 3000 is impossible in minutes (>50 hrs/season) → must be seconds
        print(f"    AUTO-CORRECTING: toi appears to be in seconds "
              f"(median={median_toi:.0f}), dividing by 60 to get minutes")
        season_df['toi'] = season_df['toi'] / 60.0

    # Filter at 200 min
    season_df = season_df[season_df['toi'] >= 200.0].copy()
    if season_df.empty:
        return {}

    season_df['toi_hours'] = season_df['toi'] / 60.0

    # Use ixg_own (calibrated XGB model) when available; fall back to EH ixg.
    # EH ixg over-values close-range tip-ins for net-front forwards (e.g. Anders Lee),
    # inflating their box-score prior and chaining inflated RAPM forward.
    has_own = ('ixg_own' in season_df.columns and (season_df['ixg_own'] > 0).any())
    if has_own:
        season_df['ixg_for_prior'] = np.where(
            season_df['ixg_own'] > 0,
            season_df['ixg_own'],
            season_df['ixg'],
        )
        n_using_own = int((season_df['ixg_own'] > 0).sum())
        print(f"    ixg_own: {n_using_own}/{len(season_df)} players use calibrated xG "
              f"(rest fall back to EH ixg)")
    else:
        season_df['ixg_for_prior'] = season_df['ixg']
        print(f"    ixg_own: not available — using EH ixg for all players")

    season_df['ixg_60'] = season_df['ixg_for_prior'] / season_df['toi_hours']
    season_df['pts_60'] = (season_df['g'] + season_df['a1']) / season_df['toi_hours']

    avg_ixg_60 = season_df['ixg_60'].mean()
    avg_pts_60 = season_df['pts_60'].mean()
    avg_cf = season_df['cf_pct'].mean() if 'cf_pct' in season_df.columns else 50.0

    # Diagnostic: print ixg/60 for key net-front forwards vs playmakers
    _DIAG_PIDS = {8475314: 'Anders Lee', 8478402: 'McDavid', 8477492: 'MacKinnon'}
    for _pid, _name in _DIAG_PIDS.items():
        _row = season_df[season_df['player_id'] == _pid]
        if not _row.empty:
            _r = _row.iloc[0]
            _eh60 = float(_r['ixg']) / float(_r['toi_hours']) if _r['toi_hours'] > 0 else 0
            _own60 = float(_r['ixg_for_prior']) / float(_r['toi_hours']) if _r['toi_hours'] > 0 else 0
            print(f"    {_name}: EH ixg/60={_eh60:.2f}  used ixg/60={_own60:.2f}  "
                  f"(avg={avg_ixg_60:.2f})")

    season_df['off_prior'] = (
        (season_df['ixg_60'] - avg_ixg_60) * 0.5 +
        (season_df['pts_60'] - avg_pts_60) * 0.3
    ) * 0.4  # shrink toward zero — prior is a hint not a certainty

    season_df['def_prior'] = (
        (season_df['cf_pct'].fillna(avg_cf) - avg_cf) / 100.0
    ) * 0.2  # very small defensive prior

    priors = {}
    for _, row in season_df.iterrows():
        priors[int(row['player_id'])] = {
            'off_prior': float(row['off_prior']),
            'def_prior': float(row['def_prior']),
        }
    return priors


def get_player_prior(player_id, previous_rapm, box_score_prior, current_season_toi,
                     current_season_gp=None, experiment_name=""):
    """
    Return prior {'off': float, 'def': float} for a player, handling all 4 cases:
      1. Returning player with previous RAPM → apply TopDownHockey linear trend shrinkage
         + GP-based dampening: if player has <20 GP this season, shrink chained prior.
         Prevents injured/retired players (Landeskog etc.) from inheriting stale priors.
      2. New player with ≥200 min current season → use box-score prior
      3. New player with <200 min current season → shrink box-score prior by sample size
      4. True rookie with no data at all → neutral (0.0, 0.0)
    Never returns None or raises KeyError — always falls through to 0.0.
    """
    if experiment_name == EXPERIMENT_EV_PRIOR_PARITY:
        if player_id in previous_rapm:
            prev = previous_rapm[player_id]
            return {
                'off': 0.008151 + prev.get('off', 0.0) * 0.446297,
                'def': -0.003181 + prev.get('def', 0.0) * 0.280373,
                'source': 'chained',
            }
        return {'off': 0.0, 'def': 0.0, 'source': 'neutral'}

    # Case 1 — Returning player with previous RAPM
    if player_id in previous_rapm:
        prev = previous_rapm[player_id]
        off_prior = 0.008151 + prev.get('off', 0.0) * 0.446297
        def_prior = -0.003181 + prev.get('def', 0.0) * 0.280373
        # Blend with box-score prior (60% chain, 40% box-score) when box data is available.
        # Pure chain propagates collinearity artifacts (e.g. Knies underrated playing with
        # Matthews/Nylander). Blending anchors the prior to observed production.
        if player_id in box_score_prior:
            bp = box_score_prior[player_id]
            off_prior = 0.6 * off_prior + 0.4 * bp.get('off_prior', 0.0)
            def_prior = 0.6 * def_prior + 0.4 * bp.get('def_prior', 0.0)
        # GP-based dampening: players with < 20 GP this season have stale/unreliable priors
        # (covers injured returners like Landeskog who chain old RAPM forward)
        if current_season_gp is not None:
            gp = current_season_gp.get(player_id, 0)
            if gp < 20:
                prior_weight = gp / 20.0  # 0.0 (0 GP) → 1.0 (20+ GP)
                off_prior *= prior_weight
                def_prior *= prior_weight
        return {'off': off_prior, 'def': def_prior, 'source': 'chained_blended'}

    # Case 2 — New player with ≥200 min current season data
    if player_id in box_score_prior and current_season_toi.get(player_id, 0) >= 200:
        bp = box_score_prior[player_id]
        return {
            'off': bp.get('off_prior', 0.0),
            'def': bp.get('def_prior', 0.0),
            'source': 'box_score',
        }

    # Case 3 — New player with <200 min current season (callup/rookie)
    if player_id in box_score_prior:
        toi = current_season_toi.get(player_id, 0)
        shrinkage = min(toi / 200.0, 1.0)
        bp = box_score_prior[player_id]
        return {
            'off': bp.get('off_prior', 0.0) * shrinkage,
            'def': bp.get('def_prior', 0.0) * shrinkage,
            'source': 'box_score_shrunk',
        }

    # Case 4 — True rookie with no data at all
    return {'off': 0.0, 'def': 0.0, 'source': 'neutral'}


def _compute_toi_from_stints(stints_df):
    """
    Compute per-player TOI in minutes from a stints DataFrame.
    Returns dict: {player_id: toi_minutes}
    """
    toi_sec = defaultdict(float)
    for _, row in stints_df.iterrows():
        dur = float(row.get('duration_seconds', 0) or 0)
        for col in ('home_players', 'away_players'):
            cell = row.get(col, '')
            if pd.isna(cell):
                continue
            for p in str(cell).split('|'):
                p = p.strip()
                if p:
                    toi_sec[int(p)] += dur
    return {pid: t / 60.0 for pid, t in toi_sec.items()}


def run_prior_informed_rapm(stints_by_season, player_seasons_df, current_season_filter=None,
                             events_by_season=None, experiment_name="", asymmetric_k=1.0):
    """
    Daisy chain RAPM across all available seasons (oldest first).
    Each season's output becomes the prior for the next, propagating
    player identity information forward through time.
    Returns dict: {season: raw_results_df} with rapm_off/rapm_def columns.
    Card projection uses only the 3 most recent seasons via CARD_SEASON_WEIGHTS.

    current_season_filter: optional set of player_ids with ≥200 min in the current season
      (25-26). Passed only to the '25-26' build_rapm() call to exclude low-sample
      call-ups that lack both current-season TOI and a prior.

    events_by_season: optional dict {season: events_df}. Retained for compatibility
      with the existing orchestration; shift-level EV RAPM ignores event rows.
    """
    # Sort chronologically by season start year
    seasons_in_order = sorted(
        stints_by_season.keys(),
        key=lambda s: int(s.split('-')[0])
    )
    previous_rapm = {}   # {player_id: {'off': float, 'def': float}}
    all_season_results = {}
    if experiment_name == EXPERIMENT_EV_PRIOR_PARITY:
        print("  Experimental EV prior parity: chained EV prior only, no box-score blend, no GP dampening.")
        print("  Prior subtraction/add-back remains in xGF/60 space.")

    for season in seasons_in_order:
        if season not in stints_by_season:
            print(f"  Warning: no stints for {season} — skipping")
            continue

        stints = stints_by_season[season]
        print(f"\n  Building box-score prior for {season}...")
        box_prior = compute_box_score_prior(player_seasons_df, season)
        print(f"    Box-score prior computed for {len(box_prior)} players")

        # Build current-season GP lookup for GP-based prior dampening
        current_season_gp: dict[int, int] = {}
        if not player_seasons_df.empty and 'gp' in player_seasons_df.columns:
            gp_df = player_seasons_df[player_seasons_df['season'] == season][['player_id', 'gp']].copy()
            current_season_gp = {int(r.player_id): int(r.gp) for r in gp_df.itertuples()}

        # Compute per-player TOI (minutes) from this season's stints
        current_season_toi = _compute_toi_from_stints(stints)

        # Collect all player IDs that might need a prior
        all_player_ids = set()
        for col in ('home_players', 'away_players'):
            for cell in stints[col].dropna():
                for p in str(cell).split('|'):
                    if p.strip():
                        all_player_ids.add(int(p))
        all_player_ids.update(box_prior.keys())
        all_player_ids.update(previous_rapm.keys())

        season_priors = {
            pid: get_player_prior(pid, previous_rapm, box_prior, current_season_toi,
                                  current_season_gp=current_season_gp,
                                  experiment_name=experiment_name)
            for pid in all_player_ids
        }
        n_nonzero = sum(
            1 for p in season_priors.values()
            if abs(p['off']) > 0.001 or abs(p['def']) > 0.001
        )
        print(f"    Season priors: {len(season_priors)} players, {n_nonzero} non-zero")
        source_counts = defaultdict(int)
        for prior in season_priors.values():
            source_counts[str(prior.get('source') or 'unknown')] += 1
        if source_counts:
            print("    Prior sources:", dict(sorted(source_counts.items())))

        # Diagnostic: print raw player_seasons + priors for key players
        if SUPABASE_URL and SUPABASE_KEY:
            try:
                _sb = create_client(SUPABASE_URL, SUPABASE_KEY)
                _diag_names = ['Matthew Knies', 'William Nylander', 'Auston Matthews',
                                'Gabriel Landeskog', 'Leon Draisaitl', 'Connor McDavid',
                                'Mackie Samoskevich', 'Ben Kindel', 'Evan Bouchard',
                                'Jackson LaCombe', 'Rasmus Andersson']
                _pids = {r['full_name']: r['player_id'] for r in
                         _sb.table('players').select('player_id,full_name').execute().data
                         if r['full_name'] in _diag_names}
                print(f"\n    DIAGNOSTIC — Raw player_seasons + priors for {season}:")
                for _name, _pid in sorted(_pids.items()):
                    _ps = player_seasons_df[
                        (player_seasons_df['player_id'] == _pid) &
                        (player_seasons_df['season'] == season)
                    ]
                    _bp = box_prior.get(_pid)
                    _sp = season_priors.get(_pid)
                    _gp_val = current_season_gp.get(_pid, 0)
                    _chained = _pid in previous_rapm
                    _box_str = f"box_off={_bp['off_prior']:+.4f}" if _bp else "box=N/A"
                    _prior_off_str = f"prior_off={_sp['off']:+.4f}" if _sp else "prior_off=N/A"
                    _prior_def_str = f"prior_def={_sp['def']:+.4f}" if _sp else "prior_def=N/A"
                    _src = _sp.get('source', 'unknown') if _sp else 'N/A'
                    if not _ps.empty:
                        _r = _ps.iloc[0]
                        print(f"      {_name:<24} gp={int(_r['gp']):<3} "
                              f"toi={_r['toi']:.1f}min  g={_r['g']:.0f}  "
                              f"ixg={_r['ixg']:.2f}  {_box_str}  {_prior_off_str}  {_prior_def_str}  "
                              f"src={_src:<15} chained={'Y' if _chained else 'N'}  season_gp={_gp_val}")
                    else:
                        print(f"      {_name:<24} NO ps row for {season}  "
                              f"{_prior_off_str}  {_prior_def_str}  src={_src:<15} chained={'Y' if _chained else 'N'}  "
                              f"season_gp={_gp_val}")
                print()
            except Exception as _e:
                print(f"    DIAGNOSTIC failed: {_e}")

        print(f"  Fitting prior-informed RAPM for {season}...")
        csf = current_season_filter if season == '25-26' else None
        season_events = (events_by_season.get(season) if events_by_season else None)
        n_events = len(season_events) if season_events is not None and not season_events.empty else 0
        mode_str = (
            f"shift-level ({n_events:,} cached events ignored)"
            if n_events > 0 else
            "shift-level"
        )
        print(f"  Regression mode: {mode_str}")
        raw_results = build_rapm(stints, priors=season_priors, current_season_filter=csf,
                                  events_df=season_events, asymmetric_k=asymmetric_k)
        all_season_results[season] = raw_results

        # Feed this season's results forward as the next season's prior
        previous_rapm = {
            int(row.player_id): {'off': float(row.rapm_off), 'def': float(row.rapm_def)}
            for row in raw_results.itertuples()
        }
        print(f"  {season} done: {len(raw_results)} players in results")

    return all_season_results


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
        return [], []

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
        return [], []

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

    # Build prior event lookup for rush/rebound context
    all_events_list = []
    for _, ev in pbp_df.iterrows():
        try:
            p = int(ev.get('Period', 0))
            s = ev.get('Seconds_Elapsed', 0)
            if pd.isna(s) or p not in (1, 2, 3):
                continue
            all_events_list.append({
                't':          (p - 1) * 1200 + int(float(s)),
                'xC':         ev.get('xC'),
                'yC':         ev.get('yC'),
                'event_type': str(ev.get('Event', '')).upper(),
            })
        except Exception:
            continue
    all_events_list.sort(key=lambda x: x['t'])

    for _, ev in pbp_df.iterrows():
        try:
            period = int(ev.get('Period', 0))
        except (ValueError, TypeError):
            continue
        if period not in (1, 2, 3):
            continue
        event_type = str(ev.get('Event', '')).upper()
        if event_type not in XG_TYPES:
            continue
        secs = ev.get('Seconds_Elapsed', 0)
        if pd.isna(secs):
            continue
        t         = (period - 1) * 1200 + int(float(secs))
        xc        = ev.get('xC')
        yc        = ev.get('yC')
        shot_type = str(ev.get('Type', ''))
        is_home   = (str(ev.get('Ev_Team', '')).upper().strip() == home_team)

        # Find most recent prior event for rush/rebound context
        prev_ev = None
        for ev_item in reversed(all_events_list):
            if ev_item['t'] < t:
                prev_ev = ev_item
                break

        if pd.notna(xc) and pd.notna(yc):
            shot_row_dict = {'xC': xc, 'yC': yc, 'shot_type': shot_type, 't': t}
            xg = compute_xg_from_model(
                shot_row_dict, prev_ev,
                score_state=0,
                period=period,
                is_home=is_home,
                game_strength='5v5'
            )
        else:
            dist = _parse_dist(ev.get('Description', ''))
            if dist is None:
                continue
            xg = compute_xg_xy(89.0 - dist, 0.0, shot_type)

        xg_events.append((t, xg, is_home))
        if event_type == 'GOAL':
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

    # ── Extract event-level records from xg_events ─────────────────────────
    # For each shot event, look up on-ice players and parent stint duration.
    # Only 5v5 intervals are captured (same filter as stints above).
    if raw_stints:
        _raw_starts = np.array([rs['start_sec']        for rs in raw_stints])
        _raw_ends   = np.array([rs['end_sec']          for rs in raw_stints])
        _raw_durs   = np.array([rs['duration_seconds'] for rs in raw_stints])
    else:
        _raw_starts = np.array([], dtype=int)
        _raw_ends   = np.array([], dtype=int)
        _raw_durs   = np.array([], dtype=int)

    event_records = []
    for (t_ev, xg_ev, is_home_ev) in xg_events:
        # Find containing 5v5 interval via binary search
        pos = int(np.searchsorted(_raw_starts, t_ev + 1, side='left')) - 1
        if pos < 0 or pos >= len(_raw_starts):
            continue
        if not (_raw_starts[pos] <= t_ev < _raw_ends[pos]):
            continue
        parent_dur = int(_raw_durs[pos])

        # Look up on-ice players at event time
        home_ev, away_ev = set(), set()
        for pid_ev, ivs_ev in player_intervals.items():
            for s_ev, e_ev, is_h_ev in ivs_ev:
                if s_ev <= t_ev < e_ev:
                    (home_ev if is_h_ev else away_ev).add(pid_ev)
                    break
        if len(home_ev) != 5 or len(away_ev) != 5:
            continue

        period_ev = t_ev // 1200 + 1
        hg = sum(1 for gt, ih in goal_events if gt < t_ev and ih)
        ag = sum(1 for gt, ih in goal_events if gt < t_ev and not ih)
        event_records.append({
            'game_id':              full_game_id,
            't':                    t_ev,
            'xg':                   round(xg_ev, 4),
            'is_home_shot':         int(is_home_ev),
            'home_players':         '|'.join(str(p) for p in sorted(home_ev)),
            'away_players':         '|'.join(str(p) for p in sorted(away_ev)),
            'home_score_diff':      hg - ag,
            'period':               period_ev,
            'stint_duration_seconds': parent_dur,
        })

    return _merge_stints(raw_stints), event_records


STINT_COLS = [
    'game_id', 'period', 'start_sec', 'end_sec', 'duration_seconds',
    'home_players', 'away_players', 'home_xg', 'away_xg', 'home_score_diff',
]

PP_PK_STINT_COLS = STINT_COLS + ['strength_state']

EVENT_COLS = [
    'game_id', 't', 'xg', 'is_home_shot',
    'home_players', 'away_players',
    'home_score_diff', 'period', 'stint_duration_seconds',
]


def _merge_pp_pk_stints(stints):
    """Merge adjacent PP/PK stints with identical lineups and strength state."""
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
                s.get('strength_state') == prev.get('strength_state') and
                s['start_sec'] <= prev['end_sec'] + 1):
            prev['end_sec'] = max(prev['end_sec'], s['end_sec'])
            prev['duration_seconds'] = prev['end_sec'] - prev['start_sec']
            prev['home_xg'] = round(prev['home_xg'] + s['home_xg'], 4)
            prev['away_xg'] = round(prev['away_xg'] + s['away_xg'], 4)
        else:
            merged.append(s.copy())
    return [s for s in merged if s['duration_seconds'] >= 10]


def build_pp_pk_stints_from_game_hs(full_game_id, pbp_df, shifts_df):
    """
    Reconstruct PP/PK stints for one game using hockey-scraper DataFrames.
    Captures strength states: 5v4, 4v5, 5v3, 3v5, 4v3, 3v4.
    Returns list of dicts with same columns as EV stints plus 'strength_state'.
    """
    PP_PK_PAIRS = {(5, 4), (4, 5), (5, 3), (3, 5), (4, 3), (3, 4)}
    XG_TYPES = {'SHOT', 'GOAL', 'MISS'}

    if pbp_df.empty or shifts_df.empty:
        return []

    home_team = str(pbp_df['Home_Team'].iloc[0]).upper().strip()

    # Collect goalie IDs to exclude
    goalie_ids = set()
    for col in ('Home_Goalie_Id', 'Away_Goalie_Id'):
        if col in pbp_df.columns:
            for v in pbp_df[col].dropna().unique():
                try:
                    goalie_ids.add(int(float(v)))
                except (ValueError, TypeError):
                    pass

    # Parse shifts into per-player on-ice intervals (same as EV)
    player_intervals = {}
    for _, sh in shifts_df.iterrows():
        try:
            period = int(sh.get('Period', 0))
        except (ValueError, TypeError):
            continue
        if period not in (1, 2, 3):
            continue
        pid = sh.get('Player_Id')
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
        abs_start = (period - 1) * 1200 + int(float(start_s))
        abs_end   = (period - 1) * 1200 + int(float(end_s))
        if abs_end <= abs_start:
            continue
        is_home = (str(sh.get('Team', '')).upper().strip() == home_team)
        player_intervals.setdefault(pid, []).append((abs_start, abs_end, is_home))

    if not player_intervals:
        return []

    # Change points from shift boundaries and period boundaries
    change_pts = set()
    for ivs in player_intervals.values():
        for s, e, _ in ivs:
            change_pts.add(s)
            change_pts.add(e)
    for p in range(1, 4):
        change_pts.add((p - 1) * 1200)
        change_pts.add(p * 1200)

    # xG events from PBP — use '5v4' as approximate game strength for PP shots
    xg_events  = []
    goal_events = []
    all_events_list = []
    for _, ev in pbp_df.iterrows():
        try:
            p = int(ev.get('Period', 0))
            s = ev.get('Seconds_Elapsed', 0)
            if pd.isna(s) or p not in (1, 2, 3):
                continue
            all_events_list.append({
                't':          (p - 1) * 1200 + int(float(s)),
                'xC':         ev.get('xC'),
                'yC':         ev.get('yC'),
                'event_type': str(ev.get('Event', '')).upper(),
            })
        except Exception:
            continue
    all_events_list.sort(key=lambda x: x['t'])

    for _, ev in pbp_df.iterrows():
        try:
            period = int(ev.get('Period', 0))
        except (ValueError, TypeError):
            continue
        if period not in (1, 2, 3):
            continue
        event_type = str(ev.get('Event', '')).upper()
        if event_type not in XG_TYPES:
            continue
        secs = ev.get('Seconds_Elapsed', 0)
        if pd.isna(secs):
            continue
        t         = (period - 1) * 1200 + int(float(secs))
        xc        = ev.get('xC')
        yc        = ev.get('yC')
        shot_type = str(ev.get('Type', ''))
        is_home   = (str(ev.get('Ev_Team', '')).upper().strip() == home_team)
        prev_ev = None
        for ev_item in reversed(all_events_list):
            if ev_item['t'] < t:
                prev_ev = ev_item
                break
        if pd.notna(xc) and pd.notna(yc):
            xg = compute_xg_from_model(
                {'xC': xc, 'yC': yc, 'shot_type': shot_type, 't': t},
                prev_ev, period=period, is_home=is_home, game_strength='5v4',
            )
        else:
            dist = _parse_dist(ev.get('Description', ''))
            if dist is None:
                continue
            xg = compute_xg_xy(89.0 - dist, 0.0, shot_type)
        if xg is not None:
            xg_events.append((t, xg, is_home))
        if event_type == 'GOAL':
            goal_events.append((t, is_home))

    for goal_time, _ in goal_events:
        change_pts.add(goal_time)
    change_pts = sorted(change_pts)

    # Build micro-stints
    raw_stints = []
    for i in range(len(change_pts) - 1):
        t_start = change_pts[i]
        t_end   = change_pts[i + 1]
        dur     = t_end - t_start
        if dur <= 0:
            continue
        if t_start // 1200 != t_end // 1200 and t_end % 1200 != 0:
            continue
        p_start = t_start // 1200 + 1
        if p_start > 3:
            continue
        t_mid = (t_start + t_end) / 2.0
        home_sk, away_sk = set(), set()
        for pid, ivs in player_intervals.items():
            for s, e, is_h in ivs:
                if s <= t_mid < e:
                    (home_sk if is_h else away_sk).add(pid)
                    break
        h_n, a_n = len(home_sk), len(away_sk)
        if (h_n, a_n) not in PP_PK_PAIRS:
            continue
        strength = f"{h_n}v{a_n}"
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
            'strength_state':   strength,
        })

    return _merge_pp_pk_stints(raw_stints)


def _derive_events_from_stints(stints_df):
    """
    Approximate event extraction from cached stints when true PBP events are
    unavailable (i.e. events_ev_XXYY.csv missing or empty).

    One synthetic event per stint-side with non-zero xG, placed at the stint
    midpoint.  This eliminates zero-inflation without re-scraping.  The
    aggregated xG value is used directly as the regression target.

    Can be replaced with true per-shot events once a scrape is run.
    """
    records = []
    for _, stint in stints_df.iterrows():
        t_mid   = int((float(stint['start_sec']) + float(stint['end_sec'])) / 2.0)
        hxg     = float(stint.get('home_xg', 0) or 0)
        axg     = float(stint.get('away_xg', 0) or 0)
        dur     = int(float(stint.get('duration_seconds', 30) or 30))
        def _safe_int(v, default=0):
            try:
                f = float(v)
                return default if (f != f) else int(f)  # NaN check: NaN != NaN
            except (TypeError, ValueError):
                return default
        common  = {
            'game_id':              _safe_int(stint['game_id']),
            't':                    t_mid,
            'home_players':         str(stint.get('home_players', '') or ''),
            'away_players':         str(stint.get('away_players', '') or ''),
            'home_score_diff':      _safe_int(stint.get('home_score_diff', 0)),
            'period':               _safe_int(stint.get('period', 1), default=1),
            'stint_duration_seconds': dur,
        }
        if hxg > 0:
            records.append({**common, 'xg': round(hxg, 4), 'is_home_shot': 1})
        if axg > 0:
            records.append({**common, 'xg': round(axg, 4), 'is_home_shot': 0})
    if not records:
        return pd.DataFrame(columns=EVENT_COLS)
    return pd.DataFrame(records, columns=EVENT_COLS)


def fetch_all_stints(game_ids, season_cfg):
    """
    Scrape all games for one season and extract merged 5v5 stints plus shot events.
    Resumes automatically from existing stints_file or ckpt_file.
    Saves a checkpoint every 5 batches (~250 games).
    Returns (stints_df, events_df) tuple.
    """
    stints_file = season_cfg['stints_file']
    ckpt_file   = season_cfg['ckpt_file']
    id_base     = season_cfg['id_base']

    events_file      = season_cfg['stints_file'].replace('stints_', 'events_ev_')
    events_ckpt_file = events_file.replace('.csv', '_checkpoint.csv')

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

    # Load existing events checkpoint
    existing_ev_rows = []
    if os.path.exists(events_ckpt_file):
        try:
            ev_ckpt = pd.read_csv(events_ckpt_file)
            if len(ev_ckpt) > 0:
                existing_ev_rows = ev_ckpt.to_dict('records')
                print(f"  Events checkpoint: {len(existing_ev_rows)} events loaded")
        except Exception as e:
            print(f"  Warning: could not load events checkpoint: {e}")

    todo = [gid for gid in game_ids if gid not in done_games]

    if SKIP_SCRAPING:
        print(f"  SKIP_SCRAPING: using {len(existing_rows)} cached stints ({len(todo)} games skipped)")
        df = (pd.DataFrame(existing_rows, columns=STINT_COLS)
              if existing_rows else pd.DataFrame(columns=STINT_COLS))
        # Load cached events if available; derive from stints if missing/empty
        ev_df = pd.DataFrame(columns=EVENT_COLS)
        if os.path.exists(events_file):
            try:
                ev_df = pd.read_csv(events_file)
                print(f"  Loaded {len(ev_df):,} events from {os.path.basename(events_file)}")
            except Exception as e:
                print(f"  Warning: could not load events file: {e}")
        if ev_df.empty and not df.empty:
            print(f"  Events file missing or empty — deriving approximate events from "
                  f"{len(df):,} cached stints (one per stint-side with xG > 0)...")
            ev_df = _derive_events_from_stints(df)
            xg_vals = ev_df['xg'].values if not ev_df.empty else []
            print(f"  Derived {len(ev_df):,} events  "
                  f"mean_xg={float(sum(xg_vals)/max(len(xg_vals),1)):.4f}  zeros=0")
            if not ev_df.empty:
                ev_df.to_csv(events_file, index=False)
                print(f"  Saved derived events → {os.path.basename(events_file)}")
        return df, ev_df

    if TEST_MODE:
        todo = todo[:TEST_GAMES]
        print(f"  TEST_MODE: processing {len(todo)} games")

    if not todo:
        df = (pd.DataFrame(existing_rows, columns=STINT_COLS)
              if existing_rows else pd.DataFrame(columns=STINT_COLS))
        print(f"  All games already processed ({len(df)} stints total)")
        # Load cached events; derive from stints if missing/empty
        ev_df = pd.DataFrame(columns=EVENT_COLS)
        if os.path.exists(events_file):
            try:
                ev_df = pd.read_csv(events_file)
                print(f"  Loaded {len(ev_df):,} events from cache")
            except Exception:
                pass
        if ev_df.empty and not df.empty:
            print(f"  Events file missing or empty — deriving approximate events from "
                  f"{len(df):,} cached stints...")
            ev_df = _derive_events_from_stints(df)
            xg_vals = ev_df['xg'].values if not ev_df.empty else []
            print(f"  Derived {len(ev_df):,} events  "
                  f"mean_xg={float(sum(xg_vals)/max(len(xg_vals),1)):.4f}  zeros=0")
            if not ev_df.empty:
                ev_df.to_csv(events_file, index=False)
                print(f"  Saved derived events → {os.path.basename(events_file)}")
        return df, ev_df

    total        = len(todo)
    n_batches    = math.ceil(total / BATCH_SIZE)
    new_rows     = []
    new_ev_rows  = []
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
            batch_stints, batch_events = _extract_batch_stints(batch, result, id_base, batch_failed)
            if not batch_stints:
                raise ValueError("empty batch result")
            new_rows.extend(batch_stints)
            new_ev_rows.extend(batch_events)
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
                    single_stints, single_events = _extract_batch_stints([gid], single_result, id_base, single_failed)
                    if single_stints:
                        new_rows.extend(single_stints)
                        new_ev_rows.extend(single_events)
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
            if new_ev_rows:
                cp_ev = existing_ev_rows + new_ev_rows
                pd.DataFrame(cp_ev, columns=EVENT_COLS).to_csv(events_ckpt_file, index=False)

    if failed:
        print(f"  {len(failed)} games could not be processed")

    all_rows = existing_rows + new_rows
    df = (pd.DataFrame(all_rows, columns=STINT_COLS)
          if all_rows else pd.DataFrame(columns=STINT_COLS))

    all_ev_rows = existing_ev_rows + new_ev_rows
    ev_df = (pd.DataFrame(all_ev_rows, columns=EVENT_COLS)
             if all_ev_rows else pd.DataFrame(columns=EVENT_COLS))

    if TEST_MODE:
        print(f"  [TEST] {len(df)} stints, {len(ev_df)} events (not written in TEST_MODE)")
    else:
        df.to_csv(stints_file, index=False)
        print(f"  Total stints: {len(df):,} → {os.path.basename(stints_file)}")
        ev_df.to_csv(events_file, index=False)
        print(f"  Total events: {len(ev_df):,} → {os.path.basename(events_file)}")
        # Clean up checkpoints
        for cp in (ckpt_file, events_ckpt_file):
            if os.path.exists(cp):
                os.remove(cp)

    return df, ev_df


# ── PP/PK stints pipeline ─────────────────────────────────────────────────────
def _pp_pk_stints_file_path(season_cfg):
    """Derive PP/PK stints file path from the EV stints file path."""
    base = os.path.basename(season_cfg['stints_file'])   # e.g. 'stints_2526.csv'
    return os.path.join(DATA_DIR, base.replace('stints_', 'stints_ppk_'))


def _extract_batch_pp_pk_stints(batch, result, id_base, failed):
    pbp_all = _coerce_scrape_frame(result.get('pbp') if isinstance(result, dict) else None)
    sh_all  = _coerce_scrape_frame(result.get('shifts') if isinstance(result, dict) else None)
    if pbp_all.empty or sh_all.empty:
        failed.extend(batch)
        return []
    pbp_all = pbp_all.copy()
    sh_all  = sh_all.copy()
    pbp_all['_gid_full'] = pbp_all['Game_Id'].apply(lambda x: _hs_id_to_full(x, id_base))
    sh_all['_gid_full']  = sh_all['Game_Id'].apply(lambda x: _hs_id_to_full(x, id_base))
    rows = []
    for gid in batch:
        game_pbp = pbp_all[pbp_all['_gid_full'] == gid]
        game_sh  = sh_all[sh_all['_gid_full']  == gid]
        if game_pbp.empty or game_sh.empty:
            failed.append(gid)
            continue
        rows.extend(build_pp_pk_stints_from_game_hs(gid, game_pbp, game_sh))
    return rows


def fetch_all_pp_pk_stints(game_ids, season_cfg):
    """
    Load PP/PK stints from cache or scrape games.
    Supports resume-from-checkpoint (same pattern as fetch_all_stints).
    Returns DataFrame with columns: game_id, period, start_sec, end_sec,
    duration_seconds, home_players, away_players, home_xg, away_xg,
    home_score_diff, strength_state.
    """
    ppk_file  = _pp_pk_stints_file_path(season_cfg)
    ckpt_file = ppk_file.replace('.csv', '_checkpoint.csv')
    id_base   = season_cfg['id_base']

    # Load from final cached file
    if os.path.exists(ppk_file):
        try:
            df = pd.read_csv(ppk_file)
            if len(df) > 0:
                if 'strength_state' not in df.columns:
                    df['strength_state'] = '5v4'
                print(f"  Loaded {len(df):,} PP/PK stints from {os.path.basename(ppk_file)}")
                return df
        except Exception as e:
            print(f"  Warning: could not load {ppk_file}: {e}")

    if SKIP_SCRAPING:
        print(f"  SKIP_SCRAPING: {os.path.basename(ppk_file)} not found — no PP/PK stints for this season")
        return pd.DataFrame(columns=PP_PK_STINT_COLS)

    # Try to resume from checkpoint
    existing_rows = []
    done_games    = set()
    if os.path.exists(ckpt_file):
        try:
            df_ckpt = pd.read_csv(ckpt_file)
            if len(df_ckpt) > 0:
                existing_rows = df_ckpt.to_dict('records')
                done_games    = set(df_ckpt['game_id'].unique())
                print(f"  Resuming from {os.path.basename(ckpt_file)}: "
                      f"{len(done_games)} games done, {len(existing_rows)} stints")
        except Exception as e:
            print(f"  Warning: could not load checkpoint {ckpt_file}: {e}")

    todo = [gid for gid in game_ids if gid not in done_games]
    if TEST_MODE:
        todo = todo[:TEST_GAMES]
    if not todo and not existing_rows:
        return pd.DataFrame(columns=PP_PK_STINT_COLS)

    total     = len(todo)
    n_batches = math.ceil(total / BATCH_SIZE) if total > 0 else 0
    all_rows  = list(existing_rows)
    failed    = []
    print(f"  Generating PP/PK stints: {total} games to process ({n_batches} batches)...")

    for batch_start in range(0, total, BATCH_SIZE):
        batch        = todo[batch_start:batch_start + BATCH_SIZE]
        batches_done = batch_start // BATCH_SIZE + 1
        try:
            result = hockey_scraper.scrape_games(batch, True, data_format='pandas')
            if result is None:
                raise ValueError("scraper returned None")
            batch_failed = []
            batch_rows   = _extract_batch_pp_pk_stints(batch, result, id_base, batch_failed)
            all_rows.extend(batch_rows)
            failed.extend(batch_failed)
            print(f"  Batch {batches_done}/{n_batches}: {len(all_rows):,} PP/PK stints total")
        except Exception as e:
            print(f"  Batch {batches_done}/{n_batches} failed: {e}")
            for gid in batch:
                try:
                    single_result = hockey_scraper.scrape_games([gid], True, data_format='pandas')
                    rows = _extract_batch_pp_pk_stints([gid], single_result, id_base, [])
                    all_rows.extend(rows)
                except Exception as game_err:
                    print(f"    Game {gid} failed: {game_err}")
                    failed.append(gid)
        # Save checkpoint every 5 batches
        if not TEST_MODE and batches_done % 5 == 0:
            pd.DataFrame(all_rows, columns=PP_PK_STINT_COLS).to_csv(ckpt_file, index=False)
            print(f"  Checkpoint saved: {len(all_rows):,} stints → {os.path.basename(ckpt_file)}")

    if failed:
        print(f"  {len(failed)} games could not be processed")

    df = (pd.DataFrame(all_rows, columns=PP_PK_STINT_COLS)
          if all_rows else pd.DataFrame(columns=PP_PK_STINT_COLS))
    if not TEST_MODE:
        df.to_csv(ppk_file, index=False)
        print(f"  {len(df):,} PP/PK stints → {os.path.basename(ppk_file)}")
        if os.path.exists(ckpt_file):
            os.remove(ckpt_file)
    return df


# ── Step 3: Build RAPM regression ─────────────────────────────────────────────
def build_rapm(stints_df, priors=None, current_season_filter=None, events_df=None, asymmetric_k=1.0):
    """
    Fit offense/defense RAPM on combined stints with separate coefficient blocks.
    Each observation models one team's xG rate in a stint:
      - offensive columns for the attacking skaters
      - defensive columns for the defending skaters
    This avoids the earlier leakage where elite offensive players could inherit
    artificially strong defensive coefficients from one blended player term.

    priors: optional dict {player_id: {'off': float, 'def': float}}
      When provided, the prior is subtracted from the target before regression
      and added back to the coefficients after, anchoring players to reasonable
      box-score estimates so collinearity can't push them to absurd values.

    current_season_filter: optional set of player_ids with ≥200 min current-season TOI.
      When provided, players NOT in this set are excluded from the regression matrix
      unless they have a prior (established history). Prevents 3-GP call-ups from
      polluting the matrix via inflated prior chain values.

    events_df: optional DataFrame of shot events (EVENT_COLS). Retained only for
      upstream compatibility/debugging; EV RAPM now fits on shift-level rows to
      mirror JFresh's published methodology more closely.
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
    context_features = [
        'is_home_attack', 'score_state', 'score_state_abs', 'period_2', 'period_3',
        # Dummy variables (Tasks 1, 2, 3) — present only for DUMMY_SEASONS;
        # absent in older seasons (treated as 0 via .get())
        'home_pp_expiry', 'away_pp_expiry',
        'home_ozs', 'away_ozs', 'nzs',
        'home_btb', 'away_btb',
    ]
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

    # Pre-regression TOI filter: exclude players with <500 min 5v5 TOI from the regression
    # matrix to suppress small-sample noise. Excluded players receive shrunk-prior estimate.
    # Note: was raised to 750 but reverted — the 750-min threshold reduces the 25-26 in-season
    # matrix to only ~94 players, amplifying McDavid/Draisaitl collinearity and causing
    # Draisaitl to fail the quality gate. The post-projection ≥400-min filter handles fringe
    # players; the card guard (≥200 min in one card season) handles stale historical players.
    MIN_REGRESSION_TOI_SEC = 500 * 60
    excluded_pids = {p for p in all_pids if player_toi_sec.get(p, 0) < MIN_REGRESSION_TOI_SEC}
    # Fix 2: also exclude players not in current_season_filter (if provided) unless they
    # have a strong prior history (prior exists AND ≥500 min combined in this season's stints).
    if current_season_filter is not None:
        newly_excluded = set()
        for p in list(excluded_pids):
            pass  # already excluded — keep
        qualified_pids = sorted(p for p in all_pids if player_toi_sec.get(p, 0) >= MIN_REGRESSION_TOI_SEC)
        for p in list(qualified_pids):
            if p not in current_season_filter:
                if not (priors and p in priors):
                    newly_excluded.add(p)
        excluded_pids = excluded_pids | newly_excluded
        all_pids = sorted(p for p in all_pids
                          if player_toi_sec.get(p, 0) >= MIN_REGRESSION_TOI_SEC
                          and p not in newly_excluded)
        if newly_excluded:
            print(f"  Current-season filter excluded {len(newly_excluded)} more players "
                  f"(no 25-26 TOI ≥200 min and no prior)")
    else:
        all_pids = sorted(p for p in all_pids if player_toi_sec.get(p, 0) >= MIN_REGRESSION_TOI_SEC)
    pid_idx   = {p: i for i, p in enumerate(all_pids)}
    n_players = len(all_pids)
    print(f"  Pre-regression TOI filter (≥500 min): {n_players} in matrix, "
          f"{len(excluded_pids)} excluded (will receive shrunk prior)")

    if events_df is not None and not events_df.empty:
        print(f"  Shift-level EV RAPM rewrite active: ignoring {len(events_df):,} event rows for regression")

    n_stints_use = len(stints_df)
    has_season_weight = 'season_weight' in stints_df.columns
    shift_lengths = pd.to_numeric(stints_df['duration_seconds'], errors='coerce').fillna(0.0)
    print(f"Building RAPM matrix (shift-level): {n_stints_use*2:,} rows × "
          f"{n_players * 2 + n_context} features"
          + (" (season-weighted)" if has_season_weight else ""))
    print(f"  Shift diagnostics: players={n_players:,}  stints={n_stints_use:,}  "
          f"mean_shift={shift_lengths.mean():.2f}s  median_shift={shift_lengths.median():.2f}s")

    r_idx, c_idx, vals = [], [], []
    y       = np.zeros(n_stints_use * 2)
    weights = np.zeros(n_stints_use * 2)
    off_offset = 0
    def_offset = n_players
    ctx_offset = n_players * 2

    for i, (_, stint) in enumerate(stints_df.iterrows()):
        dur    = float(stint['duration_seconds'])
        dur_h  = dur / 3600.0
        seas_w = float(stint['season_weight']) if has_season_weight else 1.0
        w      = max(dur, 1.0) * seas_w

        hxg = float(stint['home_xg']) / dur_h
        axg = float(stint['away_xg']) / dur_h

        h_pids = [int(p) for p in str(stint['home_players']).split('|') if p.strip()]
        a_pids = [int(p) for p in str(stint['away_players']).split('|') if p.strip()]

        home_row = i * 2
        away_row = home_row + 1
        home_score_state = max(-2.0, min(2.0, float(stint.get('home_score_diff', 0) or 0)))
        away_score_state = -home_score_state
        period = int(stint.get('period', 0) or 0)

        h_pp_exp = float(stint.get('home_pp_expiry', 0) or 0)
        a_pp_exp = float(stint.get('away_pp_expiry', 0) or 0)
        h_ozs    = float(stint.get('home_ozs',       0) or 0)
        a_ozs    = float(stint.get('away_ozs',       0) or 0)
        nzs_val  = float(stint.get('nzs',            0) or 0)
        h_btb    = float(stint.get('home_btb',       0) or 0)
        a_btb    = float(stint.get('away_btb',       0) or 0)

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

        for row_idx, is_home_attack, score_state, off_pp_exp, def_pp_exp, off_ozs, def_ozs, off_btb, def_btb in (
            (home_row, 1.0, home_score_state, h_pp_exp, a_pp_exp, h_ozs, a_ozs, h_btb, a_btb),
            (away_row, 0.0, away_score_state, a_pp_exp, h_pp_exp, a_ozs, h_ozs, a_btb, h_btb),
        ):
            ctx_vals = [
                is_home_attack,
                score_state,
                abs(score_state),
                1.0 if period == 2 else 0.0,
                1.0 if period == 3 else 0.0,
                off_pp_exp, def_pp_exp,
                off_ozs, def_ozs, nzs_val,
                off_btb, def_btb,
            ]
            for ctx_col, ctx_val in enumerate(ctx_vals):
                if ctx_val == 0.0:
                    continue
                r_idx.append(row_idx)
                c_idx.append(ctx_offset + ctx_col)
                vals.append(ctx_val)

        if priors:
            h_off = sum(priors.get(pid, {}).get('off', 0.0) for pid in h_pids)
            a_off = sum(priors.get(pid, {}).get('off', 0.0) for pid in a_pids)
            h_def = sum(priors.get(pid, {}).get('def', 0.0) for pid in h_pids)
            a_def = sum(priors.get(pid, {}).get('def', 0.0) for pid in a_pids)
        else:
            h_off = a_off = h_def = a_def = 0.0

        y[home_row] = hxg - h_off - a_def
        y[away_row] = axg - a_off - h_def
        weights[home_row] = w
        weights[away_row] = w

    X = sparse.csr_matrix(
        (vals, (r_idx, c_idx)),
        shape=(n_stints_use * 2, n_players * 2 + n_context)
    )

    alphas = [500.0, 1000.0, 2000.0, 5000.0, 10000.0, 20000.0, 50000.0, 100000.0]

    # Asymmetric alpha: scale offense columns by k before regression so their effective
    # L2 penalty is alpha/k² (less regularization on the offense block).
    # After fitting, multiply offense coefficients by k to recover the original scale.
    # ── DEBUG: target variable and weight diagnostics ─────────────────────────
    _nonzero_y = y[y != 0.0]
    _pct_zeros = 100.0 * (y == 0.0).mean()
    print(f"  TARGET (y) diagnostics:")
    print(f"    n_rows={len(y):,}  n_nonzero={len(_nonzero_y):,}  pct_zero={_pct_zeros:.1f}%")
    print(f"    mean={y.mean():.4f}  std={y.std():.4f}  "
          f"min={y.min():.4f}  max={y.max():.4f}")
    if len(_nonzero_y) > 0:
        print(f"    nonzero mean={_nonzero_y.mean():.4f}  "
              f"nonzero std={_nonzero_y.std():.4f}  "
              f"nonzero median={float(np.median(_nonzero_y)):.4f}")
    print(f"  WEIGHTS diagnostics:")
    print(f"    mean={weights.mean():.1f}  std={weights.std():.1f}  "
          f"min={weights.min():.1f}  max={weights.max():.1f}")
    print(f"    (weights = stint_duration_seconds × season_weight, 2 rows per stint)")
    # ── END DEBUG ─────────────────────────────────────────────────────────────

    if asymmetric_k != 1.0:
        col_scale = np.ones(n_players * 2 + n_context)
        col_scale[:n_players] = asymmetric_k
        X_fit = X.dot(sparse.diags(col_scale))
        print(f"  Asymmetric alpha: offense columns scaled by k={asymmetric_k:.2f} "
              f"(effective off L2 penalty ≈ alpha/{asymmetric_k**2:.2f}×  "
              f"→ less regularization on offense block)")
    else:
        X_fit = X

    print("Fitting joint offense/defense RAPM (shift-level) (RidgeCV)...")
    model = RidgeCV(alphas=alphas, fit_intercept=True)
    model.fit(X_fit, y, sample_weight=weights)
    print(f"  Best alpha: {model.alpha_}")
    if float(model.alpha_) >= max(alphas):
        print("  Warning: selected alpha is still at the top of the EV grid (search range may still be too low)")

    coef = model.coef_
    if asymmetric_k != 1.0:
        # Recover original-scale offense coefficients: β_actual = k × β_scaled
        rapm_off = coef[:n_players] * asymmetric_k
    else:
        rapm_off = coef[:n_players].copy()
    rapm_def = -coef[n_players:n_players * 2].copy()  # lower xGA allowed = better defense

    # Fix 4: hard cap before adding priors back — clips regression blow-up artifacts
    n_clipped = int(((rapm_off > MAX_RAPM) | (rapm_off < -MAX_RAPM) |
                     (rapm_def > MAX_RAPM) | (rapm_def < -MAX_RAPM)).sum())
    if n_clipped:
        print(f"  Hard cap ±{MAX_RAPM}: clipping {n_clipped} player coefficient(s)")
    rapm_off = np.clip(rapm_off, -MAX_RAPM, MAX_RAPM)
    rapm_def = np.clip(rapm_def, -MAX_RAPM, MAX_RAPM)

    # Add priors back to recover final RAPM estimates
    if priors:
        for i, pid in enumerate(all_pids):
            p = priors.get(pid, {})
            rapm_off[i] += p.get('off', 0.0)
            rapm_def[i] += p.get('def', 0.0)

    # Print context (including dummy-variable) coefficients
    ctx_coef = coef[n_players * 2:]
    print("  Context / dummy-variable coefficients:")
    for cf_name, cf_val in zip(context_features, ctx_coef):
        print(f"    {cf_name:<22}: {cf_val:+.6f}")

    # Fix 5: per-season diagnostics
    print(f"  Diagnostics ({len(all_pids)} players in matrix):")
    print(f"    Off: mean={rapm_off.mean():.4f} std={rapm_off.std():.4f} "
          f"min={rapm_off.min():.4f} max={rapm_off.max():.4f}")
    print(f"    Def: mean={rapm_def.mean():.4f} std={rapm_def.std():.4f} "
          f"min={rapm_def.min():.4f} max={rapm_def.max():.4f}")
    if rapm_off.std() > 0.5:
        print(f"  ⚠  rapm_off std={rapm_off.std():.4f} > 0.5 — possible collinearity inflation")
    top15_idx = np.argsort(rapm_off)[-15:][::-1]
    top15_str = ", ".join(
        f"pid{all_pids[i]}={rapm_off[i]:.3f}" + (" (MC)" if all_pids[i] == MCDAVID_ID else "")
        for i in top15_idx
    )
    print(f"  Top 15 rapm_off: {top15_str}")
    top10_def_idx = np.argsort(rapm_def)[-10:][::-1]
    bottom10_def_idx = np.argsort(rapm_def)[:10]
    print("  Top 10 rapm_def: " + ", ".join(
        f"pid{all_pids[i]}={rapm_def[i]:.3f}" + (" (MC)" if all_pids[i] == MCDAVID_ID else "")
        for i in top10_def_idx
    ))
    print("  Bottom 10 rapm_def: " + ", ".join(
        f"pid{all_pids[i]}={rapm_def[i]:.3f}" + (" (MC)" if all_pids[i] == MCDAVID_ID else "")
        for i in bottom10_def_idx
    ))
    mc_i = pid_idx.get(MCDAVID_ID)
    if mc_i is not None:
        print(f"  McDavid: toi={float(player_toi_sec.get(MCDAVID_ID, 0)) / 60:.1f}min "
              f"rapm_off={rapm_off[mc_i]:.4f} rapm_def={rapm_def[mc_i]:.4f}")
    else:
        print(f"  McDavid: not in regression matrix")

    results = pd.DataFrame({
        'player_id':     all_pids,
        'rapm_off':      rapm_off,
        'rapm_def':      rapm_def,
        'toi_5v5_total': [round(float(player_toi_sec.get(p, 0)) / 60.0, 1) for p in all_pids],
    })
    results['rapm_off_pct'] = results['rapm_off'].rank(pct=True) * 100
    results['rapm_def_pct'] = results['rapm_def'].rank(pct=True) * 100

    # Add excluded players (< 300 min) back.  When priors are available, use a
    # sample-size-shrunk prior instead of hard zero so mid-season callups and
    # low-minute players get a reasonable estimate instead of league-average.
    if excluded_pids:
        excl_rows = []
        for p in sorted(excluded_pids):
            toi_min = float(player_toi_sec.get(p, 0)) / 60.0
            shrink = min(toi_min / 300.0, 1.0)
            if priors and p in priors:
                off_val = priors[p].get('off', 0.0) * shrink
                def_val = priors[p].get('def', 0.0) * shrink
            else:
                off_val = def_val = 0.0
            excl_rows.append({
                'player_id':     p,
                'rapm_off':      off_val,
                'rapm_def':      def_val,
                'toi_5v5_total': round(toi_min, 1),
            })
        excl_df = pd.DataFrame(excl_rows)
        results = pd.concat([results, excl_df], ignore_index=True)
        results['rapm_off_pct'] = results['rapm_off'].rank(pct=True) * 100
        results['rapm_def_pct'] = results['rapm_def'].rank(pct=True) * 100

    return results


# ── PP/PK RAPM regression ──────────────────────────────────────────────────────
def build_pp_rapm(pp_stints_df, priors=None):
    """
    Fit PP RAPM.  Each PP/PK stint contributes ONE observation from the PP
    team's perspective.

    Target  : xGF/60 for the PP team per stint (higher = better PP player).
    Features: indicator variables for each PP skater + period/score context.
    priors  : {player_id: {'pp': float}}  (Bayesian chain prior, same
              asymmetric decay as EV RAPM).

    Returns DataFrame: player_id, pp_rapm, toi_pp_total.
    """
    df = pp_stints_df[pp_stints_df['strength_state'].isin(PP_PK_ALL_STATES)].copy()
    df = df[df['duration_seconds'] >= 10].copy()
    if len(df) == 0:
        print("  No PP stints to fit")
        return pd.DataFrame(columns=['player_id', 'pp_rapm', 'toi_pp_total'])

    # Build per-record view: one row per stint, from PP team's perspective
    pp_records = []
    for _, stint in df.iterrows():
        ss = stint['strength_state']
        if ss in PP_HOME_STATES:
            pp_pids = [int(p) for p in str(stint['home_players']).split('|') if p.strip()]
            pp_xg   = float(stint['home_xg'])
        else:
            pp_pids = [int(p) for p in str(stint['away_players']).split('|') if p.strip()]
            pp_xg   = float(stint['away_xg'])
        pp_records.append({
            'pp_pids':          pp_pids,
            'pp_xg':            pp_xg,
            'duration_seconds': float(stint['duration_seconds']),
            'period':           int(stint.get('period', 1) or 1),
            'score_diff_pp':    int(stint.get('home_score_diff', 0))
                                    if ss in PP_HOME_STATES
                                    else -int(stint.get('home_score_diff', 0)),
        })

    # Per-player PP TOI
    pp_toi_sec = defaultdict(float)
    for rec in pp_records:
        for pid in rec['pp_pids']:
            pp_toi_sec[pid] += rec['duration_seconds']

    included = sorted(p for p in pp_toi_sec if pp_toi_sec[p] >= MIN_PP_REGRESSION_TOI_SEC)
    excluded = {p for p in pp_toi_sec if p not in included}
    if not included:
        print("  No PP players meet 100-min threshold")
        return pd.DataFrame(columns=['player_id', 'pp_rapm', 'toi_pp_total'])

    pid_idx   = {p: i for i, p in enumerate(included)}
    n_players = len(included)
    n_ctx     = 3   # period_2, period_3, score_diff_pp

    r_idx, c_idx, vals = [], [], []
    y       = np.zeros(len(pp_records))
    weights = np.zeros(len(pp_records))

    for row_i, rec in enumerate(pp_records):
        dur   = rec['duration_seconds']
        dur_h = dur / 3600.0
        w     = math.sqrt(dur)
        prior_sum = (sum(priors.get(pid, {}).get('pp', 0.0) for pid in rec['pp_pids'])
                     if priors else 0.0)
        y[row_i]       = rec['pp_xg'] / dur_h - prior_sum
        weights[row_i] = w
        for pid in rec['pp_pids']:
            if pid in pid_idx:
                r_idx.append(row_i)
                c_idx.append(pid_idx[pid])
                vals.append(1.0)
        period     = rec['period']
        score_diff = max(-2.0, min(2.0, float(rec['score_diff_pp'])))
        if period == 2:
            r_idx.append(row_i); c_idx.append(n_players);     vals.append(1.0)
        elif period == 3:
            r_idx.append(row_i); c_idx.append(n_players + 1); vals.append(1.0)
        if score_diff != 0.0:
            r_idx.append(row_i); c_idx.append(n_players + 2); vals.append(score_diff)

    X      = sparse.csr_matrix((vals, (r_idx, c_idx)),
                               shape=(len(pp_records), n_players + n_ctx))
    alphas = [10.0, 50.0, 100.0, 500.0, 1000.0, 2000.0, 5000.0, 10000.0]
    print(f"  Fitting PP RAPM: {len(pp_records):,} stints × {n_players} PP players ...")
    model = RidgeCV(alphas=alphas, fit_intercept=True)
    model.fit(X, y, sample_weight=weights)
    print(f"  Best PP alpha: {model.alpha_}")

    pp_rapm = model.coef_[:n_players].copy()
    if priors:
        for i, pid in enumerate(included):
            pp_rapm[i] += priors.get(pid, {}).get('pp', 0.0)

    results = pd.DataFrame({
        'player_id':    included,
        'pp_rapm':      pp_rapm,
        'toi_pp_total': [round(float(pp_toi_sec.get(p, 0)) / 60.0, 1) for p in included],
    })

    if excluded:
        excl_rows = []
        for p in sorted(excluded):
            toi_min = float(pp_toi_sec.get(p, 0)) / 60.0
            shrink  = min(toi_min / (MIN_PP_REGRESSION_TOI_SEC / 60.0), 1.0)
            excl_rows.append({
                'player_id':    p,
                'pp_rapm':      priors.get(p, {}).get('pp', 0.0) * shrink if priors else 0.0,
                'toi_pp_total': round(toi_min, 1),
            })
        results = pd.concat([results, pd.DataFrame(excl_rows)], ignore_index=True)

    print(f"  PP RAPM: mean={results['pp_rapm'].mean():.4f}  "
          f"std={results['pp_rapm'].std():.4f}  "
          f"min={results['pp_rapm'].min():.4f}  max={results['pp_rapm'].max():.4f}")
    return results


def build_pk_rapm(pp_stints_df, priors=None):
    """
    Fit PK RAPM.  Uses the same PP/PK stints as build_pp_rapm but from the
    PK team's perspective.

    Target  : xGA/60 for the PK team per stint (= PP team's xGF/60).
              Lower coefficient → better PK player (suppresses more xGA).
              pk_rapm stored WITHOUT sign flip — lower is better.
    priors  : {player_id: {'pk': float}}

    Returns DataFrame: player_id, pk_rapm, toi_pk_total.
    """
    df = pp_stints_df[pp_stints_df['strength_state'].isin(PP_PK_ALL_STATES)].copy()
    df = df[df['duration_seconds'] >= 10].copy()
    if len(df) == 0:
        return pd.DataFrame(columns=['player_id', 'pk_rapm', 'toi_pk_total'])

    pk_records = []
    for _, stint in df.iterrows():
        ss = stint['strength_state']
        if ss in PP_HOME_STATES:
            # home on PP → away on PK; PK team's xGA = home team's xGF
            pk_pids = [int(p) for p in str(stint['away_players']).split('|') if p.strip()]
            pk_xga  = float(stint['home_xg'])
        else:
            pk_pids = [int(p) for p in str(stint['home_players']).split('|') if p.strip()]
            pk_xga  = float(stint['away_xg'])
        pk_records.append({
            'pk_pids':          pk_pids,
            'pk_xga':           pk_xga,
            'duration_seconds': float(stint['duration_seconds']),
            'period':           int(stint.get('period', 1) or 1),
        })

    pk_toi_sec = defaultdict(float)
    for rec in pk_records:
        for pid in rec['pk_pids']:
            pk_toi_sec[pid] += rec['duration_seconds']

    included = sorted(p for p in pk_toi_sec if pk_toi_sec[p] >= MIN_PK_REGRESSION_TOI_SEC)
    excluded = {p for p in pk_toi_sec if p not in included}
    if not included:
        print("  No PK players meet 100-min threshold")
        return pd.DataFrame(columns=['player_id', 'pk_rapm', 'toi_pk_total'])

    pid_idx   = {p: i for i, p in enumerate(included)}
    n_players = len(included)
    n_ctx     = 2   # period_2, period_3

    r_idx, c_idx, vals = [], [], []
    y       = np.zeros(len(pk_records))
    weights = np.zeros(len(pk_records))

    for row_i, rec in enumerate(pk_records):
        dur   = rec['duration_seconds']
        dur_h = dur / 3600.0
        w     = math.sqrt(dur)
        prior_sum = (sum(priors.get(pid, {}).get('pk', 0.0) for pid in rec['pk_pids'])
                     if priors else 0.0)
        y[row_i]       = rec['pk_xga'] / dur_h - prior_sum
        weights[row_i] = w
        for pid in rec['pk_pids']:
            if pid in pid_idx:
                r_idx.append(row_i)
                c_idx.append(pid_idx[pid])
                vals.append(1.0)
        period = rec['period']
        if period == 2:
            r_idx.append(row_i); c_idx.append(n_players);     vals.append(1.0)
        elif period == 3:
            r_idx.append(row_i); c_idx.append(n_players + 1); vals.append(1.0)

    X      = sparse.csr_matrix((vals, (r_idx, c_idx)),
                               shape=(len(pk_records), n_players + n_ctx))
    alphas = [10.0, 50.0, 100.0, 500.0, 1000.0, 2000.0, 5000.0, 10000.0]
    print(f"  Fitting PK RAPM: {len(pk_records):,} stints × {n_players} PK players ...")
    model = RidgeCV(alphas=alphas, fit_intercept=True)
    model.fit(X, y, sample_weight=weights)
    print(f"  Best PK alpha: {model.alpha_}")

    pk_rapm = model.coef_[:n_players].copy()   # NOT negated — lower = better
    if priors:
        for i, pid in enumerate(included):
            pk_rapm[i] += priors.get(pid, {}).get('pk', 0.0)

    results = pd.DataFrame({
        'player_id':    included,
        'pk_rapm':      pk_rapm,
        'toi_pk_total': [round(float(pk_toi_sec.get(p, 0)) / 60.0, 1) for p in included],
    })

    if excluded:
        excl_rows = []
        for p in sorted(excluded):
            toi_min = float(pk_toi_sec.get(p, 0)) / 60.0
            shrink  = min(toi_min / (MIN_PK_REGRESSION_TOI_SEC / 60.0), 1.0)
            excl_rows.append({
                'player_id':    p,
                'pk_rapm':      priors.get(p, {}).get('pk', 0.0) * shrink if priors else 0.0,
                'toi_pk_total': round(toi_min, 1),
            })
        results = pd.concat([results, pd.DataFrame(excl_rows)], ignore_index=True)

    print(f"  PK RAPM: mean={results['pk_rapm'].mean():.4f}  "
          f"std={results['pk_rapm'].std():.4f}  "
          f"min={results['pk_rapm'].min():.4f}  max={results['pk_rapm'].max():.4f}")
    return results


def run_prior_informed_pp_pk_rapm(pp_stints_by_season):
    """
    Daisy-chain PP and PK RAPM across all available seasons (oldest first).
    Each season's output becomes the prior for the next season via the same
    asymmetric decay as EV RAPM:
      PP: off_prior = 0.008151 + prev × 0.446297
      PK: def_prior = -0.003181 + prev × 0.280373

    Returns {season_key: {'pp': pp_results_df, 'pk': pk_results_df}}
    """
    seasons_in_order = sorted(
        pp_stints_by_season.keys(), key=lambda s: int(s.split('-')[0])
    )
    pp_prev = {}   # {player_id: pp_rapm float}
    pk_prev = {}   # {player_id: pk_rapm float}
    all_results = {}

    for season in seasons_in_order:
        stints = pp_stints_by_season[season]
        n = len(stints)
        print(f"\n  {season}: {n:,} PP/PK stints")

        if n == 0:
            all_results[season] = {
                'pp': pd.DataFrame(columns=['player_id', 'pp_rapm', 'toi_pp_total']),
                'pk': pd.DataFrame(columns=['player_id', 'pk_rapm', 'toi_pk_total']),
            }
            continue

        # Build priors from previous season using asymmetric decay
        pp_priors = {pid: {'pp': 0.008151 + prev * 0.446297}
                     for pid, prev in pp_prev.items()}
        pk_priors = {pid: {'pk': -0.003181 + prev * 0.280373}
                     for pid, prev in pk_prev.items()}
        n_pp_prior = sum(1 for p in pp_priors.values() if abs(p['pp']) > 0.001)
        n_pk_prior = sum(1 for p in pk_priors.values() if abs(p['pk']) > 0.001)
        print(f"    PP priors: {n_pp_prior} non-zero | PK priors: {n_pk_prior} non-zero")

        pp_results = build_pp_rapm(stints, priors=pp_priors)
        pk_results = build_pk_rapm(stints, priors=pk_priors)
        all_results[season] = {'pp': pp_results, 'pk': pk_results}

        # Feed forward
        pp_prev = {int(row.player_id): float(row.pp_rapm)
                   for row in pp_results.itertuples() if pd.notna(row.pp_rapm)}
        pk_prev = {int(row.player_id): float(row.pk_rapm)
                   for row in pk_results.itertuples() if pd.notna(row.pk_rapm)}
        print(f"  {season}: PP {len(pp_results)} players | PK {len(pk_results)} players")

    return all_results


def upload_season_pp_pk_rapm(season_key, pp_results_df, pk_results_df):
    """Upload pp_rapm and pk_rapm to player_seasons for one season."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    print("  SQL migrations (run once in Supabase editor if columns don't exist):")
    print("    alter table player_seasons add column if not exists pp_rapm float8;")
    print("    alter table player_seasons add column if not exists pk_rapm float8;")

    sb       = create_client(SUPABASE_URL, SUPABASE_KEY)
    existing = {
        (r['player_id'], r['season'])
        for r in sb.table('player_seasons')
                    .select('player_id,season')
                    .eq('season', season_key)
                    .execute().data
    }
    pp_lookup = {int(row.player_id): round(float(row.pp_rapm), 4)
                 for row in pp_results_df.itertuples() if pd.notna(row.pp_rapm)}
    pk_lookup = {int(row.player_id): round(float(row.pk_rapm), 4)
                 for row in pk_results_df.itertuples() if pd.notna(row.pk_rapm)}
    all_pids  = set(pp_lookup) | set(pk_lookup)
    updated   = 0
    missing   = 0
    for pid in all_pids:
        if (pid, season_key) not in existing:
            missing += 1
            continue
        data = {}
        if pid in pp_lookup:
            data['pp_rapm'] = pp_lookup[pid]
        if pid in pk_lookup:
            data['pk_rapm'] = pk_lookup[pid]
        if not data:
            continue
        result = (sb.table('player_seasons')
                    .update(data)
                    .eq('player_id', pid)
                    .eq('season', season_key)
                    .execute())
        if result.data:
            updated += 1
    print(f"  Uploaded PP/PK RAPM for {season_key}: {updated} rows (missing: {missing})")


def print_pp_pk_leaderboards(pp_stints_by_season):
    """Print top-10 PP and PK RAPM leaders for the 3 card seasons."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    try:
        _sb   = create_client(SUPABASE_URL, SUPABASE_KEY)
        info  = {r['player_id']: r for r in
                 _sb.table('players').select('player_id,full_name,position').execute().data}
    except Exception as e:
        print(f"  PP/PK leaderboard name lookup failed: {e}")
        return

    # Aggregate PP/PK RAPM across 3 card seasons using CARD_SEASON_WEIGHTS
    pp_agg = defaultdict(lambda: {'num': 0.0, 'den': 0.0})
    pk_agg = defaultdict(lambda: {'num': 0.0, 'den': 0.0})
    for season_key, res in pp_stints_by_season.items():
        w = CARD_SEASON_WEIGHTS.get(season_key, 0.0)
        if w == 0.0:
            continue
        pp_df = res.get('pp', pd.DataFrame())
        pk_df = res.get('pk', pd.DataFrame())
        if not pp_df.empty:
            for row in pp_df.itertuples():
                if pd.notna(row.pp_rapm) and row.toi_pp_total >= 50:
                    pp_agg[int(row.player_id)]['num'] += w * float(row.pp_rapm)
                    pp_agg[int(row.player_id)]['den'] += w
        if not pk_df.empty:
            for row in pk_df.itertuples():
                if pd.notna(row.pk_rapm) and row.toi_pk_total >= 50:
                    pk_agg[int(row.player_id)]['num'] += w * float(row.pk_rapm)
                    pk_agg[int(row.player_id)]['den'] += w

    pp_weighted = {pid: d['num'] / d['den'] for pid, d in pp_agg.items() if d['den'] > 0}
    pk_weighted = {pid: d['num'] / d['den'] for pid, d in pk_agg.items() if d['den'] > 0}

    def _fmt_leader(pid, val):
        p     = info.get(pid, {})
        name  = p.get('full_name', str(pid))
        pos   = p.get('position', '?')
        return f"  {name:<26} {pos:>3}  {val:+.4f}"

    print("\n--- TOP 10 PP RAPM (3-yr weighted, ≥50 PP min) ---")
    for pid, val in sorted(pp_weighted.items(), key=lambda x: -x[1])[:10]:
        print(_fmt_leader(pid, val))

    print("\n--- TOP 10 PK RAPM (3-yr weighted, ≥50 PK min; lower=better) ---")
    for pid, val in sorted(pk_weighted.items(), key=lambda x: x[1])[:10]:
        print(_fmt_leader(pid, val))

    # Jackson LaCombe spotlight
    lacombe_id = next((pid for pid, p in info.items()
                       if p.get('full_name') == 'Jackson LaCombe'), None)
    if lacombe_id:
        pp_v = pp_weighted.get(lacombe_id)
        pk_v = pk_weighted.get(lacombe_id)
        print(f"\n--- JACKSON LaCOMBE PP/PK RAPM ---")
        print(f"  pp_rapm (3yr weighted): {pp_v:+.4f}" if pp_v is not None else "  pp_rapm: N/A")
        print(f"  pk_rapm (3yr weighted): {pk_v:+.4f}" if pk_v is not None else "  pk_rapm: N/A")


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
    abs(rapm_off) > MAX_RAPM or abs(rapm_def) > MAX_RAPM.
    These values are physically impossible and indicate small-sample regression blow-up.
    """
    rows = sb.table('players').select('player_id,rapm_off,rapm_def').execute().data
    to_null = [
        r['player_id'] for r in rows
        if (r.get('rapm_off') is not None and abs(float(r['rapm_off'])) > MAX_RAPM)
        or (r.get('rapm_def') is not None and abs(float(r['rapm_def'])) > MAX_RAPM)
    ]
    if not to_null:
        print(f"  No impossible RAPM values found (all abs() ≤ {MAX_RAPM})")
        return
    print(f"  Nulling out {len(to_null)} players with |RAPM| > {MAX_RAPM}...")
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
    info: dict = {}
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            sb   = create_client(SUPABASE_URL, SUPABASE_KEY)
            info = {p['player_id']: p for p in
                    sb.table('players').select('player_id,full_name,position').execute().data}
        except Exception as e:
            print(f"  Warning: could not fetch player names: {e}")

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
        'Connor McDavid':    name_to_pid.get('Connor McDavid',    MCDAVID_ID),
        'Leon Draisaitl':    name_to_pid.get('Leon Draisaitl',    DRAISAITL_ID),
        'Nathan MacKinnon':  name_to_pid.get('Nathan MacKinnon',  0),
        'Nikita Kucherov':   name_to_pid.get('Nikita Kucherov',   0),
        'Sidney Crosby':     name_to_pid.get('Sidney Crosby',     0),
        'Alex Ovechkin':     name_to_pid.get('Alex Ovechkin',     0),
        'Matthew Knies':     name_to_pid.get('Matthew Knies',     0),
        'William Nylander':  name_to_pid.get('William Nylander',  0),
        'Brandon Hagel':     name_to_pid.get('Brandon Hagel',     0),
        'Macklin Celebrini': name_to_pid.get('Macklin Celebrini', 0),
        'Matthew Schaefer':  name_to_pid.get('Matthew Schaefer',  0),
        'John Hayden':       name_to_pid.get('John Hayden',       0),
        'Darren Raddysh':    name_to_pid.get('Darren Raddysh',    0),
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
    Quality gate (prior-informed RAPM):
      - McDavid rapm_off_pct > 90th
      - Draisaitl rapm_off_pct >= 59.5th
      - Knies rapm_off_pct > 25th (collinearity fix check)
      - No high-TOI player (≥500 min) below 2nd percentile
    """
    # ── Min-TOI filter: remove small-sample / fringe-player noise ────────────
    # 400 projected-min threshold (vs 200 per-season threshold in filter_qualified_results).
    # Projected TOI = weighted sum(season_toi × season_weight), so 400 requires substantial
    # multi-season presence — a 25-26-only player needs ~800 actual 5v5 min to pass.
    # Prevents fringe players with lucky 200-300 min stretches (Kindel, Samoskevich etc.)
    # from appearing above established stars in the card percentile rankings.
    MIN_TOI_MINUTES = 400
    n_before = len(results_df)
    results_df = results_df[results_df['toi_5v5_total'] >= MIN_TOI_MINUTES].copy()
    n_after = len(results_df)
    print(f"\nMin-TOI filter (≥{MIN_TOI_MINUTES} projected min): {n_before} → {n_after} players "
          f"(removed {n_before - n_after} low-sample / fringe players)")

    # Recompute percentile ranks within the filtered qualified set
    results_df['rapm_off_pct'] = results_df['rapm_off'].rank(pct=True) * 100
    results_df['rapm_def_pct'] = results_df['rapm_def'].rank(pct=True) * 100

    # Drop remaining impossible values (physically unreachable regardless of sample size)
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

    # ── Extended Bayesian quality checks ──────────────────────────────────────
    rapm_std = results_df['rapm_off'].std()
    high_toi = results_df[results_df['toi_5v5_total'] >= 500]
    outlier_count = (high_toi['rapm_off_pct'] < 2.0).sum() if not high_toi.empty else 0

    # Name-based lookups (Knies, Nylander, Celebrini, Schaefer)
    knies_pct = nylander_pct = celebrini_pct = schaefer_pct = None
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            sb_lookup = create_client(SUPABASE_URL, SUPABASE_KEY)
            pinfo = {r['full_name']: r['player_id'] for r in
                     sb_lookup.table('players').select('player_id,full_name').execute().data}
            def _pct(name):
                pid = pinfo.get(name)
                if not pid:
                    return None
                row = results_df[results_df['player_id'] == pid]
                return float(row['rapm_off_pct'].values[0]) if len(row) else None
            knies_pct    = _pct('Matthew Knies')
            nylander_pct = _pct('William Nylander')
            celebrini_pct = _pct('Macklin Celebrini')
            schaefer_pct = _pct('Matthew Schaefer')
        except Exception as e:
            print(f"  Warning: name lookup failed: {e}")

    print(f"\nQuality gate (prior-informed RAPM):")
    print(f"  McDavid     rapm_off_pct: {mc_pct:.1f}  {'✓' if mc_pct > 90 else '✗'}  (need >90)")
    print(f"  Draisaitl   rapm_off_pct: {dr_pct:.1f}  {'✓' if dr_pct >= 59.5 else '✗'}  (need >=59.5)")
    if knies_pct is not None:
        print(f"  Knies       rapm_off_pct: {knies_pct:.1f}  {'✓' if knies_pct > 25 else '✗'}  (need >25, fixing collinearity)")
    if nylander_pct is not None:
        print(f"  Nylander    rapm_off_pct: {nylander_pct:.1f}  (informational — should be top-6 range)")
    if celebrini_pct is not None:
        print(f"  Celebrini   rapm_off_pct: {celebrini_pct:.1f}  (informational — rookie)")
    if schaefer_pct is not None:
        print(f"  Schaefer    rapm_off_pct: {schaefer_pct:.1f}  (informational — rookie D)")
    print(f"  rapm_off std dev: {rapm_std:.4f}  (lower = less collinearity noise)")
    print(f"  High-TOI (≥500 min) players below 2nd pct: {outlier_count}  {'✓' if outlier_count <= 10 else '⚠'}")
    if outlier_count > 0:
        outlier_rows = high_toi[high_toi['rapm_off_pct'] < 2.0].sort_values('rapm_off_pct')
        print("  Outlier player_ids (high-TOI, low rapm_off_pct):")
        for _, row in outlier_rows.iterrows():
            print(f"    pid={int(row['player_id'])}  toi={row['toi_5v5_total']:.0f}min"
                  f"  rapm_off={row['rapm_off']:.3f}  pct={row['rapm_off_pct']:.1f}")

    knies_ok = (knies_pct is None) or (knies_pct > 25)
    # Allow ≤10 high-TOI outliers: 2% of ~500 qualified players = ~10 expected below 2nd pct
    # by definition. These are typically legitimate depth/stay-at-home defensemen
    # (Edmundson, Chiarot, Lindgren, etc.) whose offensive RAPM is correctly low.
    gate_passed = mc_pct > 90 and dr_pct >= 59.5 and knies_ok and outlier_count <= 10

    if gate_passed:
        print("\n✓ All conditions met — uploading projected 3-year RAPM card to Supabase")
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
        if mc_pct <= 90:
            print(f"  McDavid at {mc_pct:.1f}th pct — prior-informed RAPM should have him >90th")
        if knies_pct is not None and knies_pct <= 25:
            print(f"  Knies at {knies_pct:.1f}th pct — collinearity still inflating Toronto linemates")
        if outlier_count > 0:
            print(f"  {outlier_count} high-TOI players below 2nd pct — investigate outliers")
        if SUPABASE_URL and SUPABASE_KEY:
            sb = create_client(SUPABASE_URL, SUPABASE_KEY)
            null_impossible_rapm(sb)
        print_leaderboards(results_df)
        return False


# ── Comparison helpers ────────────────────────────────────────────────────────
def fetch_old_rapm():
    """
    Fetch current rapm_off_pct / rapm_def_pct from Supabase before running
    the new 8-season pipeline.  Returns dict keyed by full_name.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {}
    try:
        sb = create_client(SUPABASE_URL, SUPABASE_KEY)
        rows = sb.table('players').select(
            'player_id,full_name,rapm_off,rapm_off_pct,rapm_def,rapm_def_pct'
        ).execute().data
        return {r['full_name']: r for r in rows if r.get('rapm_off_pct') is not None}
    except Exception as e:
        print(f"  Warning: could not fetch old RAPM for comparison: {e}")
        return {}


def print_comparison_table(new_results_df, old_rapm_lookup):
    """
    Print old (3-season) vs new (8-season) RAPM percentiles for key players.
    Runs before the quality gate so the user can review before any upload.
    """
    COMPARE_PLAYERS = [
        'Connor McDavid', 'Nathan MacKinnon', 'Nikita Kucherov',
        'Leon Draisaitl', 'Sidney Crosby', 'Alex Ovechkin',
        'Matthew Knies', 'William Nylander',
        'John Hayden', 'Darren Raddysh',   # one-season wonders to watch
    ]
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    try:
        sb = create_client(SUPABASE_URL, SUPABASE_KEY)
        name_map = {r['full_name']: r['player_id'] for r in
                    sb.table('players').select('player_id,full_name').execute().data}
    except Exception as e:
        print(f"  Comparison table: name lookup failed ({e})")
        return

    print("\n" + "=" * 75)
    print("COMPARISON: 3-SEASON RAPM  →  8-SEASON RAPM (daisy chain)")
    print("=" * 75)
    hdr = (f"  {'Player':<22} {'Old off%':>8} {'Old def%':>8} "
           f"{'New off%':>8} {'New def%':>8} {'Δ off':>6} {'Δ def':>6}")
    sep = "  " + "-" * 73
    print(hdr)
    print(sep)

    for name in COMPARE_PLAYERS:
        pid = name_map.get(name)
        if not pid:
            print(f"  {name:<22}  (not in DB)")
            continue

        old = old_rapm_lookup.get(name, {})
        new_row = new_results_df[new_results_df['player_id'] == pid]

        old_off = old.get('rapm_off_pct')
        old_def = old.get('rapm_def_pct')
        new_off = float(new_row['rapm_off_pct'].values[0]) if len(new_row) else None
        new_def = float(new_row['rapm_def_pct'].values[0]) if len(new_row) else None

        def _f(v):
            return f"{v:>8.1f}" if v is not None else f"{'—':>8}"

        def _d(a, b):
            if a is None or b is None:
                return f"{'—':>6}"
            return f"{b - a:>+6.1f}"

        print(f"  {name:<22} {_f(old_off)} {_f(old_def)} "
              f"{_f(new_off)} {_f(new_def)} {_d(old_off, new_off)} {_d(old_def, new_def)}")

    print(sep)
    print("  Δ = new − old.  Positive = improved rank in new model.")
    print()


def _load_player_identity_maps():
    """
    Build player lookup maps from the local player cache so validation output
    does not depend on a live Supabase call.
    """
    if not os.path.exists(PLAYER_LOOKUP_FILE):
        return {}, {}, {}

    try:
        lookup = pd.read_csv(PLAYER_LOOKUP_FILE)
    except Exception as e:
        print(f"  Warning: could not read player lookup cache ({e})")
        return {}, {}, {}

    if lookup.empty or 'player_id' not in lookup.columns:
        return {}, {}, {}

    lookup = lookup.dropna(subset=['player_id']).copy()
    lookup['player_id'] = lookup['player_id'].astype(int)

    name_to_pid = {}
    pid_to_team = {}
    pid_to_pos = {}
    for row in lookup.itertuples():
        pid = int(row.player_id)
        full_name = getattr(row, 'full_name', None)
        if isinstance(full_name, str) and full_name.strip():
            name_to_pid[full_name.strip()] = pid
        pid_to_team[pid] = getattr(row, 'team', None)
        pid_to_pos[pid] = getattr(row, 'position', None)

    return name_to_pid, pid_to_team, pid_to_pos


def print_season_spotlight_summary(season_key, results_df, name_to_pid):
    """
    Print the season-level EV RAPM checkpoints we care about most during the run.
    """
    if results_df.empty:
        return

    spotlight_names = ['Jackson LaCombe', 'Connor McDavid']
    print(f"\n  Season EV RAPM spotlight — {season_key}")
    print(f"    {'Player':<18} {'rapm_off':>9} {'off_pct':>8} {'rapm_def':>9} {'def_pct':>8}")
    for name in spotlight_names:
        pid = name_to_pid.get(name)
        if not pid:
            print(f"    {name:<18} {'N/A':>9} {'N/A':>8} {'N/A':>9} {'N/A':>8}")
            continue
        row = results_df[results_df['player_id'] == pid]
        if row.empty:
            print(f"    {name:<18} {'N/Q':>9} {'N/Q':>8} {'N/Q':>9} {'N/Q':>8}")
            continue
        rec = row.iloc[0]
        print(f"    {name:<18} {rec['rapm_off']:>9.4f} {rec['rapm_off_pct']:>8.1f} "
              f"{rec['rapm_def']:>9.4f} {rec['rapm_def_pct']:>8.1f}")


def print_validation_summary(projected_df, old_rapm_lookup):
    """
    Print targeted validation checks after the shift-level EV RAPM rewrite:
      - McDavid rapm_def_pct (target >80)
      - LaCombe rapm_def_pct (target >30)
      - Anaheim D-men average rapm_def (should improve)
      - McDavid rapm_off_pct >90
    Also prints a small before/after table using old RAPM percentiles.
    """
    if projected_df.empty:
        return
    name_to_pid, pid_to_team, pid_to_pos = _load_player_identity_maps()
    if not name_to_pid:
        print("  Validation summary skipped — local player lookup unavailable")
        return

    def _pct_for(pid, col):
        row = projected_df[projected_df['player_id'] == pid]
        if row.empty:
            return None
        return float(row[col].values[0]) if col in row.columns else None

    mc_pid = name_to_pid.get('Connor McDavid')
    lac_pid = name_to_pid.get('Jackson LaCombe')

    mc_def_new = _pct_for(mc_pid, 'rapm_def_pct') if mc_pid else None
    lac_def_new = _pct_for(lac_pid, 'rapm_def_pct') if lac_pid else None
    mc_off_new = _pct_for(mc_pid, 'rapm_off_pct') if mc_pid else None

    mc_def_old = old_rapm_lookup.get('Connor McDavid', {}).get('rapm_def_pct')
    lac_def_old = old_rapm_lookup.get('Jackson LaCombe', {}).get('rapm_def_pct')

    ana_d_pids = [
        pid for pid, team in pid_to_team.items()
        if team == 'ANA' and pid_to_pos.get(pid) == 'D'
    ]
    ana_def_vals = projected_df[projected_df['player_id'].isin(ana_d_pids)]['rapm_def']
    ana_def_avg = float(ana_def_vals.mean()) if not ana_def_vals.empty else None

    print("\n" + "=" * 60)
    print("SHIFT-LEVEL EV RAPM VALIDATION")
    print("=" * 60)
    print("Metric          | Before | After")
    print("----------------+--------+-------")
    def _fmt(v):
        return f"{v:>6.1f}" if v is not None else f"{'—':>6}"
    print(f"McDavid EV Def  | {_fmt(mc_def_old)} | {_fmt(mc_def_new)}")
    print(f"LaCombe EV Def  | {_fmt(lac_def_old)} | {_fmt(lac_def_new)}")
    if ana_def_avg is not None:
        print(f"ANA avg def     | {'-0.165':>6} | {ana_def_avg:>6.3f}")
    else:
        print(f"ANA avg def     | {'-0.165':>6} | {'—':>6}")

    if mc_off_new is not None:
        status = "✓" if mc_off_new > 90 else "✗"
        print(f"\nQuality gate: McDavid rapm_off_pct > 90  {status}  ({mc_off_new:.1f})")
    print()


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 60)
    print(f"RAPM Pipeline — 8-season daisy chain  [TEST_MODE={TEST_MODE}]")
    print("  Seasons: 18-19 → 25-26  (card uses 23-24/24-25/25-26 only)")
    print("  Tip: delete a season's game_ids_XXXX.json to refresh its IDs.")
    print("=" * 60)

    # Report which stints files already exist vs need scraping
    print("\nStints file inventory:")
    for skey, scfg in SEASON_CONFIGS.items():
        exists = os.path.exists(scfg['stints_file'])
        ckpt   = os.path.exists(scfg['ckpt_file'])
        status = "✓ cached" if exists else ("⚡ checkpoint" if ckpt else "✗ need scrape")
        print(f"  {skey}: {status}  ({os.path.basename(scfg['stints_file'])})")

    # Fetch current (3-season) RAPM from Supabase before any changes
    print("\nFetching old (3-season) RAPM from Supabase for comparison...")
    old_rapm_lookup = fetch_old_rapm()
    print(f"  Saved {len(old_rapm_lookup)} player RAPM values for comparison")

    print("\nLoading clean 5v5 shot cache for card-season xG refresh...")
    shots_cache = _load_shots_cache()
    if not shots_cache.empty:
        shots_cache = _compute_xg_for_shots(shots_cache)
        print(f"  Shot cache ready: {len(shots_cache):,} Fenwick events across "
              f"{shots_cache['season'].nunique()} seasons")
    else:
        print("  Shot cache unavailable — keeping cached stint xG totals")

    experiment_name = RAPM_EXPERIMENT if RAPM_EXPERIMENT in SUPPORTED_RAPM_EXPERIMENTS else ""
    if RAPM_EXPERIMENT and not experiment_name:
        print(f"  Warning: unsupported RAPM_EXPERIMENT={RAPM_EXPERIMENT!r} — running baseline only.")

    # Steps 1+2: fetch game IDs and stints for all seasons
    season_dfs = {}
    experimental_season_dfs = {}
    events_by_season = {}
    game_ids_by_season = {}   # saved for Step 2d (dummy augmentation)

    # QUICK_TEST: run only the 3 card seasons to verify dummy variables
    seasons_to_run = (
        {k: v for k, v in SEASON_CONFIGS.items() if k in DUMMY_SEASONS}
        if QUICK_TEST else SEASON_CONFIGS
    )
    if QUICK_TEST:
        print("\n[QUICK_TEST] Processing only 23-24/24-25/25-26 — no daisy chain priors")

    for season_key, season_cfg in seasons_to_run.items():
        print(f"\n{'='*60}")
        print(f"Season {season_key}  (weight ×{season_cfg['weight']})")
        print(f"{'='*60}")

        print(f"Step 1 — Game IDs for {season_key}")
        game_ids = fetch_game_ids(season_cfg)
        game_ids_by_season[season_key] = game_ids
        print(f"  Total: {len(game_ids)} games")

        print(f"\nStep 2 — Stints + events for {season_key}")
        stints, events = fetch_all_stints(game_ids, season_cfg)
        stints['season_weight'] = season_cfg['weight']
        if not events.empty:
            events['season_weight'] = season_cfg['weight']
        if not shots_cache.empty and season_key in set(shots_cache['season'].unique()):
            season_shots = shots_cache[shots_cache['season'] == season_key].copy()
            stints = _rebuild_stint_xg_from_shots_cache(stints, season_shots, season_key)
            if experiment_name == EXPERIMENT_XG_CONTEXT_PARITY:
                experimental_season_dfs[season_key] = _rebuild_stint_xg_from_shots_cache(
                    stints.copy(),
                    season_shots,
                    season_key,
                    experiment_name=experiment_name,
                )
            elif experiment_name == EXPERIMENT_SHORT_MISS_PARITY:
                filtered_shots, _ = _apply_short_miss_parity_filter(season_shots, season_key=season_key)
                experimental_season_dfs[season_key] = _rebuild_stint_xg_from_shots_cache(
                    stints.copy(),
                    filtered_shots,
                    season_key,
                )
        season_dfs[season_key] = stints
        if season_key not in experimental_season_dfs:
            experimental_season_dfs[season_key] = stints.copy()
        events_by_season[season_key] = events
        print(f"  {len(stints):,} stints, {len(events):,} events loaded for {season_key}")

    if TEST_MODE:
        # Run diagnostics on 25-26 only and exit
        print_test_diagnostics(season_dfs['25-26'])
        print("\n→ Review diagnostics above, then set TEST_MODE = False and re-run.")
        sys.exit(0)

    # Step 2b: fetch player_seasons for Bayesian priors
    print(f"\n{'='*60}")
    print("Step 2b — Fetch player_seasons for Bayesian priors")
    print(f"{'='*60}")
    player_seasons_df = fetch_player_seasons_for_priors()

    # Step 2c: compute current-season (25-26) qualified player set for TOI filter
    print(f"\n{'='*60}")
    print("Step 2c — Current-season TOI filter (≥200 min in 25-26)")
    print(f"{'='*60}")
    current_season_filter = None
    stints_2526_path = SEASON_CONFIGS['25-26']['stints_file']
    if os.path.exists(stints_2526_path) and '25-26' in season_dfs:
        cs_stints = season_dfs['25-26']
        cs_toi = defaultdict(float)
        for _col in ('home_players', 'away_players'):
            _exp = cs_stints[['duration_seconds', _col]].copy()
            _exp[_col] = _exp[_col].astype(str).str.split('|')
            _exp = _exp.explode(_col)
            _exp = _exp[_exp[_col].str.strip() != '']
            _exp[_col] = _exp[_col].astype(int)
            for _pid, _toi in _exp.groupby(_col)['duration_seconds'].sum().items():
                cs_toi[_pid] += float(_toi)
        MIN_CURRENT_TOI_SEC = 200 * 60
        current_season_filter = {p for p, t in cs_toi.items() if t >= MIN_CURRENT_TOI_SEC}
        print(f"  {len(current_season_filter)} players with ≥200 min in 25-26 stints "
              f"(out of {len(cs_toi)} total seen)")
    else:
        print(f"  Warning: 25-26 stints not available — current_season_filter disabled")

    # Step 2d: augment stints for 23-24, 24-25, 25-26 with dummy variables
    print(f"\n{'='*60}")
    print("Step 2d — Augmenting stints with dummy variables (23-24 / 24-25 / 25-26)")
    print(f"{'='*60}")
    for _sk in list(DUMMY_SEASONS):
        if _sk not in season_dfs:
            continue
        season_dfs[_sk] = augment_stints_with_dummies(
            season_dfs[_sk],
            game_ids_by_season.get(_sk, []),
            _sk,
            SEASON_CONFIGS[_sk],
        )
        if experiment_name == EXPERIMENT_XG_CONTEXT_PARITY and _sk in experimental_season_dfs:
            experimental_season_dfs[_sk] = augment_stints_with_dummies(
                experimental_season_dfs[_sk],
                game_ids_by_season.get(_sk, []),
                _sk,
                SEASON_CONFIGS[_sk],
            )

    # Step 2d.5: event-level cache is no longer part of the EV RAPM regression path
    print(f"\n{'='*60}")
    print("Step 2d.5 — Event-level shot rematch skipped")
    print(f"{'='*60}")
    print("  Shift-level EV RAPM now fits directly on stints, so cached shot-to-stint")
    print("  rematching is skipped in this pass. Existing event files are kept only")
    print("  for compatibility/debugging and are ignored by the regression.")

    # Step 2e: fetch PP/PK stints for card seasons only (23-24/24-25/25-26).
    # Scraping all historical seasons is impractical without a local hockey-scraper
    # cache (DOCS_DIR=False by default).  If stints_ppk_XXYY.csv already exists for
    # a season it is loaded instantly regardless of SKIP_SCRAPING.
    print(f"\n{'='*60}")
    print("Step 2e — PP/PK stints (5v4, 4v5, 5v3, 3v5, 4v3, 3v4) [card seasons only]")
    print(f"{'='*60}")
    PP_PK_SEASONS = ['23-24', '24-25', '25-26']
    pp_pk_season_dfs = {}
    for season_key in PP_PK_SEASONS:
        if season_key not in seasons_to_run:
            continue
        season_cfg = seasons_to_run[season_key]
        print(f"\n  {season_key}:")
        ppk = fetch_all_pp_pk_stints(game_ids_by_season.get(season_key, []), season_cfg)
        if len(ppk) > 0:
            ppk['season_weight'] = season_cfg['weight']
            pp_pk_season_dfs[season_key] = ppk
            states = ppk['strength_state'].value_counts().to_dict() if 'strength_state' in ppk.columns else {}
            print(f"    {len(ppk):,} PP/PK stints: {states}")
        else:
            print(f"    No PP/PK stints available for {season_key}")
    pp_pk_seasons_available = sorted(pp_pk_season_dfs.keys())
    print(f"\n  PP/PK stints available for: {pp_pk_seasons_available}")

    # Step 3: prior-informed RAPM with daisy chain 18-19 → … → 25-26
    print(f"\n{'='*60}")
    print("Step 3 — Prior-informed RAPM (daisy chain 18-19 → 25-26)")
    print(f"{'='*60}")
    raw_season_results = run_prior_informed_rapm(
        season_dfs, player_seasons_df, current_season_filter=current_season_filter,
        events_by_season=events_by_season, experiment_name="",
    )

    experiment_mode = bool(experiment_name)
    experimental_raw_results = {}
    if experiment_name == EXPERIMENT_EV_PRIOR_PARITY:
        print(f"\n{'='*60}")
        print("Step 3a — Experimental EV prior parity RAPM")
        print(f"{'='*60}")
        experimental_raw_results = run_prior_informed_rapm(
            season_dfs,
            player_seasons_df,
            current_season_filter=current_season_filter,
            events_by_season=events_by_season,
            experiment_name=experiment_name,
        )
    elif experiment_name == EXPERIMENT_XG_CONTEXT_PARITY:
        print(f"\n{'='*60}")
        print("Step 3a — Experimental xG context parity RAPM")
        print(f"{'='*60}")
        print("  Applying training-pipeline rush/rebound and pre-shot movement rules")
        print("  to the shot-cache xG rebuild while leaving priors and ridge setup unchanged.")
        experimental_raw_results = run_prior_informed_rapm(
            experimental_season_dfs,
            player_seasons_df,
            current_season_filter=current_season_filter,
            events_by_season=events_by_season,
            experiment_name="",
        )
    elif experiment_name == EXPERIMENT_SHORT_MISS_PARITY:
        print(f"\n{'='*60}")
        print("Step 3a — Experimental short-miss parity RAPM")
        print(f"{'='*60}")
        print("  Excluding miss_reason='short' shots from shot-cache xG/Fenwick totals")
        print("  when that metadata exists, while leaving the baseline live path untouched.")
        experimental_raw_results = run_prior_informed_rapm(
            experimental_season_dfs,
            player_seasons_df,
            current_season_filter=current_season_filter,
            events_by_season=events_by_season,
            experiment_name="",
        )
    elif experiment_name in _ASYMMETRIC_ALPHA_EXPERIMENTS:
        k_val = _ASYMMETRIC_ALPHA_EXPERIMENTS[experiment_name]
        print(f"\n{'='*60}")
        print(f"Step 3a — Experimental asymmetric alpha (k={k_val:.2f})")
        print(f"{'='*60}")
        print(f"  Offense columns scaled by {k_val:.2f} before ridge regression.")
        print(f"  Effective off L2 penalty ≈ alpha/{k_val**2:.2f}×  (less shrinkage on offense).")
        experimental_raw_results = run_prior_informed_rapm(
            season_dfs,
            player_seasons_df,
            current_season_filter=current_season_filter,
            events_by_season=events_by_season,
            experiment_name="",
            asymmetric_k=k_val,
        )

    raw_season_results = apply_promoted_baseline_rapm_adjustments(raw_season_results, season_dfs)
    if experimental_raw_results:
        experimental_raw_results = apply_promoted_baseline_rapm_adjustments(
            experimental_raw_results,
            season_dfs,
        )

    # Step 3b: filter, compute context metrics, upload per-season RAPM
    print(f"\n{'='*60}")
    print("Step 3b — Context metrics + per-season upload")
    print(f"{'='*60}")

    season_results = {}
    name_to_pid, _, _ = _load_player_identity_maps()
    for season_key in ['23-24', '24-25', '25-26']:
        if season_key not in raw_season_results:
            continue
        stints = season_dfs[season_key]
        raw_results = raw_season_results[season_key]
        qualified = filter_qualified_results(raw_results)
        print(
            f"  Qualified skaters for {season_key}: "
            f"{len(qualified)}/{len(raw_results)} (≥{MIN_TOI_MINUTES} min 5v5)"
        )
        context = compute_context_metrics(stints, qualified)
        merged = qualified.merge(context, on='player_id', how='left')
        season_results[season_key] = merged
        print_season_spotlight_summary(season_key, merged, name_to_pid)
        if not experiment_mode and not QUICK_TEST:
            upload_season_rapm(season_key, merged)

    # Step 3c: prior-informed PP/PK RAPM daisy chain + per-season upload
    print(f"\n{'='*60}")
    print("Step 3c — PP/PK RAPM daisy chain")
    print(f"{'='*60}")
    pp_pk_card_season_results = {}
    if pp_pk_season_dfs:
        pp_pk_all_season_results = run_prior_informed_pp_pk_rapm(pp_pk_season_dfs)
        for season_key in ['23-24', '24-25', '25-26']:
            if season_key not in pp_pk_all_season_results:
                continue
            res = pp_pk_all_season_results[season_key]
            pp_df = res.get('pp', pd.DataFrame())
            pk_df = res.get('pk', pd.DataFrame())
            if not pp_df.empty or not pk_df.empty:
                pp_pk_card_season_results[season_key] = res
                if not experiment_mode and not QUICK_TEST:
                    upload_season_pp_pk_rapm(season_key, pp_df, pk_df)
        print_pp_pk_leaderboards(pp_pk_card_season_results)
    else:
        print("  No PP/PK stints available — skipping PP/PK RAPM")
        print("  Run without SKIP_SCRAPING=1 to generate stints_ppk_XXYY.csv files first.")

    def _results_to_json(results_by_season):
        return {
            sk: {
                str(int(row.player_id)): {
                    'rapm_off': round(float(row.rapm_off), 4),
                    'rapm_def': round(float(row.rapm_def), 4),
                }
                for row in df_s.itertuples()
                if pd.notna(row.rapm_off) and pd.notna(row.rapm_def)
            }
            for sk, df_s in results_by_season.items()
        }

    baseline_projected = project_season_results(season_results)
    projected = baseline_projected

    if experiment_mode:
        print(f"\nExperimental RAPM mode active: {experiment_name}")
        experimental_season_results = {}
        for season_key, raw_df in raw_season_results.items():
            if experiment_name == EXPERIMENT_TEAMMATE_SHARE_DEFENSE:
                adjusted_raw = apply_teammate_share_defense_experiment(raw_df, season_dfs[season_key])
            elif experiment_name == EXPERIMENT_2425_COLLINEARITY_REALLOCATION:
                if season_key == '24-25':
                    adjusted_raw = apply_2425_collinearity_reallocation_experiment(
                        raw_df,
                        season_dfs[season_key],
                    )
                else:
                    adjusted_raw = raw_df.copy()
            elif experiment_name == EXPERIMENT_COLLINEARITY_REALLOCATION_FORWARD_2425_2526:
                if season_key in ('24-25', '25-26'):
                    adjusted_raw = apply_2425_collinearity_reallocation_experiment(
                        raw_df,
                        season_dfs[season_key],
                        forward_only=True,
                    )
                else:
                    adjusted_raw = raw_df.copy()
            elif experiment_name == EXPERIMENT_2425_COLLINEARITY_REALLOCATION_DEFENSE:
                adjusted_raw = raw_df.copy()
            elif experiment_name in {
                EXPERIMENT_EV_PRIOR_PARITY,
                EXPERIMENT_XG_CONTEXT_PARITY,
                EXPERIMENT_SHORT_MISS_PARITY,
            } | set(_ASYMMETRIC_ALPHA_EXPERIMENTS.keys()):
                adjusted_raw = experimental_raw_results.get(season_key, raw_df.copy())
            else:
                adjusted_raw = raw_df.copy()
            experimental_raw_results[season_key] = adjusted_raw
            if season_key in ['23-24', '24-25', '25-26']:
                adjusted_card = filter_qualified_results(adjusted_raw)
                baseline_card = season_results.get(season_key, pd.DataFrame()).copy()
                if not baseline_card.empty:
                    keep_cols = [
                        'player_id',
                        'rapm_off',
                        'rapm_def',
                        'rapm_off_pct',
                        'rapm_def_pct',
                        'top_teammate_share',
                        'defense_share_multiplier',
                        'baseline_rapm_def',
                        'baseline_rapm_def_pct',
                        'rapm_def_delta',
                        'rapm_def_pct_delta',
                        'onice_xgf_pct',
                        'onice_xgd60',
                        'share_score',
                        'offense_tilt_score',
                        'collinearity_reallocation_score',
                        'offense_collinearity_bonus',
                        'defense_credit_transfer',
                        'baseline_rapm_off',
                        'baseline_rapm_off_pct',
                        'rapm_off_delta',
                        'rapm_off_pct_delta',
                    ]
                    adjusted_subset = adjusted_card[[c for c in keep_cols if c in adjusted_card.columns]]
                    baseline_card = baseline_card.drop(
                        columns=[c for c in adjusted_subset.columns if c != 'player_id'],
                        errors='ignore',
                    )
                    experimental_season_results[season_key] = baseline_card.merge(
                        adjusted_subset,
                        on='player_id',
                        how='inner',
                    )
                else:
                    experimental_season_results[season_key] = adjusted_card

        projected = project_season_results(experimental_season_results)
        projected_compare = baseline_projected[
            ['player_id', 'rapm_off', 'rapm_def', 'rapm_off_pct', 'rapm_def_pct']
        ].merge(
            projected[
                ['player_id', 'rapm_off', 'rapm_def', 'rapm_off_pct', 'rapm_def_pct']
            ],
            on='player_id',
            how='inner',
            suffixes=('_baseline', '_experimental'),
        )
        projected_metrics = []
        weighted_metric_cols = []
        if experiment_name == EXPERIMENT_TEAMMATE_SHARE_DEFENSE:
            weighted_metric_cols = ['top_teammate_share', 'defense_share_multiplier']
        elif experiment_name in (
            EXPERIMENT_2425_COLLINEARITY_REALLOCATION,
            EXPERIMENT_COLLINEARITY_REALLOCATION_FORWARD_2425_2526,
        ):
            weighted_metric_cols = [
                'top_teammate_share',
                'onice_xgf_pct',
                'onice_xgd60',
                'share_score',
                'offense_tilt_score',
                'collinearity_reallocation_score',
                'offense_collinearity_bonus',
                'defense_credit_transfer',
            ]
        for pid in projected['player_id'].tolist() if (not projected.empty and weighted_metric_cols) else []:
            metric_totals = {col: 0.0 for col in weighted_metric_cols}
            metric_weights = {col: 0.0 for col in weighted_metric_cols}
            for season_key, season_df in experimental_season_results.items():
                row = season_df[season_df['player_id'] == pid]
                if row.empty:
                    continue
                w = CARD_SEASON_WEIGHTS.get(season_key, 0.0)
                for col in weighted_metric_cols:
                    if col not in row.columns or pd.isna(row[col].iloc[0]):
                        continue
                    metric_totals[col] += float(row[col].iloc[0]) * w
                    metric_weights[col] += w
            payload = {'player_id': pid}
            for col in weighted_metric_cols:
                payload[col] = (
                    metric_totals[col] / metric_weights[col]
                    if metric_weights[col] > 0 else None
                )
            projected_metrics.append(payload)
        if projected_metrics:
            projected = projected.merge(pd.DataFrame(projected_metrics), on='player_id', how='left')

        exp_json = _results_to_json(experimental_raw_results)
        exp_json_path = os.path.join(DATA_DIR, f'per_season_rapm_{experiment_name}.json')
        with open(exp_json_path, 'w') as fh:
            json.dump(exp_json, fh)
        print(f"\nSaved experimental per-season RAPM to {exp_json_path}")

        summary = build_experiment_summary(baseline_projected, projected)
        if summary:
            summary_path = os.path.join(DATA_DIR, f'rapm_experiment_{experiment_name}_summary.json')
            with open(summary_path, 'w') as fh:
                json.dump(summary, fh, indent=2)
            print(f"Saved experiment summary to {summary_path}")

        if not projected.empty:
            compare_csv = projected_compare.copy()
            if experiment_name == EXPERIMENT_TEAMMATE_SHARE_DEFENSE:
                compare_csv = compare_csv.merge(
                    projected[['player_id', 'top_teammate_share', 'defense_share_multiplier']],
                    on='player_id',
                    how='left',
                )
            elif experiment_name in (
                EXPERIMENT_2425_COLLINEARITY_REALLOCATION,
                EXPERIMENT_COLLINEARITY_REALLOCATION_FORWARD_2425_2526,
            ):
                compare_csv = compare_csv.merge(
                    projected[[
                        c for c in [
                            'player_id',
                            'top_teammate_share',
                            'onice_xgf_pct',
                            'onice_xgd60',
                            'share_score',
                            'offense_tilt_score',
                            'collinearity_reallocation_score',
                            'offense_collinearity_bonus',
                            'defense_credit_transfer',
                        ] if c in projected.columns
                    ]],
                    on='player_id',
                    how='left',
                )
            compare_csv['rapm_off_delta'] = compare_csv['rapm_off_experimental'] - compare_csv['rapm_off_baseline']
            compare_csv['rapm_def_delta'] = compare_csv['rapm_def_experimental'] - compare_csv['rapm_def_baseline']
            compare_csv['rapm_off_pct_delta'] = compare_csv['rapm_off_pct_experimental'] - compare_csv['rapm_off_pct_baseline']
            compare_csv['rapm_def_pct_delta'] = compare_csv['rapm_def_pct_experimental'] - compare_csv['rapm_def_pct_baseline']
            compare_csv_path = os.path.join(DATA_DIR, f'rapm_experiment_{experiment_name}.csv')
            compare_csv.to_csv(compare_csv_path, index=False)
            print(f"Saved projected experiment comparison to {compare_csv_path}")
            if summary:
                print(f"  Players compared: {summary.get('players_compared')}")
                print(f"  Median |off pct delta|: {summary.get('median_abs_rapm_off_pct_delta')}")
                print(f"  Median |def pct delta|: {summary.get('median_abs_rapm_def_pct_delta')}")
                print(f"  Share within 10 off pct pts: {summary.get('share_within_10_off_pct_points')}")
                print(f"  Share within 10 def pct pts: {summary.get('share_within_10_def_pct_points')}")
    else:
        # Save per-season RAPM to JSON for compute_historical_war.py
        # QUICK_TEST only builds 3 seasons — never overwrite the full history JSON
        if QUICK_TEST:
            _total_ps = sum(len(v) for v in _results_to_json(raw_season_results).values())
            print(f"\n[QUICK_TEST] Skipping per_season_rapm.json save ({_total_ps} entries; "
                  f"would overwrite full history with 3-season chain values)")
        else:
            per_season_rapm = _results_to_json(raw_season_results)
            _rapm_json_path = os.path.join(DATA_DIR, 'per_season_rapm.json')
            with open(_rapm_json_path, 'w') as _f:
                json.dump(per_season_rapm, _f)
            _total_ps = sum(len(v) for v in per_season_rapm.values())
            print(f"\nSaved per-season RAPM to {_rapm_json_path} ({_total_ps} total player-seasons)")

    # Step 4: project per-season RAPM to 3-year card RAPM and upload to players
    print(f"\n{'='*60}")
    print("Step 4 — Project 3-year RAPM card")
    print(f"{'='*60}")
    if projected.empty:
        print("✗ No projected RAPM rows were produced")
        sys.exit(1)

    # Print comparison before quality gate so results can be reviewed first
    print_comparison_table(projected, old_rapm_lookup)
    print_validation_summary(projected, old_rapm_lookup)
    if experiment_mode:
        print("\nExperimental RAPM mode: skipping baseline upload to Supabase.")
    elif QUICK_TEST:
        print("\n[QUICK_TEST] Skipping Supabase upload — 3-season chain values are not suitable "
              "for production (use full run without QUICK_TEST to publish).")
    else:
        check_and_maybe_upload(projected)

    print("\n✓ Done. Run compute_ratings.py, then compute_percentiles.py to refresh cards.")
