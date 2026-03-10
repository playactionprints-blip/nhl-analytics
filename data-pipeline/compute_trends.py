#!/usr/bin/env python3
"""
Compute per-season ratings for each of the 3 seasons independently, then
upload as ratings_trend JSON array to players.ratings_trend.

Format: [{"season":"23-24","off":82,"def":61,"overall":74}, ...]
"""
import pandas as pd
import os
import math
from collections import defaultdict
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

SEASONS    = ['23-24', '24-25', '25-26']  # chronological for trend display
MIN_GP     = 15   # lower threshold for single-season view


def safe(v):
    if v is None: return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except: return None


def pct_rank(series):
    return series.rank(pct=True, na_option='keep') * 100


def compute_group(subdf, is_defense):
    subdf = subdf.copy()

    OFF_WEIGHTS = {
        'ixg_60':  0.35,
        'a1_60':   0.25,
        'pts_60':  0.20,
        'icf_60':  0.10,
        'xgf_pct': 0.10,
    }
    for col in OFF_WEIGHTS:
        if col in subdf.columns:
            subdf[f'op_{col}'] = pct_rank(subdf[col])

    def weighted_off(row):
        total_w, total_v = 0.0, 0.0
        for col, w in OFF_WEIGHTS.items():
            v = row.get(f'op_{col}')
            if pd.notna(v):
                total_v += v * w
                total_w += w
        return round(total_v / total_w, 1) if total_w > 0 else None

    subdf['off_rating'] = subdf.apply(weighted_off, axis=1)

    subdf['gva_inv'] = subdf['gva_60'] * -1
    DEF_WEIGHTS = {
        'xgf_pct':  0.30,
        'hdcf_pct': 0.30,
        'cf_pct':   0.15,
        'tka_60':   0.15,
        'gva_inv':  0.10,
    }
    for col in DEF_WEIGHTS:
        if col in subdf.columns:
            subdf[f'dp_{col}'] = pct_rank(subdf[col])

    def weighted_def(row):
        total_w, total_v = 0.0, 0.0
        for col, w in DEF_WEIGHTS.items():
            v = row.get(f'dp_{col}')
            if pd.notna(v):
                total_v += v * w
                total_w += w
        return round(total_v / total_w, 1) if total_w > 0 else None

    subdf['def_rating'] = subdf.apply(weighted_def, axis=1)

    fo_bonus = pd.Series(0.0, index=subdf.index)
    if 'fo_pct' in subdf.columns:
        fo_ranked = pct_rank(subdf['fo_pct']) / 100 * 3
        fo_bonus  = fo_ranked.where(subdf['position'] == 'C', 0.0).fillna(0.0)

    if is_defense:
        subdf['overall_rating'] = (subdf['off_rating'] * 0.45 + subdf['def_rating'] * 0.55 + fo_bonus).round(1)
    else:
        subdf['overall_rating'] = (subdf['off_rating'] * 0.65 + subdf['def_rating'] * 0.35 + fo_bonus).round(1)

    return subdf


# ── Fetch data (per season to avoid 1000-row limit) ──────────────────────────
print("Fetching player_seasons...")
COLS = 'player_id,season,gp,toi,g,a1,a2,ixg,icf,tka,gva,xgf_pct,hdcf_pct,cf_pct,fow,fol'
ps_rows = []
for s in SEASONS:
    batch = sb.table('player_seasons').select(COLS).eq('season', s).execute().data
    ps_rows.extend(batch)
    print(f"  {s}: {len(batch)} rows")
print(f"  Total: {len(ps_rows)} rows")

player_info = {p['player_id']: p for p in
               sb.table('players').select('player_id,full_name,position').execute().data}

rows_by_season = defaultdict(list)
for row in ps_rows:
    rows_by_season[row['season']].append(row)


# ── Compute ratings for each season ──────────────────────────────────────────
season_ratings = {}   # {season: {player_id: {off, def, overall}}}

for season in SEASONS:
    rows = rows_by_season.get(season, [])
    print(f"\nSeason {season}: {len(rows)} rows")

    records = []
    for row in rows:
        pid  = row['player_id']
        info = player_info.get(pid)
        if not info or info['position'] == 'G':
            continue
        gp  = safe(row.get('gp')) or 0
        if gp < MIN_GP:
            continue
        toi = safe(row.get('toi')) or 0
        if toi <= 0:
            continue
        t60 = toi / 60.0

        g   = safe(row.get('g'))   or 0
        a1  = safe(row.get('a1'))  or 0
        a2  = safe(row.get('a2'))  or 0
        ixg = safe(row.get('ixg')) or 0
        icf = safe(row.get('icf')) or 0
        tka = safe(row.get('tka')) or 0
        gva = safe(row.get('gva')) or 0

        fow = safe(row.get('fow'))
        fol = safe(row.get('fol'))
        fo_pct = None
        if fow is not None and fol is not None:
            total_fo = fow + fol
            fo_pct = (fow / total_fo * 100) if total_fo > 20 else None

        records.append({
            'player_id': pid,
            'full_name': info['full_name'],
            'position':  info['position'],
            'goals_60':  round(g   / t60, 4),
            'pts_60':    round((g + a1 + a2) / t60, 4),
            'ixg_60':    round(ixg / t60, 4),
            'a1_60':     round(a1  / t60, 4),
            'icf_60':    round(icf / t60, 4),
            'tka_60':    round(tka / t60, 4),
            'gva_60':    round(gva / t60, 4),
            'xgf_pct':   safe(row.get('xgf_pct')),
            'hdcf_pct':  safe(row.get('hdcf_pct')),
            'cf_pct':    safe(row.get('cf_pct')),
            'fo_pct':    fo_pct,
        })

    if not records:
        print(f"  No qualifying players, skipping")
        continue
    df       = pd.DataFrame(records)
    forwards = compute_group(df[df['position'] != 'D'], is_defense=False)
    defense  = compute_group(df[df['position'] == 'D'], is_defense=True)
    rated    = pd.concat([forwards, defense])
    print(f"  {len(rated)} players rated")

    season_ratings[season] = {}
    for _, row in rated.iterrows():
        off = row.get('off_rating')
        dff = row.get('def_rating')
        ovr = row.get('overall_rating')
        season_ratings[season][row['player_id']] = {
            'off':     int(round(off)) if pd.notna(off) else None,
            'def':     int(round(dff)) if pd.notna(dff) else None,
            'overall': int(round(ovr)) if pd.notna(ovr) else None,
        }


# ── Build trend arrays and upload ────────────────────────────────────────────
all_pids = set()
for d in season_ratings.values():
    all_pids.update(d.keys())

print(f"\nBuilding trends for {len(all_pids)} players...")
updated = skipped = 0

for pid in all_pids:
    trend = []
    for season in SEASONS:   # chronological: 23-24, 24-25, 25-26
        r = season_ratings.get(season, {}).get(pid)
        if r and r['overall'] is not None:
            trend.append({'season': season, 'off': r['off'], 'def': r['def'], 'overall': r['overall']})

    if not trend:
        skipped += 1
        continue

    result = sb.table('players').update({'ratings_trend': trend}).eq('player_id', pid).execute()
    if result.data:
        updated += 1
    else:
        skipped += 1

print(f"Done. Updated: {updated} | Skipped: {skipped}")

# Spot-check a few players
print("\nSpot-check (players with 3-season trends):")
check = sb.table('players').select('full_name,ratings_trend').not_.is_('ratings_trend','null').limit(5).execute()
for p in check.data:
    print(f"  {p['full_name']}: {p['ratings_trend']}")
