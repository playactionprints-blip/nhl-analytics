#!/usr/bin/env python3
"""
Build an XGBoost expected-goals (xG) model from NHL shot events.

Steps
-----
1. Scrape raw shot events for all 3 seasons using NHL API v1 play-by-play
   (resumes from checkpoint).  Saves  data/shots_all_seasons.csv.
2. Engineer features: per-game direction normalization, distance, angle,
   rush, rebound, score-state, etc.
3. Train separate XGBClassifier models for 5v5 / PP / PK.
   Season-split CV: train on 23-24+24-25, test on 25-26.
   Reports AUC and stops with a warning if any model < 0.72.
4. Calibration & feature-importance validation.
5. Re-compute xG in all three stints_XXXX.csv files using the new model.
6. Print instruction to re-run build_rapm.py + compute_ratings.py.

USAGE
-----
    # via run script (sets env vars):
    nohup /Users/cspeedie/Desktop/nhl-analytics/venv/bin/python3 \
        build_xg_model.py > data/xg_log.txt 2>&1 &

    # or directly (env vars already set):
    python3 build_xg_model.py
"""

import json, math, os, sys, time, warnings
import pandas as pd
import numpy as np
import requests

warnings.filterwarnings('ignore')

# ── Config ────────────────────────────────────────────────────────────────────
CKPT_EVERY      = 100    # save checkpoint every N games
PROGRESS_EVERY  = 50     # print progress every N games
AUC_THRESHOLD   = 0.72   # minimum acceptable AUC before updating stints

SCHEDULE_API = "https://api-web.nhle.com/v1"
DATA_DIR     = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
SHOTS_FILE   = os.path.join(DATA_DIR, 'shots_all_seasons.csv')
SHOTS_CKPT   = os.path.join(DATA_DIR, 'shots_checkpoint.csv')
PATCH_FILE   = os.path.join(DATA_DIR, 'player_id_patch.json')
os.makedirs(DATA_DIR, exist_ok=True)

SEASON_CONFIGS = {
    '25-26': {
        'id_base':   2025000000,
        'ids_file':  os.path.join(DATA_DIR, 'game_ids_2526.json'),
        'stints_file': os.path.join(DATA_DIR, 'stints_2526.csv'),
    },
    '24-25': {
        'id_base':   2024000000,
        'ids_file':  os.path.join(DATA_DIR, 'game_ids_2425.json'),
        'stints_file': os.path.join(DATA_DIR, 'stints_2425.csv'),
    },
    '23-24': {
        'id_base':   2023000000,
        'ids_file':  os.path.join(DATA_DIR, 'game_ids_2324.json'),
        'stints_file': os.path.join(DATA_DIR, 'stints_2324.csv'),
    },
}

PLAYER_ID_PATCH = {}
if os.path.exists(PATCH_FILE):
    with open(PATCH_FILE) as f:
        PLAYER_ID_PATCH = json.load(f)
    print(f"Loaded player_id_patch: {len(PLAYER_ID_PATCH)} entries")

SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "nhl-analytics/1.0"})

SHOT_COLS = [
    'game_id', 'season', 'period', 'time_seconds',
    'shooter_id', 'shooter_team', 'is_home',
    'x_coord', 'y_coord', 'shot_type',
    'prior_event_type', 'prior_event_team', 'seconds_since_prior',
    'score_diff', 'game_strength',
    'is_goal',
]

# ── Helpers ───────────────────────────────────────────────────────────────────
def _get_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        try:
            r = SESSION.get(url, timeout=20)
            r.raise_for_status()
            return r
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(5.0)
            else:
                raise


def _load_game_ids(ids_file):
    if os.path.exists(ids_file):
        with open(ids_file) as f:
            ids = json.load(f)
        print(f"  Loaded {len(ids)} game IDs from {os.path.basename(ids_file)}")
        return ids
    raise FileNotFoundError(f"Game IDs file not found: {ids_file}. "
                            "Run build_rapm.py first to generate game IDs.")


def _strength_category(strength):
    """Map individual strength label → training bucket (5v5 / PP / PK / other)."""
    if strength == '5v5':   return '5v5'
    if strength == '5v4':   return 'PP'   # home team on PP
    if strength == '4v5':   return 'PK'   # home team on PK
    return 'other'


