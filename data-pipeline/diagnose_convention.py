#!/usr/bin/env python3
"""
Empirically determine the correct x-coordinate convention for hockey-scraper data.
Key question: in period 1, does the home team attack toward +x or -x?
"""
import pandas as pd
import numpy as np

DATA_DIR = "/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data"
df = pd.read_csv(f"{DATA_DIR}/shots_all_seasons.csv")

print(f"Total rows: {len(df):,}\n")

# ── Test 1: For period 1 GOALS, what is median x_coord by team direction? ────
print("=== 1. MEDIAN X_COORD OF GOALS BY PERIOD × TEAM (raw coords, no normalization) ===")
print("    If home attacks +x: home goal median should be near +80-89")
print("    If home attacks -x: home goal median should be near -80-89\n")

for period in [1, 2, 3]:
    sub = df[(df['period'] == period) & (df['is_goal'] == 1)]
    home_goals = sub[sub['is_home'] == 1]['x_coord']
    away_goals = sub[sub['is_home'] == 0]['x_coord']
    print(f"  Period {period}:")
    print(f"    HOME goals — n={len(home_goals):,}  median x={home_goals.median():+.1f}  "
          f"mean x={home_goals.mean():+.1f}  pct(x<0)={( home_goals<0).mean()*100:.1f}%")
    print(f"    AWAY goals — n={len(away_goals):,}  median x={away_goals.median():+.1f}  "
          f"mean x={away_goals.mean():+.1f}  pct(x<0)={(away_goals<0).mean()*100:.1f}%")
print()

# ── Test 2: For period 1 goals, how many are near each net? ──────────────────
print("=== 2. PERIOD 1 GOALS: DISTANCE FROM EACH NET ===")
p1_goals = df[(df['period'] == 1) & (df['is_goal'] == 1)]
p1_home  = p1_goals[p1_goals['is_home'] == 1]
p1_away  = p1_goals[p1_goals['is_home'] == 0]

for label, sub in [("HOME goals p1", p1_home), ("AWAY goals p1", p1_away)]:
    x = sub['x_coord']
    dist_pos = np.sqrt((x - 89)**2 + sub['y_coord']**2)   # distance from net at x=+89
    dist_neg = np.sqrt((x + 89)**2 + sub['y_coord']**2)   # distance from net at x=-89
    closer_to_pos = (dist_pos < dist_neg).mean() * 100
    closer_to_neg = (dist_neg < dist_pos).mean() * 100
    print(f"  {label}: n={len(sub):,}")
    print(f"    Closer to +89 net: {closer_to_pos:.1f}%  |  Closer to -89 net: {closer_to_neg:.1f}%")
    print(f"    (attacking toward +89 → closer to +89 should be ~80%+)")
print()

# ── Test 3: Try BOTH normalization conventions and check goal distance ─────────
print("=== 3. TRY BOTH CONVENTIONS — WHICH GIVES REALISTIC GOAL DISTANCES? ===")

