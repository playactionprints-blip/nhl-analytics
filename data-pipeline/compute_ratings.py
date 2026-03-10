#!/usr/bin/env python3
"""
Compute 3-year weighted ratings from player_seasons table.
Season weights: 25-26 → 50%,  24-25 → 30%,  23-24 → 20%
Qualify: ≥20 GP in current season  OR  ≥40 GP combined across seasons.
"""
import pandas as pd
import os
import math
from collections import defaultdict
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

SEASON_WEIGHTS = {'25-26': 0.50, '24-25': 0.30, '23-24': 0.20}
CURRENT_SEASON  = '25-26'

# ── Fetch data ────────────────────────────────────────────────────────────────
print("Fetching player_seasons...")
ps_rows = sb.table('player_seasons').select(
    'player_id,season,gp,toi,g,a1,a2,ixg,icf,tka,gva,xgf_pct,hdcf_pct,cf_pct,scf_pct,fow,fol'
).execute().data
print(f"  {len(ps_rows)} season rows")

print("Fetching players...")
player_info = {p['player_id']: p for p in
               sb.table('players').select('player_id,full_name,position').execute().data}


def safe(v):
    if v is None: return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except: return None


# ── Build per-player weighted stats ──────────────────────────────────────────
seasons_by_player = defaultdict(dict)
for row in ps_rows:
    pid = row['player_id']
    info = player_info.get(pid)
    if info and info['position'] != 'G':
        seasons_by_player[pid][row['season']] = row

records = []
for pid, season_data in seasons_by_player.items():
    info   = player_info[pid]
    pos    = info['position']

    # Qualification
    curr_gp  = safe(season_data.get(CURRENT_SEASON, {}).get('gp')) or 0
    total_gp = sum((safe(s.get('gp')) or 0) for s in season_data.values())
    if curr_gp < 20 and total_gp < 40:
        continue

    # Accumulators for weighted raw stats
    w_toi60 = 0.0
    w_g = w_a1 = w_ixg = w_icf = w_tka = w_gva = w_pts = 0.0
    xgf_n = hdcf_n = cf_n = 0.0
    xgf_d = hdcf_d = cf_d = 0.0

    for season_key, row in season_data.items():
        w   = SEASON_WEIGHTS.get(season_key, 0.0)
        toi = safe(row.get('toi')) or 0
        if toi <= 0:
            continue
        t60 = toi / 60.0

        w_toi60 += w * t60
        w_g     += w * (safe(row.get('g'))   or 0)
        w_a1    += w * (safe(row.get('a1'))  or 0)
        w_ixg   += w * (safe(row.get('ixg')) or 0)
        w_icf   += w * (safe(row.get('icf')) or 0)
        w_tka   += w * (safe(row.get('tka')) or 0)
        w_gva   += w * (safe(row.get('gva')) or 0)
        a2       = safe(row.get('a2')) or 0
        w_pts   += w * ((safe(row.get('g')) or 0) + (safe(row.get('a1')) or 0) + a2)

        # TOI-weighted on-ice percentage stats
        xgf = safe(row.get('xgf_pct'))
        if xgf is not None:
            xgf_n += w * t60 * xgf
            xgf_d += w * t60

        hdcf = safe(row.get('hdcf_pct'))
        if hdcf is not None:
            hdcf_n += w * t60 * hdcf
            hdcf_d += w * t60

        cf = safe(row.get('cf_pct'))
        if cf is not None:
            cf_n += w * t60 * cf
            cf_d += w * t60

    if w_toi60 <= 0:
        continue

    # FO% from current season only
    curr = season_data.get(CURRENT_SEASON, {})
    fow  = safe(curr.get('fow'))
    fol  = safe(curr.get('fol'))
    fo_pct = None
    if fow is not None and fol is not None:
        total_fo = fow + fol
        fo_pct   = (fow / total_fo * 100) if total_fo > 20 else None

    records.append({
        'player_id': pid,
        'full_name': info['full_name'],
        'position':  pos,
        'goals_60':  round(w_g    / w_toi60, 4),
        'pts_60':    round(w_pts  / w_toi60, 4),
        'ixg_60':    round(w_ixg  / w_toi60, 4),
        'a1_60':     round(w_a1   / w_toi60, 4),
        'icf_60':    round(w_icf  / w_toi60, 4),
        'tka_60':    round(w_tka  / w_toi60, 4),
        'gva_60':    round(w_gva  / w_toi60, 4),
        'xgf_pct':   round(xgf_n  / xgf_d,  4) if xgf_d  > 0 else None,
        'hdcf_pct':  round(hdcf_n / hdcf_d, 4) if hdcf_d > 0 else None,
        'cf_pct':    round(cf_n   / cf_d,   4) if cf_d   > 0 else None,
        'fo_pct':    fo_pct,
    })