# ── NHL API v1 shot scraping helpers ──────────────────────────────────────────
def _parse_situation_code(sit_code):
    """
    Parse NHL API v1 situationCode (4 chars: away_goalies + away_sk + home_sk + home_goalies).
    Returns one of: '5v5', '5v4', '4v5', '4v4', '3v3', 'other'
    """
    if not sit_code or len(str(sit_code)) != 4:
        return 'other'
    s = str(sit_code)
    away_sk, home_sk = int(s[1]), int(s[2])
    if away_sk == 5 and home_sk == 5:   return '5v5'
    if away_sk == 4 and home_sk == 5:   return '5v4'   # home PP
    if away_sk == 5 and home_sk == 4:   return '4v5'   # home PK
    if away_sk == 4 and home_sk == 4:   return '4v4'
    if away_sk == 3 and home_sk == 3:   return '3v3'
    return 'other'


# NHL API v1 shotType → SHOT_TYPE_ORDER label
_SHOT_TYPE_MAP = {
    'wrist': 'WRIST SHOT', 'slap': 'SLAP SHOT', 'snap': 'SNAP SHOT',
    'backhand': 'BACKHAND', 'tip-in': 'TIP-IN', 'deflected': 'DEFLECTED',
    'wrap-around': 'WRAP-AROUND', 'between-legs': 'BETWEEN LEGS', 'poke': 'POKE',
}

# NHL API v1 typeDescKey → PRIOR_EVENT_ORDER label
_EVENT_TYPE_MAP = {
    'shot-on-goal': 'SHOT', 'goal': 'GOAL', 'missed-shot': 'MISS',
    'blocked-shot': 'BLOCK', 'hit': 'HIT', 'faceoff': 'FACEOFF',
    'giveaway': 'GIVE', 'takeaway': 'TAKE',
    'stoppage': 'STOP', 'period-start': 'STOP', 'period-end': 'STOP',
    'penalty': 'STOP',
}


def scrape_game_shots_v1(game_id_full, season_key):
    """
    Fetch shot events for one game from NHL API v1 play-by-play.
    Returns list of dicts matching SHOT_COLS.
    Coordinates (xCoord/yCoord) from NHL API v1 are absolute rink positions —
    per-game direction normalization is applied later in engineer_features.
    """
    url = f"https://api-web.nhle.com/v1/gamecenter/{game_id_full}/play-by-play"
    r = _get_with_retry(url)
    data = r.json()

    home_team_id = data.get('homeTeam', {}).get('id')
    home_abbr    = data.get('homeTeam', {}).get('abbrev', '')
    away_abbr    = data.get('awayTeam', {}).get('abbrev', '')

    home_score = away_score = 0
    prior_type  = 'NONE'
    prior_team  = ''
    prior_secs  = 0

    rows = []
    for ev in data.get('plays', []):
        ev_type = ev.get('typeDescKey', '')
        det     = ev.get('details', {})
        period  = ev.get('periodDescriptor', {}).get('number', 0)
        if not period or period < 1:
            continue

        # Absolute game seconds
        parts  = str(ev.get('timeInPeriod', '0:00')).split(':')
        p_secs = int(parts[0]) * 60 + int(parts[1]) if len(parts) == 2 else 0
        abs_t  = (period - 1) * 1200 + p_secs

        # Update running score for goals
        if ev_type == 'goal':
            if det.get('eventOwnerTeamId') == home_team_id:
                home_score += 1
            else:
                away_score += 1

        # Only keep shooting events
        is_shot_ev = ev_type in ('shot-on-goal', 'goal', 'missed-shot')
        if not is_shot_ev:
            prior_type = _EVENT_TYPE_MAP.get(ev_type, ev_type.upper()[:10])
            prior_team = home_abbr if det.get('eventOwnerTeamId') == home_team_id else away_abbr
            prior_secs = abs_t
            continue

        # Coordinates — skip if missing
        xc = det.get('xCoord')
        yc = det.get('yCoord')
        if xc is None or yc is None:
            prior_type = _EVENT_TYPE_MAP.get(ev_type, 'SHOT')
            prior_team = home_abbr if det.get('eventOwnerTeamId') == home_team_id else away_abbr
            prior_secs = abs_t
            continue

        shooter_id = det.get('shootingPlayerId') or det.get('scoringPlayerId')
        if not shooter_id:
            prior_type = 'SHOT'
            prior_secs = abs_t
            continue

        event_team_id = det.get('eventOwnerTeamId')
        is_home       = int(event_team_id == home_team_id)
        shooter_team  = home_abbr if is_home else away_abbr

        score_diff = home_score - away_score
        if not is_home:
            score_diff = -score_diff

        rows.append({
            'game_id':             game_id_full,
            'season':              season_key,
            'period':              period,
            'time_seconds':        abs_t,
            'shooter_id':          int(shooter_id),
            'shooter_team':        shooter_team,
            'is_home':             is_home,
            'x_coord':             float(xc),
            'y_coord':             float(yc),
            'shot_type':           _SHOT_TYPE_MAP.get(det.get('shotType', ''), ''),
            'prior_event_type':    prior_type,
            'prior_event_team':    prior_team,
            'seconds_since_prior': float(max(0, abs_t - prior_secs)),
            'score_diff':          score_diff,
            'game_strength':       _parse_situation_code(ev.get('situationCode', '')),
            'is_goal':             int(ev_type == 'goal'),
        })

        prior_type = _EVENT_TYPE_MAP.get(ev_type, 'SHOT')
        prior_team = shooter_team
        prior_secs = abs_t

    return rows


