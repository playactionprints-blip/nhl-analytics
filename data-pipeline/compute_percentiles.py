import pandas as pd, os, math
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

res = sb.table('players').select(
    'player_id,full_name,position,gp,g,pts,toi,xgf_pct,hdcf_pct,icf,ixg'
).not_.is_('toi','null').execute()

players = res.data
print(f"Fetched {len(players)} players")

def parse_toi(toi_str):
    """Convert avg TOI '17:41' to minutes per game as float."""
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
    if gp < 10: continue
    avg_toi = parse_toi(p.get('toi'))
    if avg_toi is None or avg_toi < 5: continue  # min 5 min/game avg

    # Total TOI in minutes = avg_toi * gp
    total_toi = avg_toi * gp
    toi60 = total_toi / 60.0

    g   = safe(p.get('g')) or 0
    pts = safe(p.get('pts')) or 0
    icf = safe(p.get('icf'))
    ixg = safe(p.get('ixg'))
    xgf  = safe(p.get('xgf_pct'))
    hdcf = safe(p.get('hdcf_pct'))

    rows.append({
        'player_id': p['player_id'],
        'full_name': p['full_name'],
        'position': pos,
        'goals_60': round(g   / toi60, 4) if toi60 > 0 else None,
        'pts_60':   round(pts / toi60, 4) if toi60 > 0 else None,
        'icf_60':   round(icf / toi60, 4) if (icf is not None and toi60 > 0) else None,
        'ixg_60':   round(ixg / toi60, 4) if (ixg is not None and toi60 > 0) else None,
        'xgf_pct':  xgf,
        'hdcf_pct': hdcf,
    })

df = pd.DataFrame(rows)
print(f"Computing percentiles for {len(df)} qualified skaters")
if len(df) > 0:
    print("Sample:", df[['full_name','goals_60','pts_60']].head(3).to_dict('records'))

def pct_rank(series):
    return series.rank(pct=True, na_option='keep') * 100

for col in ['goals_60','pts_60','icf_60','ixg_60','xgf_pct','hdcf_pct']:
    if col in df.columns:
        df[f'{col}_pct'] = pct_rank(df[col]).round(0)

updated = 0
skipped = 0

for _, row in df.iterrows():
    pct = {}
    if pd.notna(row.get('goals_60_pct')): pct['Goals/60'] = int(row['goals_60_pct'])
    if pd.notna(row.get('pts_60_pct')):   pct['Pts/60']   = int(row['pts_60_pct'])
    if pd.notna(row.get('icf_60_pct')):   pct['iCF/60']   = int(row['icf_60_pct'])
    if pd.notna(row.get('ixg_60_pct')):   pct['ixG/60']   = int(row['ixg_60_pct'])
    if pd.notna(row.get('xgf_pct_pct')):  pct['xGF%']     = int(row['xgf_pct_pct'])
    if pd.notna(row.get('hdcf_pct_pct')): pct['HDCF%']    = int(row['hdcf_pct_pct'])

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