df = pd.DataFrame(records)
print(f"Processing {len(df)} qualified skaters (3-season weighted)")


# ── Rating computation ────────────────────────────────────────────────────────
def pct_rank(series):
    return series.rank(pct=True, na_option='keep') * 100


def compute_group(subdf, is_defense):
    subdf = subdf.copy()

    # Offensive rating — ixG/60 35%, A1/60 25%, Pts/60 20%, iCF/60 10%, xGF% 10%
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

    # Defensive rating — xGF% 30%, HDCF% 30%, CF% 15%, TKA/60 15%, GVA/60 inv 10%
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

    # Faceoff bonus for centers (max +3)
    fo_bonus = pd.Series(0.0, index=subdf.index)
    if 'fo_pct' in subdf.columns:
        fo_ranked = pct_rank(subdf['fo_pct']) / 100 * 3
        fo_bonus  = fo_ranked.where(subdf['position'] == 'C', 0.0).fillna(0.0)

    # Overall
    if is_defense:
        subdf['overall_rating'] = (subdf['off_rating'] * 0.45 + subdf['def_rating'] * 0.55 + fo_bonus).round(1)
    else:
        subdf['overall_rating'] = (subdf['off_rating'] * 0.65 + subdf['def_rating'] * 0.35 + fo_bonus).round(1)

    return subdf


forwards = compute_group(df[df['position'] != 'D'], is_defense=False)
defense  = compute_group(df[df['position'] == 'D'], is_defense=True)
final    = pd.concat([forwards, defense])

print(f"Ratings computed for {len(final)} players")

# ── Leaderboards ──────────────────────────────────────────────────────────────
print("\n--- TOP 15 OVERALL ---")
print(final[['full_name','position','off_rating','def_rating','overall_rating']]
      .sort_values('overall_rating', ascending=False).head(15).to_string())

print("\n--- TOP 10 OFFENSIVE FORWARDS ---")
fwds = final[final['position'].isin(['C','L','R'])]
print(fwds[['full_name','position','off_rating','ixg_60','a1_60','pts_60']]
      .sort_values('off_rating', ascending=False).head(10).to_string())

print("\n--- TOP 10 DEFENSIVE DEFENSEMEN ---")
dmen = final[final['position'] == 'D']
print(dmen[['full_name','position','def_rating','xgf_pct','hdcf_pct','cf_pct']]
      .sort_values('def_rating', ascending=False).head(10).to_string())

# ── Upload to players table ───────────────────────────────────────────────────
updated = 0
skipped = 0

for _, row in final.iterrows():
    off = row.get('off_rating')
    dff = row.get('def_rating')
    ovr = row.get('overall_rating')

    if pd.isna(off) and pd.isna(dff):
        skipped += 1
        continue

    data = {
        'off_rating':     None if pd.isna(off) else float(off),
        'def_rating':     None if pd.isna(dff) else float(dff),
        'overall_rating': None if pd.isna(ovr) else float(ovr),
    }
    result = sb.table('players').update(data).eq('player_id', row['player_id']).execute()
    if result.data:
        updated += 1
    else:
        skipped += 1

print(f"\nDone. Updated: {updated} | Skipped: {skipped}")