# ── Step 1: Scrape shot events ─────────────────────────────────────────────────


def scrape_shots_for_season(season_key, season_cfg, existing_df=None):
    """
    Scrape shot events for one season using NHL API v1, resuming from checkpoint.
    existing_df: optional DataFrame of already-scraped shots (from shots_all_seasons.csv)
                 used as seed if checkpoint has no data for this season.
    Returns a DataFrame with SHOT_COLS.
    """
    game_ids = _load_game_ids(season_cfg['ids_file'])

    existing_rows = []
    done_games    = set()

    if os.path.exists(SHOTS_CKPT):
        try:
            df_ex = pd.read_csv(SHOTS_CKPT)
            season_rows = df_ex[df_ex['season'] == season_key]
            if len(season_rows) > 0:
                existing_rows = season_rows.to_dict('records')
                done_games    = set(season_rows['game_id'].unique())
                print(f"  Resuming {season_key}: {len(done_games)} games done, "
                      f"{len(existing_rows):,} shots loaded")
        except Exception as e:
            print(f"  Warning: could not load checkpoint: {e}")

    if not done_games and existing_df is not None and len(existing_df) > 0:
        existing_rows = existing_df[SHOT_COLS].to_dict('records')
        done_games    = set(existing_df['game_id'].unique())
        print(f"  Seeded {season_key} from shots_all_seasons.csv: "
              f"{len(done_games)} games ({len(existing_rows):,} shots)")

    todo = [gid for gid in game_ids if gid not in done_games]
    print(f"  {season_key}: {len(todo)} games remaining ({len(game_ids)} total)")

    if not todo:
        return pd.DataFrame(existing_rows, columns=SHOT_COLS) if existing_rows \
               else pd.DataFrame(columns=SHOT_COLS)

    new_rows   = []
    failed     = []
    total      = len(todo)

    for i, gid in enumerate(todo):
        try:
            shots = scrape_game_shots_v1(gid, season_key)
            new_rows.extend(shots)
        except Exception as e:
            failed.append(gid)

        games_done = i + 1
        if games_done % PROGRESS_EVERY == 0 or games_done == total:
            print(f"  {season_key} — {games_done}/{total} games | "
                  f"shots so far: {len(existing_rows) + len(new_rows):,}")

        if games_done % CKPT_EVERY == 0:
            _save_shot_checkpoint(existing_rows + new_rows, season_key)

        time.sleep(0.07)   # gentle rate limit

    if failed:
        print(f"  {len(failed)} games failed for {season_key}")

    all_rows = existing_rows + new_rows
    return pd.DataFrame(all_rows, columns=SHOT_COLS) if all_rows \
           else pd.DataFrame(columns=SHOT_COLS)


