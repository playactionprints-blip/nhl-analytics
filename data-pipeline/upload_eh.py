import pandas as pd, os, math, re
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
df = pd.read_csv('/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/evolving_hockey_stats.csv')

def clean_int(val):
    if val is None: return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f): return None
        return int(f)
    except: return None

def clean_float(val):
    if val is None: return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f): return None
        return round(f, 4)
    except: return None

updated = 0
skipped = 0

for _, row in df.iterrows():
    name = str(row.get('Player', '')).strip()
    name = re.sub(r'<[^>]+>', '', name).strip()
    if not name: continue
    data = {
        'icf':  clean_int(row.get('SAT')),
        'iff':  clean_int(row.get('SA')),
        'ixg':  clean_float(row.get('xG')),
        'hits': clean_int(row.get('HIT')),
        'blk':  clean_int(row.get('BLK')),
        'gva':  clean_int(row.get('GVA')),
        'tka':  clean_int(row.get('TKA')),
    }
    if any(v is not None for v in data.values()):
        result = sb.table('players').update(data).ilike('full_name', name).execute()
        if result.data:
            updated += 1
        else:
            skipped += 1
            print(f"  No match: {name}")

print(f"Done. Updated: {updated} | Skipped: {skipped}")