for convention, label in [
    ("home_attacks_neg_in_odd", "HOME attacks -x in ODD periods (H1=-x, H2=+x, H3=-x)"),
    ("home_attacks_pos_in_odd", "HOME attacks +x in ODD periods (H1=+x, H2=-x, H3=+x)  [CURRENT]"),
]:
    raw = pd.read_csv(f"{DATA_DIR}/shots_all_seasons.csv")
    x = raw['x_coord'].astype(float).values.copy()
    period = raw['period'].values
    is_home = raw['is_home'].values

    if convention == "home_attacks_neg_in_odd":
        # Home attacks -x in odd → flip home in odd periods → makes them attack +x
        # Away attacks +x in odd → no flip
        # Flip when: (is_odd AND is_home) OR (is_even AND is_away)
        is_odd = period % 2 == 1
        flip = (is_odd & (is_home == 1)) | (~is_odd & (is_home == 0))
    else:
        # Home attacks +x in odd → already correct → flip away in odd, flip home in even
        # Flip when: (is_odd AND is_away) OR (is_even AND is_home)
        is_odd = period % 2 == 1
        flip = (is_odd & (is_home == 0)) | (~is_odd & (is_home == 1))

    x_norm = np.where(flip, -x, x)
    raw['x_norm'] = x_norm
    dist = np.sqrt((x_norm - 89)**2 + raw['y_coord'].astype(float)**2)
    raw['dist'] = dist

    # Apply same noise filter as current code
    filt = raw[(dist <= 80) & (dist >= 1) & (raw['x_coord'].abs() >= 25)].copy()
    goals = filt[filt['is_goal'] == 1]
    saves = filt[filt['is_goal'] == 0]

    print(f"\n  Convention: {label}")
    print(f"  After filter: {len(filt):,} shots ({len(filt)/len(raw)*100:.1f}% kept)")
    print(f"  Goal dist: mean={goals['dist'].mean():.1f}ft  median={goals['dist'].median():.1f}ft")
    print(f"  Save dist: mean={saves['dist'].mean():.1f}ft  median={saves['dist'].median():.1f}ft")
    print(f"  x_norm for goals: % >=75: {(goals['x_norm']>=75).mean()*100:.1f}%  "
          f"% <0: {(goals['x_norm']<0).mean()*100:.1f}%")

    # Goal rate at 0-15ft vs 40-60ft
    close  = filt[filt['dist'] <= 15]
    medium = filt[(filt['dist'] > 30) & (filt['dist'] <= 50)]
    if len(close) > 0 and len(medium) > 0:
        close_rate  = close['is_goal'].mean() * 100
        medium_rate = medium['is_goal'].mean() * 100
        ratio = close_rate / medium_rate if medium_rate > 0 else 0
        print(f"  Goal rate 0-15ft: {close_rate:.1f}%  |  30-50ft: {medium_rate:.1f}%  "
              f"|  ratio: {ratio:.1f}x  (real NHL: ~5-8x ratio)")

print()

# ── Test 4: Quick baseline AUC with CORRECT convention ───────────────────────
print("=== 4. BASELINE AUC — HOME ATTACKS -X IN ODD PERIODS (corrected) ===")
try:
    from xgboost import XGBClassifier
    from sklearn.metrics import roc_auc_score

    raw = pd.read_csv(f"{DATA_DIR}/shots_all_seasons.csv")
    x = raw['x_coord'].astype(float).values.copy()
    is_odd = raw['period'].values % 2 == 1
    ih = raw['is_home'].values
    flip = (is_odd & (ih == 1)) | (~is_odd & (ih == 0))
    x_norm = np.where(flip, -x, x)
    raw['x_norm'] = x_norm
    raw['dist'] = np.sqrt((x_norm - 89)**2 + raw['y_coord'].astype(float)**2)

    filt = raw[(raw['dist'] <= 80) & (raw['dist'] >= 1) & (raw['x_coord'].abs() >= 25)].copy()
    filt['angle'] = np.degrees(np.arctan2(
        raw['y_coord'].abs().reindex(filt.index),
        (filt['x_norm'] - 89).abs().clip(lower=0.1)
    ))
    fv = filt[filt['game_strength'] == '5v5']

    train = fv[fv['season'].isin(['23-24','24-25'])]
    test  = fv[fv['season'] == '25-26']
    print(f"  Train: {len(train):,}  Test: {len(test):,}")

    X_tr = train[['dist','angle']].astype(float)
    y_tr = train['is_goal'].astype(int)
    X_te = test[['dist','angle']].astype(float)
    y_te = test['is_goal'].astype(int)

    scale_pw = (y_tr==0).sum() / max((y_tr==1).sum(),1)
    m = XGBClassifier(n_estimators=200, max_depth=4, learning_rate=0.05,
                      scale_pos_weight=scale_pw, use_label_encoder=False,
                      eval_metric='auc', random_state=42, n_jobs=-1)
    m.fit(X_tr, y_tr, eval_set=[(X_te, y_te)], verbose=False)
    auc = roc_auc_score(y_te, m.predict_proba(X_te)[:,1])
    print(f"  dist+angle AUC (corrected): {auc:.4f}  (target benchmark: 0.68-0.70)")
except Exception as e:
    print(f"  Error: {e}")

print("\n=== DONE ===")