def _save_shot_checkpoint(rows, season_key_updating):
    """
    Merge new rows into the checkpoint file (keeping other seasons intact).
    """
    new_df = pd.DataFrame(rows, columns=SHOT_COLS) if rows \
             else pd.DataFrame(columns=SHOT_COLS)

    if os.path.exists(SHOTS_CKPT):
        try:
            existing = pd.read_csv(SHOTS_CKPT)
            # Drop the season we're updating and replace with new rows
            other = existing[existing['season'] != season_key_updating]
            merged = pd.concat([other, new_df], ignore_index=True)
            merged.to_csv(SHOTS_CKPT, index=False)
            print(f"  Checkpoint: {len(merged):,} total shots → shots_checkpoint.csv")
            return
        except Exception:
            pass

    new_df.to_csv(SHOTS_CKPT, index=False)
    print(f"  Checkpoint: {len(new_df):,} shots → shots_checkpoint.csv")


# ── Step 2: Feature engineering ───────────────────────────────────────────────
SHOT_TYPE_ORDER = [
    'WRIST', 'SLAP', 'SNAP', 'BACKHAND', 'TIP-IN', 'DEFLECTED',
    'WRAP-AROUND', 'BETWEEN LEGS', 'POKE', '',
]

PRIOR_EVENT_ORDER = [
    'SHOT', 'MISS', 'GOAL', 'GIVE', 'TAKE', 'BLOCK', 'HIT',
    'FACEOFF', 'STOP', 'NONE', '',
]

STRENGTH_ORDER = ['5v5', '5v4', '4v5', '4v4', '3v3', 'other']


def _detect_attack_directions(df):
    """
    For each (game_id, period, is_home) combination, determine which x-direction
    the team attacked using majority vote of shots with abs(x_coord) > 50.

    NHL API v1 coordinates are absolute rink positions; teams alternate ends
    each period, but which end a team starts on varies by game. This per-game
    detection correctly handles that variation.

    Returns a DataFrame with columns: game_id, period, is_home, attack_sign
    where attack_sign = +1 (attacks toward +89), -1 (toward -89), or 0 (unknown).
    """
    zone = df[df['x_coord'].abs() > 50][['game_id','period','is_home','x_coord']].copy()
    zone['is_pos'] = (zone['x_coord'] > 0).astype(int)
    zone['is_neg'] = (zone['x_coord'] < 0).astype(int)
    agg = zone.groupby(['game_id','period','is_home'])[['is_pos','is_neg']].sum().reset_index()
    agg['attack_sign'] = np.where(agg['is_pos'] > agg['is_neg'],  1,
                         np.where(agg['is_neg'] > agg['is_pos'], -1, 0))
    return agg[['game_id','period','is_home','attack_sign']]


def engineer_features(df, apply_noise_filter=True):
    """
    Add feature columns to the shots DataFrame.
    Coordinates are normalized per-game via majority-vote direction detection:
      - for each (game_id, period, is_home), determine attacking direction
        from which half of the ice has the most shots (abs(x) > 50)
      - normalize so all shots attack toward x=+89
    Noise shots (distance > 89ft or < 1ft) are removed.
    """
    df = df.copy()
    n_before = len(df)

    # --- Per-game coordinate normalisation ---
    dir_df = _detect_attack_directions(df)
    df = df.merge(dir_df, on=['game_id','period','is_home'], how='left')
    df['attack_sign'] = df['attack_sign'].fillna(0).astype(int)

    x = df['x_coord'].astype(float).values
    sign = df['attack_sign'].values
    # attack_sign=+1: attacking +x, net at +89 → x_normalized = x_coord
    # attack_sign=-1: attacking -x, net at -89 → flip to make net at +89
    # attack_sign=0:  unknown → use abs(x) fallback
    x_norm = np.where(sign ==  1,  x,
             np.where(sign == -1, -x, np.abs(x)))
    df['x_normalized'] = x_norm
    y = df['y_coord'].astype(float)

    # Distance and angle from the attacking net (x=+89 after normalisation)
    df['distance']      = np.sqrt((x_norm - 89) ** 2 + y ** 2)
    df['angle']         = np.degrees(np.arctan2(y.abs(), (pd.Series(x_norm) - 89).abs().clip(lower=0.1).values))
    df['is_behind_net'] = (x_norm > 89).astype(int)

    # --- Noise filter ---
    if apply_noise_filter:
        df = df[df['distance'] <= 89].copy()   # beyond center ice = coordinate error
        df = df[df['distance'] >= 1].copy()    # exactly at net = data error
        n_after = len(df)
        removed = n_before - n_after
        print(f"  Noise filter: removed {removed:,} shots ({removed/n_before*100:.1f}%)  "
              f"→ {n_after:,} remaining")

    # --- Rush and rebound ---
    prior_shot_types = {'SHOT', 'MISS', 'GOAL'}
    rush_prior_types = {'TAKE', 'GIVE', 'SHOT', 'MISS', 'BLOCK'}

    df['is_rush']    = (
        (df['seconds_since_prior'] < 4) &
        (df['prior_event_type'].isin(rush_prior_types))
    ).astype(int)

    df['is_rebound'] = (
        (df['seconds_since_prior'] < 3) &
        (df['prior_event_type'].isin(prior_shot_types))
    ).astype(int)

    # --- Score state (clipped) ---
    df['score_state'] = df['score_diff'].clip(-3, 3)

    # --- Period (OT → 4) ---
    df['period_cat'] = df['period'].clip(1, 4)

    # --- Label-encode categoricals ---
    df['shot_type_norm'] = (
        df['shot_type'].str.upper().str.strip()
        .replace({'TIP-IN': 'TIP-IN', 'DEFLECTED': 'TIP-IN'})   # merge tip variants
    )
    df['shot_type_encoded'] = pd.Categorical(
        df['shot_type_norm'], categories=SHOT_TYPE_ORDER
    ).codes.clip(0)

    df['prior_event_encoded'] = pd.Categorical(
        df['prior_event_type'].str.upper().str.strip(),
        categories=PRIOR_EVENT_ORDER
    ).codes.clip(0)

    df['game_strength_encoded'] = pd.Categorical(
        df['game_strength'], categories=STRENGTH_ORDER
    ).codes.clip(0)

    # --- Strength category bucket for per-model split ---
    df['strength_bucket'] = df['game_strength'].map(_strength_category)

    return df


