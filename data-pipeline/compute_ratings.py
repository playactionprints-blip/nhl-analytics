import pandas as pd, os, math
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

res = sb.table('players').select(
    'player_id,full_name,position,gp,g,a,pts,toi,xgf_pct,hdcf_pct,cf_pct,icf,ixg,tka,gva,fow,fol'
).not_.is_('toi','null').execute()

players = res.data
print(f"Fetched {len(players)} players")

def parse_toi(toi_str):
    try:
        parts = str(toi_str).split(':')
        return int(parts[0]) + int(parts[1]) / 60.0
    except: return None

def safe(val):
    if val is None: return None
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except: return None

rows = []
for p in players:
    pos = p.get('position','')
    if pos == 'G': continue
    gp = safe(p.get('gp')) or 0
    if gp < 20: continue
    avg_toi = parse_toi(p.get('toi'))
    if avg_toi is None or avg_toi < 5: continue

    total_toi = avg_toi * gp
    toi60 = total_toi / 60.0

    g   = safe(p.get('g')) or 0
    pts = safe(p.get('pts')) or 0
    icf = safe(p.get('icf'))
    ixg = safe(p.get('ixg'))
    tka = safe(p.get('tka'))
    gva = safe(p.get('gva'))
    fow = safe(p.get('fow'))
    fol = safe(p.get('fol'))
    a   = safe(p.get('a')) or 0
    # a1 not in Supabase yet; approximate primary assists as 60% of total assists
    a1_approx = a * 0.6

    fo_pct = None
    if fow is not None and fol is not None:
        total_fo = fow + fol
        fo_pct = (fow / total_fo * 100) if total_fo > 20 else None

    rows.append({
        'player_id': p['player_id'],
        'full_name': p['full_name'],
        'position':  pos,
        'goals_60':  round(g   / toi60, 4) if toi60 > 0 else None,
        'pts_60':    round(pts / toi60, 4) if toi60 > 0 else None,
        'ixg_60':    round(ixg / toi60, 4) if (ixg is not None and toi60 > 0) else None,
        'a1_60':     round(a1_approx / toi60, 4) if toi60 > 0 else None,
        'icf_60':    round(icf / toi60, 4) if (icf is not None and toi60 > 0) else None,
        'tka_60':    round(tka / toi60, 4) if (tka is not None and toi60 > 0) else None,
        'gva_60':    round(gva / toi60, 4) if (gva is not None and toi60 > 0) else None,
        'xgf_pct':   safe(p.get('xgf_pct')),
        'hdcf_pct':  safe(p.get('hdcf_pct')),
        'cf_pct':    safe(p.get('cf_pct')),
        'fo_pct':    fo_pct,
    })

df = pd.DataFrame(rows)
print(f"Processing {len(df)} qualified skaters")

def pct_rank(series):
    return series.rank(pct=True, na_option='keep') * 100

def compute_group(subdf, is_defense):
    subdf = subdf.copy()

    # Offensive percentiles — weighted: ixG/60 35%, A1/60 25%, Pts/60 20%, iCF/60 10%, xGF% 10%
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

    # Defensive percentiles (invert gva so fewer = better)
    subdf['gva_inv'] = subdf['gva_60'] * -1
    def_cols = ['hdcf_pct', 'cf_pct', 'tka_60', 'gva_inv']
    def_pcts = []
    for col in def_cols:
        if col in subdf.columns:
            subdf[f'dp_{col}'] = pct_rank(subdf[col])
            def_pcts.append(f'dp_{col}')
    subdf['def_rating'] = subdf[def_pcts].mean(axis=1, skipna=True).round(1)

    # Faceoff bonus for centers (max +3)
    fo_bonus = pd.Series(0.0, index=subdf.index)
    if 'fo_pct' in subdf.columns:
        fo_ranked = pct_rank(subdf['fo_pct']) / 100 * 3
        fo_bonus = fo_ranked.where(subdf['position'] == 'C', 0.0).fillna(0.0)

    # Overall
    if is_defense:
        subdf['overall_rating'] = (subdf['off_rating'] * 0.45 + subdf['def_rating'] * 0.55 + fo_bonus).round(1)
    else:
        subdf['overall_rating'] = (subdf['off_rating'] * 0.65 + subdf['def_rating'] * 0.35 + fo_bonus).round(1)

    return subdf

forwards  = compute_group(df[df['position'] != 'D'], is_defense=False)
defense   = compute_group(df[df['position'] == 'D'], is_defense=True)
final     = pd.concat([forwards, defense])

print(f"Ratings computed for {len(final)} players")
print(final[['full_name','position','off_rating','def_rating','overall_rating']]
      .sort_values('overall_rating', ascending=False).head(20).to_string())

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

print(f"Done. Updated: {updated} | Skipped: {skipped}")
