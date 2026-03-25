#!/usr/bin/env python3
import math
import os

import pandas as pd
from supabase import create_client
from sync_log import install_sync_logger

install_sync_logger("percentiles")

sb = create_client(
    os.getenv('SUPABASE_URL') or os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
    os.getenv('SUPABASE_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
)


def parse_toi(toi_str):
    try:
        mins, secs = str(toi_str).split(':')
        return int(mins) + int(secs) / 60.0
    except Exception:
        return None


def safe(val):
    if val is None:
        return None
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return None


def pct_rank(series):
    return series.rank(pct=True, na_option='keep') * 100


cols = (
    'player_id,full_name,position,gp,g,pts,toi,xgf_pct,hdcf_pct,icf,ixg,'
    'rapm_off,rapm_def,qot_impact,qoc_impact,'
    'war_total,war_ev_off,war_ev_def,war_pp,war_pk,war_shooting,war_penalties,'
    'off_rating,def_rating,overall_rating'
)
players = sb.table('players').select(cols).neq('position', 'G').execute().data
print(f"Fetched {len(players)} skaters")

# ── Fetch current-season a1 from player_seasons ──────────────────────────────
CURRENT_SEASON = '25-26'
ps_rows = sb.table('player_seasons').select('player_id,a1,toi').eq('season', CURRENT_SEASON).execute().data
a1_lookup = {}
for row in ps_rows:
    pid = row['player_id']
    a1 = row.get('a1')
    toi_min = row.get('toi')
    if a1 is not None and toi_min and float(toi_min) > 0:
        a1_lookup[pid] = float(a1) / (float(toi_min) / 60.0)
print(f"Fetched a1_60 for {len(a1_lookup)} players from player_seasons")

rows = []
for p in players:
    gp = safe(p.get('gp')) or 0
    avg_toi = parse_toi(p.get('toi'))
    if gp < 10 or avg_toi is None or avg_toi < 5:
        continue

    total_toi = avg_toi * gp
    toi60 = total_toi / 60.0 if total_toi else None
    position = p.get('position', '')
    group = 'D' if position == 'D' else 'F'

    g = safe(p.get('g')) or 0
    pts = safe(p.get('pts')) or 0
    icf = safe(p.get('icf'))
    ixg = safe(p.get('ixg'))

    rows.append({
        'player_id': p['player_id'],
        'full_name': p['full_name'],
        'position': position,
        'group': group,
        'goals_60': round(g / toi60, 4) if toi60 else None,
        'pts_60': round(pts / toi60, 4) if toi60 else None,
        'icf_60': round(icf / toi60, 4) if (icf is not None and toi60) else None,
        'ixg_60': round(ixg / toi60, 4) if (ixg is not None and toi60) else None,
        'xgf_pct': safe(p.get('xgf_pct')),
        'hdcf_pct': safe(p.get('hdcf_pct')),
        'rapm_off': safe(p.get('rapm_off')),
        'rapm_def': safe(p.get('rapm_def')),
        'qot_impact': safe(p.get('qot_impact')),
        'qoc_impact': safe(p.get('qoc_impact')),
        'war_total': safe(p.get('war_total')),
        'war_ev_off': safe(p.get('war_ev_off')),
        'war_ev_def': safe(p.get('war_ev_def')),
        'war_pp': safe(p.get('war_pp')),
        'war_pk': safe(p.get('war_pk')),
        'war_shooting': safe(p.get('war_shooting')),
        'war_penalties': safe(p.get('war_penalties')),
        'off_rating': safe(p.get('off_rating')),
        'def_rating': safe(p.get('def_rating')),
        'overall_rating': safe(p.get('overall_rating')),
        'a1_60': a1_lookup.get(p['player_id']),
    })

df = pd.DataFrame(rows)
print(f"Computing projected skater percentiles for {len(df)} qualified players")
if df.empty:
    raise SystemExit("No qualified skaters")

metric_labels = {
    'goals_60': 'Goals/60',
    'pts_60': 'Pts/60',
    'icf_60': 'iCF/60',
    'ixg_60': 'ixG/60',
    'xgf_pct': 'xGF%',
    'hdcf_pct': 'HDCF%',
    'war_total': 'WAR',
    'war_ev_off': 'EV Off',
    'war_ev_def': 'EV Def',
    'war_pp': 'PP',
    'war_pk': 'PK',
    'war_shooting': 'Finishing',
    'war_penalties': 'Penalties',
    'rapm_off': 'RAPM Off',
    'rapm_def': 'RAPM Def',
    'qoc_impact': 'Competition',
    'qot_impact': 'Teammates',
    'off_rating': 'Off Rating',
    'def_rating': 'Def Rating',
    'overall_rating': 'Overall',
    'a1_60': '1st Assists/60',
}

for group_key in ('F', 'D'):
    mask = df['group'] == group_key
    group_df = df.loc[mask].copy()
    if group_df.empty:
        continue
    for metric in metric_labels:
        if group_df[metric].notna().sum() == 0:
            continue
        df.loc[mask, f'{metric}_pct'] = pct_rank(group_df[metric]).round(0)

updated = 0
skipped = 0
for _, row in df.iterrows():
    pct = {}
    for metric, label in metric_labels.items():
        pct_val = row.get(f'{metric}_pct')
        if pd.notna(pct_val):
            pct[label] = int(pct_val)

    if not pct:
        skipped += 1
        continue

    result = sb.table('players').update({'percentiles': pct}).eq('player_id', row['player_id']).execute()
    if result.data:
        updated += 1
    else:
        skipped += 1
        print(f"  Failed: {row['full_name']}")

print(f"Done. Updated: {updated} | Skipped: {skipped}")