FEATURE_COLS = [
    'distance', 'angle', 'is_behind_net',
    'is_rush', 'is_rebound',
    'shot_type_encoded',
    'prior_event_encoded',
    'seconds_since_prior',
    'score_state', 'period_cat',
    'is_home', 'game_strength_encoded',
]


# ── Step 3: Train XGBoost models ──────────────────────────────────────────────
def train_models(df):
    """
    Train one XGBClassifier per strength bucket (5v5 / PP / PK).
    Season-split CV: train on 23-24 + 24-25, test on 25-26.
    Returns {bucket: model} and prints AUC.
    Raises SystemExit if any model AUC < AUC_THRESHOLD.
    """
    from xgboost import XGBClassifier
    from sklearn.metrics import roc_auc_score

    models   = {}
    auc_ok   = True
    low_aucs = []

    for bucket in ['5v5', 'PP', 'PK']:
        sub = df[df['strength_bucket'] == bucket].copy()
        print(f"\n  Training {bucket}: {len(sub):,} shots "
              f"({sub['is_goal'].sum():,} goals = "
              f"{sub['is_goal'].mean()*100:.2f}%)")

        train = sub[sub['season'].isin(['23-24', '24-25'])]
        test  = sub[sub['season'] == '25-26']

        if len(train) < 1000:
            print(f"  SKIP {bucket}: too few training shots ({len(train)})")
            continue
        if len(test) < 100:
            print(f"  SKIP {bucket}: too few test shots ({len(test)})")
            continue

        X_train = train[FEATURE_COLS].astype(float)
        y_train = train['is_goal'].astype(int)
        X_test  = test[FEATURE_COLS].astype(float)
        y_test  = test['is_goal'].astype(int)

        # Class balance
        scale_pos_weight = (y_train == 0).sum() / max((y_train == 1).sum(), 1)

        model = XGBClassifier(
            n_estimators=300,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            min_child_weight=10,   # guards against over-fitting on rare goals
            scale_pos_weight=scale_pos_weight,
            use_label_encoder=False,
            eval_metric='auc',
            random_state=42,
            n_jobs=-1,
        )
        model.fit(
            X_train, y_train,
            eval_set=[(X_test, y_test)],
            verbose=False,
        )

        preds = model.predict_proba(X_test)[:, 1]
        auc   = roc_auc_score(y_test, preds)
        print(f"  {bucket} AUC (23-24+24-25 → 25-26): {auc:.4f}")

        if auc < AUC_THRESHOLD:
            print(f"  ✗ {bucket} AUC {auc:.3f} is below threshold {AUC_THRESHOLD}")
            low_aucs.append((bucket, auc))
            auc_ok = False

        # Save model
        model_path = os.path.join(DATA_DIR, f'xg_model_{bucket}.json')
        model.save_model(model_path)
        print(f"  Saved → {model_path}")
        models[bucket] = model

    if not auc_ok:
        print("\n✗ One or more models below AUC threshold. Reporting findings:")
        for bucket, auc in low_aucs:
            print(f"   {bucket}: AUC = {auc:.3f} (threshold {AUC_THRESHOLD})")
        print("  → Not proceeding to update stints. Investigate data quality.")
        sys.exit(1)

    return models


