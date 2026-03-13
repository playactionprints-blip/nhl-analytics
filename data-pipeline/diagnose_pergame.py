#!/usr/bin/env python3
"""
Test per-game coordinate normalization — detect attacking direction from zone shots.
Each game-period-team gets its own attack direction via majority vote of abs(x)>50 shots.
"""
import pandas as pd
import numpy as np

DATA_DIR = "/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data"
raw = pd.read_csv(f"{DATA_DIR}/shots_all_seasons.csv")
print(f"Total rows: {len(raw):,}\n")

# ── Per-game direction detection ──────────────────────────────────────────────
zone = raw[raw['x_coord'].abs() > 50][['game_id','period','is_home','x_coord']].copy()
zone['is_pos'] = (zone['x_coord'] > 0).astype(int)
zone['is_neg'] = (zone['x_coord'] < 0).astype(int)
agg = zone.groupby(['game_id','period','is_home'])[['is_pos','is_neg']].sum().reset_index()
agg['attack_sign'] = np.where(agg['is_pos'] > agg['is_neg'],  1,
                    np.where(agg['is_neg'] > agg['is_pos'], -1, 0))

# Coverage stats
n_combos    = len(agg)
n_pos       = (agg['attack_sign'] ==  1).sum()
n_neg       = (agg['attack_sign'] == -1).sum()
n_unknown   = (agg['attack_sign'] ==  0).sum()
print("=== 1. DIRECTION DETECTION COVERAGE ===")
print(f"  Game-period-team combos: {n_combos:,}")
print(f"  Attacks +x: {n_pos:,} ({n_pos/n_combos*100:.1f}%)")
print(f"  Attacks -x: {n_neg:,} ({n_neg/n_combos*100:.1f}%)")
print(f"  Unknown:    {n_unknown:,} ({n_unknown/n_combos*100:.1f}%)")

# Within each game+period, do home and away attack opposite directions?
per_game = agg.pivot_table(
    index=['game_id','period'], columns='is_home', values='attack_sign')
per_game.columns = ['away_sign','home_sign']
per_game = per_game.dropna()
opposite = (per_game['home_sign'] != 0) & (per_game['away_sign'] != 0) & \
           (per_game['home_sign'] == -per_game['away_sign'])
same     = (per_game['home_sign'] != 0) & (per_game['away_sign'] != 0) & \
           (per_game['home_sign'] == per_game['away_sign'])
print(f"\n  Game-periods where home/away attack opposite: {opposite.sum():,} / {len(per_game):,} ({opposite.mean()*100:.1f}%)")
print(f"  Game-periods where home/away attack SAME dir: {same.sum():,} (should be 0)")
print()

# ── Apply per-game normalization ──────────────────────────────────────────────
df = raw.merge(agg[['game_id','period','is_home','attack_sign']],
               on=['game_id','period','is_home'], how='left')
df['attack_sign'] = df['attack_sign'].fillna(0).astype(int)

x = df['x_coord'].astype(float)
x_norm = np.where(df['attack_sign'] ==  1, x,
         np.where(df['attack_sign'] == -1, -x, x.abs()))
df['x_normalized'] = x_norm
y = df['y_coord'].astype(float)
df['distance'] = np.sqrt((x_norm - 89)**2 + y**2)

# Noise filter
df_f = df[(df['distance'] <= 80) & (df['distance'] >= 1) & (df['x_coord'].abs() >= 25)].copy()
print(f"=== 2. AFTER NOISE FILTER ===")
print(f"  Rows kept: {len(df_f):,} ({len(df_f)/len(raw)*100:.1f}%)")
goals = df_f[df_f['is_goal'] == 1]
saves = df_f[df_f['is_goal'] == 0]
print(f"  Goal dist: mean={goals['distance'].mean():.1f}ft  median={goals['distance'].median():.1f}ft  n={len(goals):,}")
print(f"  Save dist: mean={saves['distance'].mean():.1f}ft  median={saves['distance'].median():.1f}ft  n={len(saves):,}")
print()

# ── Goal rate by distance ─────────────────────────────────────────────────────
print("=== 3. GOAL RATE BY DISTANCE (per-game normalization) ===")
bins   = [0, 10, 15, 20, 30, 40, 60, 80]
labels = ['0-10ft','10-15ft','15-20ft','20-30ft','30-40ft','40-60ft','60-80ft']
df_f = df_f.copy()
df_f['bucket'] = pd.cut(df_f['distance'], bins=bins, labels=labels)
gr = df_f.groupby('bucket', observed=True)['is_goal'].agg(['sum','count','mean'])
gr.columns = ['Goals','Shots','GoalRate']
gr['GoalRate%'] = (gr['GoalRate']*100).round(2)
print(gr[['Shots','Goals','GoalRate%']].to_string())
rates = gr['GoalRate'].tolist()
monotone = all(rates[i] >= rates[i+1] for i in range(len(rates)-1))
print(f"\nMonotonically decreasing: {'YES ✓' if monotone else 'NO'}")
close_rate = gr.loc['0-10ft','GoalRate']
med_rate   = gr.loc['30-40ft','GoalRate']
ratio = close_rate / med_rate if med_rate > 0 else 0
print(f"0-10ft rate: {close_rate*100:.1f}%  |  30-40ft rate: {med_rate*100:.1f}%  |  ratio: {ratio:.1f}x  (real NHL: 5-8x)")
print()

# ── Baseline AUC ─────────────────────────────────────────────────────────────
print("=== 4. BASELINE AUC — DIST+ANGLE ONLY (per-game normalization) ===")
try:
    from xgboost import XGBClassifier
    from sklearn.metrics import roc_auc_score

    df_f['angle'] = np.degrees(np.arctan2(
        df_f['y_coord'].astype(float).abs(),
        (df_f['x_normalized'] - 89).abs().clip(lower=0.1)
    ))

    fv = df_f[df_f['game_strength'] == '5v5']
    train = fv[fv['season'].isin(['23-24','24-25'])]
    test  = fv[fv['season'] == '25-26']
    print(f"  5v5 — Train: {len(train):,}  Test: {len(test):,}")

    X_tr = train[['distance','angle']].astype(float)
    y_tr = train['is_goal'].astype(int)
    X_te = test[['distance','angle']].astype(float)
    y_te = test['is_goal'].astype(int)

    scale_pw = (y_tr==0).sum() / max((y_tr==1).sum(),1)
    m = XGBClassifier(n_estimators=200, max_depth=4, learning_rate=0.05,
                      scale_pos_weight=scale_pw, use_label_encoder=False,
                      eval_metric='auc', random_state=42, n_jobs=-1)
    m.fit(X_tr, y_tr, eval_set=[(X_te, y_te)], verbose=False)
    auc = roc_auc_score(y_te, m.predict_proba(X_te)[:,1])
    print(f"\n  AUC dist+angle (per-game): {auc:.4f}  (baseline benchmark: 0.68-0.70)")
    if auc >= 0.66:
        print("  ✓ Per-game normalization WORKING — distance signal restored")
    elif auc > 0.59:
        print("  IMPROVEMENT over 0.5479 — partial fix, more investigation needed")
    else:
        print("  *** Still broken — coordinate data may have deeper quality issues ***")
except Exception as e:
    print(f"  Error: {e}")

print("\n=== DONE ===")
