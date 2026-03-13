#!/usr/bin/env python3
"""Deep diagnostics on engineered features — post-normalization, pre-training."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import numpy as np

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
csv_path = os.path.join(DATA_DIR, "shots_all_seasons.csv")

print(f"Loading {csv_path}...")
raw = pd.read_csv(csv_path)
print(f"Raw rows: {len(raw):,}\n")

# ── Replicate engineer_features normalization inline ──────────────────────────
df = raw.copy()
n_before = len(df)

x = df['x_coord'].astype(float).values.copy()
even_period = (df['period'].values % 2) == 0
x = np.where(even_period, -x, x)
x = np.where(df['is_home'].values == 0, -x, x)
df['x_normalized'] = x
y = df['y_coord'].astype(float)

df['distance']      = np.sqrt((df['x_normalized'] - 89) ** 2 + y ** 2)
df['angle']         = np.degrees(np.arctan2(y.abs(), (df['x_normalized'] - 89).abs().clip(lower=0.1)))
df['is_behind_net'] = (df['x_normalized'] > 89).astype(int)

# Apply noise filter (same as engineer_features)
df = df[df['distance'] <= 80].copy()
df = df[df['distance'] >= 1].copy()
df = df[df['x_coord'].abs() >= 25].copy()
n_after = len(df)
print(f"After noise filter: {n_after:,} rows (removed {n_before-n_after:,})\n")

fv = df[df['game_strength'] == '5v5'].copy()
print(f"5v5 shots for diagnostics: {len(fv):,}\n")

# ── 1. Goal rate by distance bucket (normalized coords) ──────────────────────
print("=== 1. GOAL RATE BY DISTANCE (after normalization) ===")
bins   = [0, 10, 20, 30, 40, 60, 80]
labels = ['0-10ft','10-20ft','20-30ft','30-40ft','40-60ft','60-80ft']
fv_tmp = fv.copy()
fv_tmp['dist_bucket'] = pd.cut(fv_tmp['distance'], bins=bins, labels=labels)
gr = fv_tmp.groupby('dist_bucket', observed=True)['is_goal'].agg(['sum','count','mean'])
gr.columns = ['Goals','Shots','GoalRate']
gr['GoalRate%'] = (gr['GoalRate']*100).round(2)
print(gr[['Shots','Goals','GoalRate%']].to_string())
rates = gr['GoalRate'].tolist()
monotone = all(rates[i] >= rates[i+1] for i in range(len(rates)-1))
print(f"\nMonotonically decreasing: {'YES ✓' if monotone else 'NO ← STILL BROKEN'}\n")

# ── 2. 20 random rows showing x_coord, x_normalized, distance, angle, is_goal ─
print("=== 2. 20 RANDOM 5v5 ROWS (x_coord, x_normalized, distance, angle, is_goal) ===")
sample = fv[['x_coord','x_normalized','distance','angle','is_goal','period','is_home']].sample(20, random_state=42)
print(sample.round(2).to_string())
print()

# ── 3. Average goal distance ──────────────────────────────────────────────────
print("=== 3. AVERAGE GOAL DISTANCE (expect 20-25ft) ===")
goals_only = fv[fv['is_goal'] == 1]
saves_only = fv[fv['is_goal'] == 0]
print(f"  Goals  — mean dist: {goals_only['distance'].mean():.1f}ft  median: {goals_only['distance'].median():.1f}ft  (n={len(goals_only):,})")
print(f"  Saves  — mean dist: {saves_only['distance'].mean():.1f}ft  median: {saves_only['distance'].median():.1f}ft  (n={len(saves_only):,})")
if goals_only['distance'].mean() < 30:
    print("  ✓ Goal distance looks reasonable")
else:
    print("  *** WARNING: Goals averaging far from net — normalization still broken ***")
print()

# ── 4. is_home distribution ───────────────────────────────────────────────────
print("=== 4. IS_HOME DISTRIBUTION (expect ~50%) ===")
home_pct = fv['is_home'].mean() * 100
print(f"  is_home=1: {home_pct:.1f}%  |  is_home=0: {100-home_pct:.1f}%")
print()

# ── 5. Distance-only baseline model ──────────────────────────────────────────
print("=== 5. DISTANCE + ANGLE ONLY BASELINE AUC ===")
try:
    from xgboost import XGBClassifier
    from sklearn.metrics import roc_auc_score

    train = fv[fv['season'].isin(['23-24','24-25'])]
    test  = fv[fv['season'] == '25-26']
    print(f"  Train: {len(train):,}  Test: {len(test):,}")

    X_train = train[['distance','angle']].astype(float)
    y_train = train['is_goal'].astype(int)
    X_test  = test[['distance','angle']].astype(float)
    y_test  = test['is_goal'].astype(int)

    scale_pw = (y_train == 0).sum() / max((y_train == 1).sum(), 1)
    m = XGBClassifier(n_estimators=200, max_depth=4, learning_rate=0.05,
                      scale_pos_weight=scale_pw, use_label_encoder=False,
                      eval_metric='auc', random_state=42, n_jobs=-1)
    m.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)
    auc = roc_auc_score(y_test, m.predict_proba(X_test)[:,1])
    print(f"  Distance+Angle only AUC: {auc:.4f}  (real NHL benchmark: 0.68-0.70)")
    if auc < 0.65:
        print("  *** BELOW BENCHMARK — coordinate data still fundamentally broken ***")
    else:
        print("  ✓ Within expected range for distance+angle baseline")
except ImportError:
    print("  xgboost not available in this environment")
print()

# ── 6. Raw x_coord distribution for goals only ───────────────────────────────
print("=== 6. RAW X_COORD FOR GOALS ONLY (expect cluster near 75-89) ===")
goal_x = fv.loc[fv['is_goal'] == 1, 'x_coord']
print(f"  Min: {goal_x.min():.0f}  Max: {goal_x.max():.0f}  Mean: {goal_x.mean():.1f}  Median: {goal_x.median():.1f}")
pct_high = (goal_x.abs() >= 75).mean() * 100
pct_low  = (goal_x.abs() < 50).mean() * 100
print(f"  abs(x_coord) >= 75 (near net): {pct_high:.1f}%")
print(f"  abs(x_coord) <  50 (far away): {pct_low:.1f}%")
# Distribution of abs(x) for goals
goal_ax = goal_x.abs()
print(f"  abs(x_coord) quartiles: {goal_ax.quantile([0.1,0.25,0.5,0.75,0.9]).round(1).to_dict()}")
print()

# ── 7. x_normalized distribution for goals ───────────────────────────────────
print("=== 7. X_NORMALIZED FOR GOALS (expect cluster near 75-89) ===")
goal_xn = fv.loc[fv['is_goal'] == 1, 'x_normalized']
print(f"  Min: {goal_xn.min():.0f}  Max: {goal_xn.max():.0f}  Mean: {goal_xn.mean():.1f}  Median: {goal_xn.median():.1f}")
pct_high_n = (goal_xn >= 75).mean() * 100
pct_neg_n  = (goal_xn < 0).mean() * 100
print(f"  x_normalized >= 75 (near net): {pct_high_n:.1f}%")
print(f"  x_normalized < 0  (wrong dir): {pct_neg_n:.1f}%  ← should be ~0%")
print(f"  x_normalized quartiles: {goal_xn.quantile([0.1,0.25,0.5,0.75,0.9]).round(1).to_dict()}")
print()

# ── 8. Cross-tab: period vs x_normalized direction ───────────────────────────
print("=== 8. DOES NORMALIZATION ACTUALLY FLIP COORDS? ===")
for period in [1, 2, 3]:
    sub = fv[fv['period'] == period]
    pct_xn_pos = (sub['x_normalized'] > 0).mean() * 100
    pct_xraw_pos = (sub['x_coord'] > 0).mean() * 100
    print(f"  Period {period}: raw x>0 = {pct_xraw_pos:.1f}%  |  x_normalized>0 = {pct_xn_pos:.1f}%")
    print(f"           raw x median = {sub['x_coord'].median():.1f}  |  x_normalized median = {sub['x_normalized'].median():.1f}")

print("\n=== DONE ===")