# ── Step 4: Calibration + feature importance ──────────────────────────────────
def validate_models(df, models):
    """
    Calibration: predicted xG vs actual goals per season × strength.
    Feature importance: distance and angle must be top-2.
    Sample predictions for sanity check.
    """
    print("\n" + "="*60)
    print("VALIDATION")
    print("="*60)

    all_preds = np.zeros(len(df))

    for bucket, model in models.items():
        mask = df['strength_bucket'] == bucket
        if mask.sum() == 0:
            continue
        preds = model.predict_proba(df.loc[mask, FEATURE_COLS].astype(float))[:, 1]
        all_preds[mask] = preds

    df = df.copy()
    df['xg_pred'] = all_preds

    # Calibration table
    print("\nCalibration (predicted xG vs actual goals):")
    print(f"  {'Season':<8}  {'Strength':<6}  {'Shots':>7}  "
          f"{'Pred xG':>9}  {'Goals':>7}  {'Ratio':>7}")
    print(f"  {'-'*8}  {'-'*6}  {'-'*7}  {'-'*9}  {'-'*7}  {'-'*7}")
    all_ok = True
    for season in ['23-24', '24-25', '25-26']:
        for bucket in ['5v5', 'PP', 'PK']:
            sub  = df[(df['season'] == season) & (df['strength_bucket'] == bucket)]
            if len(sub) == 0:
                continue
            pred = sub['xg_pred'].sum()
            real = sub['is_goal'].sum()
            ratio = pred / real if real > 0 else float('nan')
            flag = '' if 0.90 <= ratio <= 1.10 else ' ← OFF'
            if flag:
                all_ok = False
            print(f"  {season:<8}  {bucket:<6}  {len(sub):>7,}  "
                  f"{pred:>9.1f}  {real:>7}  {ratio:>7.3f}{flag}")
    if all_ok:
        print("  ✓ All calibration ratios within ±10%")
    else:
        print("  ⚠ Some calibration ratios are outside ±10% — review model")

    # Feature importance
    print("\nFeature importance (top 5 per model):")
    for bucket, model in models.items():
        imp  = model.feature_importances_
        order = np.argsort(imp)[::-1][:5]
        top5  = [(FEATURE_COLS[i], imp[i]) for i in order]
        print(f"  {bucket}:")
        for name, score in top5:
            print(f"    {name:<28} {score:.4f}")
        top2 = [t[0] for t in top5[:2]]
        if not ('distance' in top2 or 'angle' in top2):
            print(f"  ⚠ {bucket}: distance/angle not in top-2 — check coordinates")

    # Sample predictions
    print("\nSample predictions (sanity check):")
    _sample_shot(models, '5v5',
                 x=89-8.0, y=0, shot_type='TIP-IN', prior='SHOT',
                 secs_prior=1.0, score_diff=0, period=2, is_home=1,
                 label="Tip-in 8ft straight on (expect 0.30-0.50)")
    _sample_shot(models, '5v5',
                 x=89-60.0, y=0, shot_type='SLAP', prior='NONE',
                 secs_prior=30, score_diff=0, period=2, is_home=1,
                 label="Slap shot blue line 60ft (expect 0.02-0.06)")
    _sample_shot(models, '5v5',
                 x=89-15.0, y=5, shot_type='WRIST', prior='SHOT',
                 secs_prior=1.5, score_diff=0, period=2, is_home=1,
                 label="Rebound slot 15ft (expect 0.20-0.40)")


