#!/usr/bin/env python3
"""Diagnose shot data quality in shots_all_seasons.csv before retraining xG model."""
import pandas as pd
import numpy as np
import os

csv_path = os.path.join(os.path.dirname(__file__), "data", "shots_all_seasons.csv")
print(f"Loading {csv_path}...")
df = pd.read_csv(csv_path)

# 1. Shape
print("\n=== 1. SHAPE ===")
print(f"Total rows: {len(df):,}")
print(f"Columns: {list(df.columns)}")
if 'is_goal' in df.columns:
    goals = df['is_goal'].sum()
    saves = len(df) - goals
    print(f"Goals: {int(goals):,}  |  Saves: {int(saves):,}  |  Goal rate: {goals/len(df)*100:.2f}%")
elif 'goal' in df.columns:
    goals = df['goal'].sum()
    saves = len(df) - goals
    print(f"Goals: {int(goals):,}  |  Saves: {int(saves):,}  |  Goal rate: {goals/len(df)*100:.2f}%")
else:
    print("WARNING: No 'is_goal' or 'goal' column found!")
    print("Columns with 'goal' in name:", [c for c in df.columns if 'goal' in c.lower()])

# 2. Null coordinates
print("\n=== 2. NULL COORDINATES ===")
for col in ['x_coord', 'y_coord', 'x', 'y', 'xC', 'yC', 'x_fixed', 'y_fixed']:
    if col in df.columns:
        nulls = df[col].isna().sum()
        print(f"  {col}: {nulls:,} nulls ({nulls/len(df)*100:.1f}%)")

# 3. Distance distribution
print("\n=== 3. DISTANCE DISTRIBUTION ===")
dist_col = None
for c in ['distance', 'shot_distance', 'dist']:
    if c in df.columns:
        dist_col = c
        break
if dist_col:
    d = df[dist_col].dropna()
    print(f"  Column: {dist_col}")
    print(f"  Min: {d.min():.1f}  Max: {d.max():.1f}  Mean: {d.mean():.1f}  Median: {d.median():.1f}")
    if d.median() > 60:
        print("  *** WARNING: Median > 60ft — likely coordinate normalization issue! ***")
    pct_gt100 = (d > 100).mean() * 100
    pct_neg = (d < 0).mean() * 100
    print(f"  > 100ft: {pct_gt100:.1f}%  |  Negative: {pct_neg:.1f}%")
else:
    print("  No distance column found. Checking for coord columns to compute...")
    for xc, yc in [('x_coord','y_coord'), ('x','y'), ('xC','yC')]:
        if xc in df.columns and yc in df.columns:
            d = np.sqrt(df[xc]**2 + df[yc]**2).dropna()
            print(f"  Computed from {xc}/{yc}: Min={d.min():.1f} Max={d.max():.1f} Mean={d.mean():.1f} Median={d.median():.1f}")
            if d.median() > 60:
                print("  *** WARNING: Median > 60ft ***")
            break

# 4. Shot counts by season
print("\n=== 4. SHOTS BY SEASON ===")
for sc in ['season', 'Season', 'game_season']:
    if sc in df.columns:
        print(df[sc].value_counts().sort_index().to_string())
        break
else:
    print("  No season column found")

# 5. Goal rate by distance bucket
print("\n=== 5. GOAL RATE BY DISTANCE BUCKET ===")
goal_col = None
for gc in ['is_goal', 'goal']:
    if gc in df.columns:
        goal_col = gc
        break

if dist_col and goal_col:
    bins = [0, 10, 20, 30, 40, 60, 200]
    labels = ['0-10ft', '10-20ft', '20-30ft', '30-40ft', '40-60ft', '60+ft']
    tmp = df[[dist_col, goal_col]].dropna()
    tmp['bucket'] = pd.cut(tmp[dist_col], bins=bins, labels=labels)
    gr = tmp.groupby('bucket', observed=True)[goal_col].agg(['sum','count','mean'])
    gr.columns = ['Goals', 'Shots', 'GoalRate']
    gr['GoalRate%'] = (gr['GoalRate'] * 100).round(2)
    print(gr[['Shots','Goals','GoalRate%']].to_string())
    # Sanity check: close shots should have higher rate
    if len(gr) >= 2:
        first_rate = gr['GoalRate'].iloc[0]
        last_rate = gr['GoalRate'].iloc[-1]
        if first_rate < last_rate:
            print("  *** WARNING: Close shots have LOWER goal rate than far shots — normalization problem! ***")
elif not dist_col:
    print("  Skipped (no distance column)")
else:
    print("  Skipped (no goal column)")

# 6. Missing shot_type
print("\n=== 6. MISSING SHOT TYPE ===")
for stc in ['shot_type', 'shotType', 'event']:
    if stc in df.columns:
        nulls = df[stc].isna().sum()
        print(f"  {stc}: {nulls:,} nulls ({nulls/len(df)*100:.1f}%)")
        print(f"  Top values: {df[stc].value_counts().head(8).to_dict()}")
        break
else:
    print("  No shot_type column found")

# 7. First 10 rows
print("\n=== 7. FIRST 10 ROWS ===")
pd.set_option('display.max_columns', None)
pd.set_option('display.width', 200)
print(df.head(10).to_string())

# 8. x_coord distribution
print("\n=== 8. X_COORD DISTRIBUTION ===")
for xc in ['x_coord', 'x', 'xC', 'x_fixed']:
    if xc in df.columns:
        x = df[xc].dropna()
        print(f"  Column: {xc}")
        print(f"  Min: {x.min():.1f}  Max: {x.max():.1f}  Mean: {x.mean():.1f}  Median: {x.median():.1f}")
        pct_pos = (x > 0).mean() * 100
        pct_neg = (x < 0).mean() * 100
        pct_zero = (x == 0).mean() * 100
        print(f"  Positive: {pct_pos:.1f}%  |  Negative: {pct_neg:.1f}%  |  Zero: {pct_zero:.1f}%")
        if pct_pos > 90 or pct_neg > 90:
            print("  *** LOOKS NORMALIZED (all one direction) ***")
        else:
            print("  *** RAW (both +/-) — may need normalization to attacking direction ***")
        # Quartiles
        print(f"  Quartiles: {x.quantile([0.1,0.25,0.5,0.75,0.9]).round(1).to_dict()}")
        break
else:
    print("  No x coordinate column found")

print("\n=== DONE ===")
