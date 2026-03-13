#!/usr/bin/env python3
"""Extended shot diagnostics — correct distance, game coverage, coord sanity."""
import pandas as pd
import numpy as np
import os, json

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
csv_path = os.path.join(DATA_DIR, "shots_all_seasons.csv")

df = pd.read_csv(csv_path)

# --- A. Correct distance (abs(x)-89 formula, same as engineer_features) ---
print("=== A. CORRECT DISTANCE: sqrt((abs(x)-89)^2 + y^2) ===")
df['ax'] = df['x_coord'].abs()
df['dist_from_net'] = np.sqrt((df['ax'] - 89)**2 + df['y_coord']**2)
d = df['dist_from_net']
print(f"  Min: {d.min():.1f}  Max: {d.max():.1f}  Mean: {d.mean():.1f}  Median: {d.median():.1f}")
pct_gt80 = (d > 80).mean() * 100
pct_gt60 = (d > 60).mean() * 100
pct_lt20 = (d < 20).mean() * 100
print(f"  <20ft: {pct_lt20:.1f}%  |  >60ft: {pct_gt60:.1f}%  |  >80ft (beyond center): {pct_gt80:.1f}%")

# --- B. Defensive-zone shots (ax < 25 = shooting from own zone) ---
print("\n=== B. SHOTS FROM 'WRONG ZONE' (abs(x) < 25, i.e., neutral/defensive) ===")
wrong_zone = df['ax'] < 25
print(f"  abs(x_coord) < 25: {wrong_zone.sum():,} shots ({wrong_zone.mean()*100:.1f}%)")
if wrong_zone.sum() > 0:
    wr = df[wrong_zone]
    print(f"  Goal rate in wrong-zone shots: {wr['is_goal'].mean()*100:.2f}%")
    print(f"  Sample x_coord values: {sorted(df.loc[wrong_zone,'x_coord'].sample(min(10,wrong_zone.sum())).tolist())}")

# --- C. Goal rate by CORRECT distance bucket ---
print("\n=== C. GOAL RATE BY CORRECT DISTANCE BUCKET ===")
bins   = [0, 10, 20, 30, 40, 60, 80, 200]
labels = ['0-10ft','10-20ft','20-30ft','30-40ft','40-60ft','60-80ft','80+ft']
df['dist_bucket'] = pd.cut(df['dist_from_net'], bins=bins, labels=labels)
gr = df.groupby('dist_bucket', observed=True)['is_goal'].agg(['sum','count','mean'])
gr.columns = ['Goals','Shots','GoalRate']
gr['GoalRate%'] = (gr['GoalRate']*100).round(2)
print(gr[['Shots','Goals','GoalRate%']].to_string())
# Sanity check
first3 = gr['GoalRate'].iloc[:3].tolist()
if not all(first3[i] >= first3[i+1] for i in range(len(first3)-1)):
    print("  *** WARNING: goal rate not monotonically decreasing at close range ***")
else:
    print("  ✓ Goal rate decreases with distance (expected)")

# --- D. Game coverage per season ---
print("\n=== D. GAME COVERAGE BY SEASON ===")
for season_key, ids_file in [
    ('23-24', os.path.join(DATA_DIR, 'game_ids_2324.json')),
    ('24-25', os.path.join(DATA_DIR, 'game_ids_2425.json')),
    ('25-26', os.path.join(DATA_DIR, 'game_ids_2526.json')),
]:
    sub = df[df['season'] == season_key]
    shots_games = sub['game_id'].nunique()
    if os.path.exists(ids_file):
        with open(ids_file) as f:
            ids = json.load(f)
        total_games = len(ids)
        pct = shots_games / total_games * 100
        print(f"  {season_key}: {shots_games:,}/{total_games:,} games have shots ({pct:.1f}%)")
    else:
        print(f"  {season_key}: {shots_games:,} games | {ids_file} not found")

# --- E. Period direction check (are home-team shots in period 1 skewed toward +x?) ---
print("\n=== E. PERIOD DIRECTION CHECK ===")
for period in [1, 2, 3]:
    sub = df[df['period'] == period]
    home = sub[sub['is_home'] == 1]
    away = sub[sub['is_home'] == 0]
    home_pos = (home['x_coord'] > 0).mean() * 100
    away_pos = (away['x_coord'] > 0).mean() * 100
    print(f"  Period {period}: home shots with x>0: {home_pos:.1f}%  |  away shots with x>0: {away_pos:.1f}%")
    if period in [1, 3]:
        if home_pos > 65:
            print(f"    ✓ Period {period}: home attacking +x direction (expected)")
        else:
            print(f"    *** WARNING: Period {period} home team not clearly attacking +x direction ***")
    elif period == 2:
        if home_pos < 35:
            print(f"    ✓ Period {period}: home attacking -x direction (expected)")
        else:
            print(f"    *** WARNING: Period {period} home team not clearly attacking -x direction ***")

# --- F. Are coordinates already normalized? (look at period 1 vs period 2 distribution) ---
print("\n=== F. NORMALIZED vs RAW (x distribution by period for home team) ===")
home_p1 = df[(df['period']==1) & (df['is_home']==1)]['x_coord']
home_p2 = df[(df['period']==2) & (df['is_home']==1)]['x_coord']
print(f"  Home period 1 — median x: {home_p1.median():.1f}  (if normalized toward +x → should be >50)")
print(f"  Home period 2 — median x: {home_p2.median():.1f}  (if raw → should be ~negative of period 1)")
print(f"  Home period 1 — % positive: {(home_p1>0).mean()*100:.1f}%")
print(f"  Home period 2 — % positive: {(home_p2>0).mean()*100:.1f}%")

print("\n=== DONE ===")