def _sample_shot(models, strength, x, y, shot_type, prior, secs_prior,
                 score_diff, period, is_home, label):
    model = models.get(strength)
    if model is None:
        print(f"  {label}: no model for {strength}")
        return

    dist = math.sqrt((x - 89) ** 2 + y ** 2)
    ang  = math.degrees(math.atan2(abs(y), max(abs(x - 89), 0.1)))

    st_enc  = pd.Categorical([shot_type.upper()], categories=SHOT_TYPE_ORDER).codes[0]
    pr_enc  = pd.Categorical([prior.upper()], categories=PRIOR_EVENT_ORDER).codes[0]
    gs_enc  = pd.Categorical([strength], categories=STRENGTH_ORDER).codes[0]

    feat = pd.DataFrame([{
        'distance':             dist,
        'angle':                ang,
        'is_behind_net':        int(x > 89),
        'is_rush':              0,
        'is_rebound':           int(secs_prior < 3 and prior in ('SHOT', 'MISS', 'GOAL')),
        'shot_type_encoded':    max(st_enc, 0),
        'prior_event_encoded':  max(pr_enc, 0),
        'seconds_since_prior':  secs_prior,
        'score_state':          max(-3, min(3, score_diff)),
        'period_cat':           period,
        'is_home':              is_home,
        'game_strength_encoded': max(gs_enc, 0),
    }])

    xg = model.predict_proba(feat.astype(float))[0, 1]
    print(f"  {label}")
    print(f"    dist={dist:.1f}ft  angle={ang:.1f}°  xG={xg:.4f}")


# ── Step 5: Re-compute xG in stints files ─────────────────────────────────────
def update_stints_xg(models):
    """
    Re-compute home_xg / away_xg in all three stints_XXXX.csv files.

    The stints files only store xG totals per stint, not individual shot events.
    We re-compute by loading shots_all_seasons.csv, predicting xG for each shot,
    then summing per stint.

    Matching shots to stints:
      - shots table has game_id, time_seconds, shooter_team, is_home, game_strength
      - stints table has game_id, start_sec, end_sec, home_players, away_players
      - A shot belongs to a stint if start_sec <= time_seconds < end_sec
        and game_strength == '5v5' (stints are only 5v5)
    """
    print("\n" + "="*60)
    print("STEP 5 — Update stints xG")
    print("="*60)

    if not os.path.exists(SHOTS_FILE):
        print("  shots_all_seasons.csv not found — cannot update stints")
        return

    shots = pd.read_csv(SHOTS_FILE)
    shots = engineer_features(shots)

    # Predict xG for all 5v5 shots
    mask_5v5 = shots['strength_bucket'] == '5v5'
    shots_5v5 = shots[mask_5v5].copy()
    if '5v5' in models and len(shots_5v5) > 0:
        shots_5v5['xg_pred'] = models['5v5'].predict_proba(
            shots_5v5[FEATURE_COLS].astype(float))[:, 1]
    else:
        shots_5v5['xg_pred'] = 0.0

    print(f"  5v5 shots: {len(shots_5v5):,} | mean xG: {shots_5v5['xg_pred'].mean():.4f}")

    # For each stints file, rebuild home_xg / away_xg by joining shots
    for season_key, cfg in SEASON_CONFIGS.items():
        stints_path = cfg['stints_file']
        if not os.path.exists(stints_path):
            print(f"  {season_key}: stints file not found — skipping")
            continue

        stints = pd.read_csv(stints_path)
        season_shots = shots_5v5[shots_5v5['season'] == season_key].copy()
        print(f"\n  {season_key}: {len(stints):,} stints, {len(season_shots):,} shots")

        if len(season_shots) == 0:
            print(f"  {season_key}: no shots — stints xG unchanged")
            continue

        # Vectorised join via interval tree approach:
        # Sort stints and shots by game, then do a merge-interval pass
        stints = stints.sort_values(['game_id', 'start_sec']).reset_index(drop=True)
        season_shots = season_shots.sort_values(
            ['game_id', 'time_seconds']).reset_index(drop=True)

        new_home_xg = np.zeros(len(stints))
        new_away_xg = np.zeros(len(stints))

        # Group by game for efficiency
        for gid, game_shots in season_shots.groupby('game_id'):
            game_stints = stints[stints['game_id'] == gid]
            if len(game_stints) == 0:
                continue
            for _, shot in game_shots.iterrows():
                t  = shot['time_seconds']
                xg = shot['xg_pred']
                ih = int(shot['is_home'])
                # Find the stint this shot belongs to
                match = game_stints[
                    (game_stints['start_sec'] <= t) & (t < game_stints['end_sec'])
                ]
                if len(match) == 0:
                    continue
                idx = match.index[0]
                if ih:
                    new_home_xg[idx] += xg
                else:
                    new_away_xg[idx] += xg

        stints['home_xg'] = np.round(new_home_xg, 4)
        stints['away_xg'] = np.round(new_away_xg, 4)

        backup_path = stints_path.replace('.csv', '_old_xg.csv')
        if not os.path.exists(backup_path):
            pd.read_csv(stints_path).to_csv(backup_path, index=False)
            print(f"  Backed up original → {os.path.basename(backup_path)}")

        stints.to_csv(stints_path, index=False)
        total_new_xg = new_home_xg.sum() + new_away_xg.sum()
        print(f"  Updated {stints_path.split('/')[-1]}  "
              f"total xG: {total_new_xg:.1f}")

    print("\n✓ Stints updated. Re-run build_rapm.py then compute_ratings.py.")


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 60)
    print("xG Model Pipeline — 3-season build")
    print("=" * 60)

    # ── Step 1: Scrape shots ──────────────────────────────────────────────────
    print("\nStep 1 — Scrape shot events")
    print("-" * 40)

    # The old shots file used hockey-scraper coordinates which are unreliable.
    # Delete it to force a clean re-scrape from NHL API v1.
    if os.path.exists(SHOTS_FILE):
        backup = SHOTS_FILE.replace('.csv', '_hs_backup.csv')
        if not os.path.exists(backup):
            import shutil
            shutil.move(SHOTS_FILE, backup)
            print(f"  Backed up old shots file → shots_all_seasons_hs_backup.csv")
        else:
            os.remove(SHOTS_FILE)
            print(f"  Removed old shots file (re-scraping from NHL API v1)")
    # Clear checkpoint so we start fresh with NHL API v1 coordinates
    if os.path.exists(SHOTS_CKPT):
        os.remove(SHOTS_CKPT)
        print(f"  Cleared checkpoint — starting fresh NHL API v1 scrape")

    all_season_dfs = []
    for sk in ['23-24', '24-25', '25-26']:
        print(f"\n  Scraping {sk} from NHL API v1...")
        season_df = scrape_shots_for_season(sk, SEASON_CONFIGS[sk])
        all_season_dfs.append(season_df)
        _save_shot_checkpoint(season_df.to_dict('records'), sk)

    shots_df = pd.concat(all_season_dfs, ignore_index=True)
    shots_df = shots_df.drop_duplicates(
        subset=['game_id', 'time_seconds', 'shooter_id'], keep='first')
    shots_df.to_csv(SHOTS_FILE, index=False)
    print(f"\n  Total shots saved: {len(shots_df):,} → shots_all_seasons.csv")
    for sk in ['23-24', '24-25', '25-26']:
        sub = shots_df[shots_df['season'] == sk]
        print(f"    {sk}: {len(sub):,} shots | {sub['is_goal'].sum()} goals "
              f"({sub['is_goal'].mean()*100:.2f}%)")

    # ── Step 2: Feature engineering ──────────────────────────────────────────
    print("\nStep 2 — Feature engineering")
    shots_df = engineer_features(shots_df)
    print(f"  Features added. Shape: {shots_df.shape}")
    for bucket in ['5v5', 'PP', 'PK']:
        sub = shots_df[shots_df['strength_bucket'] == bucket]
        print(f"  {bucket}: {len(sub):,} shots  ({sub['is_goal'].mean()*100:.2f}% goals)")

    # ── Step 3: Train models ──────────────────────────────────────────────────
    print("\nStep 3 — Train XGBoost models")
    print("-" * 40)
    models = train_models(shots_df)

    # ── Step 4: Validate ──────────────────────────────────────────────────────
    validate_models(shots_df, models)

    # ── Step 5: Update stints ─────────────────────────────────────────────────
    update_stints_xg(models)

    # ── Step 6: Reminder ──────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("Step 6 — Re-run RAPM and ratings")
    print("=" * 60)
    print("""
Next commands to run:
    python3 build_rapm.py
    python3 compute_ratings.py

Compare new leaderboard to current:
  Current top-4: Raddysh D #1 (94.6), MacKinnon C #2 (92.7),
                 McDavid C #3 (92.6), Kucherov R #4 (91.1)
""")
