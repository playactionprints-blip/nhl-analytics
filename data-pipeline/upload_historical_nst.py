#!/usr/bin/env python3
"""upload_historical_nst.py — Upload NST PP/PK/5v5 data for seasons 07-08 through 22-23.

Reads CSV files matching data/nst_{sit}_{season}.csv where:
  sit    = pp, pk, 5v5
  season = 0708, 0809, ..., 2223

Matches player names to player_ids via the player_names Supabase table,
then upserts rows to the historical_nst table.

Run the SQL migration first:
  migrations/add_historical_nst.sql

Usage (from data-pipeline/):
    python3 -u -c "
import os
with open('../.env.local') as f:
    for line in f:
        line=line.strip()
        if '=' in line and not line.startswith('#'):
            k,v=line.split('=',1)
            os.environ[k]=v
            if k.startswith('NEXT_PUBLIC_'):
                os.environ[k[len('NEXT_PUBLIC_'):]]=v
if 'SUPABASE_KEY' not in os.environ:
    os.environ['SUPABASE_KEY']=os.environ.get('SUPABASE_ANON_KEY','')
exec(open('upload_historical_nst.py').read())
"
"""

import os
import re
import unicodedata

import pandas as pd
from supabase import create_client

# ── env ───────────────────────────────────────────────────────────────────────
try:
    with open('../.env.local') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                os.environ.setdefault(k, v)
                if k.startswith('NEXT_PUBLIC_'):
                    os.environ.setdefault(k[len('NEXT_PUBLIC_'):], v)
except FileNotFoundError:
    pass

if 'SUPABASE_KEY' not in os.environ:
    os.environ['SUPABASE_KEY'] = os.environ.get('SUPABASE_ANON_KEY', '')

SUPABASE_URL = os.environ['SUPABASE_URL']
SUPABASE_KEY = os.environ['SUPABASE_KEY']
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

DATA_DIR = os.path.join(os.getcwd(), 'data')

# ── season mapping ────────────────────────────────────────────────────────────
SEASON_MAP = {
    '0708': '07-08', '0809': '08-09', '0910': '09-10',
    '1011': '10-11', '1112': '11-12', '1213': '12-13',
    '1314': '13-14', '1415': '14-15', '1516': '15-16',
    '1617': '16-17', '1718': '17-18', '1819': '18-19',
    '1920': '19-20', '2021': '20-21', '2122': '21-22',
    '2223': '22-23',
}

# ── helpers ───────────────────────────────────────────────────────────────────

def normalize(name):
    """Lowercase, strip accents, strip suffixes (Jr., Sr., II, III), strip whitespace."""
    s = str(name or '').strip()
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    # Strip common suffixes
    s = re.sub(r'\s+(jr\.?|sr\.?|ii|iii|iv)$', '', s, flags=re.IGNORECASE).strip()
    return s.lower()


def load_name_map():
    """Paginated fetch of player_names → {normalized_name: player_id}."""
    print("Loading player_names from Supabase...")
    rows = []
    start = 0
    while True:
        batch = sb.from_('player_names').select('player_id,full_name').range(start, start + 999).execute()
        if not batch.data:
            break
        rows.extend(batch.data)
        start += 1000
        if len(batch.data) < 1000:
            break
    name_map = {normalize(r['full_name']): r['player_id'] for r in rows}
    print(f"  Loaded {len(rows)} players → {len(name_map)} unique normalized names")
    return name_map


def safe_val(v):
    """Convert '-', NaN, or empty to None; otherwise return float."""
    if v is None:
        return None
    s = str(v).strip()
    if s in ('', '-', 'nan', 'NaN', 'None'):
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def read_nst_csv(path, cols):
    """Read an NST CSV, drop the unnamed index column, handle quirks.

    cols: list of column names to extract (after Player/Team).
    Returns list of dicts: {normalized_name: ..., team: ..., <cols>: ...}
    """
    try:
        df = pd.read_csv(path)
    except Exception as e:
        print(f"    Could not read {path}: {e}")
        return []

    # Drop unnamed index columns (NST CSVs often have an index as first col)
    unnamed = [c for c in df.columns if c.startswith('Unnamed')]
    if unnamed:
        df = df.drop(columns=unnamed)

    # Drop header repeat rows (rows where Player == 'Player')
    if 'Player' in df.columns:
        df = df[df['Player'].notna() & (df['Player'].astype(str).str.strip() != 'Player')]
    else:
        print(f"    Warning: no 'Player' column in {path}; columns: {list(df.columns)}")
        return []

    # Detect and convert TOI units
    # NST sometimes stores TOI as decimal hours (e.g. 0.85); other times as minutes (e.g. 51.2)
    toi_col = next((c for c in cols if 'TOI' in c.upper() or 'toi' in c.lower()), None)
    if toi_col and toi_col in df.columns:
        numeric_toi = pd.to_numeric(df[toi_col].astype(str).str.strip().replace({'-': None, '': None}), errors='coerce')
        max_toi = numeric_toi.dropna().max() if not numeric_toi.dropna().empty else 0
        if max_toi < 100:
            # Stored as hours → convert to minutes
            df[toi_col] = numeric_toi * 60.0
        else:
            df[toi_col] = numeric_toi

    records = []
    for _, row in df.iterrows():
        player_name = str(row.get('Player', '') or '').strip()
        if not player_name:
            continue
        team = str(row.get('Team', '') or '').strip()
        record = {
            'normalized_name': normalize(player_name),
            'raw_name': player_name,
            'team': team,
        }
        for col in cols:
            if col in df.columns:
                record[col] = safe_val(row.get(col))
            else:
                record[col] = None
        records.append(record)

    return records


def process_season(season_suffix, season_label, name_map):
    """Read PP/PK/5v5 CSVs for one season, merge, return upsert rows."""
    pp_path  = os.path.join(DATA_DIR, f'nst_pp_{season_suffix}.csv')
    pk_path  = os.path.join(DATA_DIR, f'nst_pk_{season_suffix}.csv')
    ev_path  = os.path.join(DATA_DIR, f'nst_5v5_{season_suffix}.csv')

    # ── read each situation ───────────────────────────────────────────────────
    pp_records = {}
    if os.path.exists(pp_path):
        for r in read_nst_csv(pp_path, ['TOI', 'xGF']):
            pp_records[r['normalized_name']] = {
                'toi_pp':  r.get('TOI'),
                'xgf_pp':  r.get('xGF'),
            }
        print(f"    PP:  {len(pp_records)} players from {os.path.basename(pp_path)}")
    else:
        print(f"    PP:  file not found — {os.path.basename(pp_path)}")

    pk_records = {}
    if os.path.exists(pk_path):
        for r in read_nst_csv(pk_path, ['TOI', 'xGA']):
            pk_records[r['normalized_name']] = {
                'toi_pk':  r.get('TOI'),
                'xga_pk':  r.get('xGA'),
            }
        print(f"    PK:  {len(pk_records)} players from {os.path.basename(pk_path)}")
    else:
        print(f"    PK:  file not found — {os.path.basename(pk_path)}")

    ev_records = {}
    if os.path.exists(ev_path):
        for r in read_nst_csv(ev_path, ['TOI', 'xGF%', 'HDCF%', 'CF%']):
            ev_records[r['normalized_name']] = {
                'toi_5v5':  r.get('TOI'),
                'xgf_pct':  r.get('xGF%'),
                'hdcf_pct': r.get('HDCF%'),
                'cf_pct':   r.get('CF%'),
            }
        print(f"    5v5: {len(ev_records)} players from {os.path.basename(ev_path)}")
    else:
        print(f"    5v5: file not found — {os.path.basename(ev_path)}")

    if not pp_records and not pk_records and not ev_records:
        return [], set()

    # ── merge by player name ──────────────────────────────────────────────────
    all_names = set(pp_records) | set(pk_records) | set(ev_records)

    rows = []
    unmatched = set()
    for norm_name in all_names:
        player_id = name_map.get(norm_name)
        if player_id is None:
            unmatched.add(norm_name)
            continue

        pp = pp_records.get(norm_name, {})
        pk = pk_records.get(norm_name, {})
        ev = ev_records.get(norm_name, {})

        row = {
            'player_id': player_id,
            'season':    season_label,
            'toi_pp':    pp.get('toi_pp'),
            'xgf_pp':    pp.get('xgf_pp'),
            'toi_pk':    pk.get('toi_pk'),
            'xga_pk':    pk.get('xga_pk'),
            'toi_5v5':   ev.get('toi_5v5'),
            'xgf_pct':   ev.get('xgf_pct'),
            'hdcf_pct':  ev.get('hdcf_pct'),
            'cf_pct':    ev.get('cf_pct'),
        }
        # Only include row if at least one numeric value is present
        has_data = any(v is not None for k, v in row.items() if k not in ('player_id', 'season'))
        if has_data:
            rows.append(row)

    return rows, unmatched


def main():
    name_map = load_name_map()

    all_unmatched = set()
    total_upserted = 0
    season_summaries = []

    for suffix, label in SEASON_MAP.items():
        print(f"\nSeason {label} ({suffix}):")
        rows, unmatched = process_season(suffix, label, name_map)
        all_unmatched.update(unmatched)

        if not rows:
            print(f"  No data rows — skipping upsert")
            season_summaries.append((label, 0, len(unmatched)))
            continue

        # Upsert in batches of 500
        upserted = 0
        for i in range(0, len(rows), 500):
            chunk = rows[i:i + 500]
            try:
                sb.from_('historical_nst').upsert(chunk, on_conflict='player_id,season').execute()
                upserted += len(chunk)
            except Exception as e:
                print(f"  ERROR on batch {i}–{i+500}: {e}")
        print(f"  {upserted} rows upserted, {len(unmatched)} unmatched players")
        total_upserted += upserted
        season_summaries.append((label, upserted, len(unmatched)))

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'='*60}")
    for label, n_up, n_un in season_summaries:
        print(f"  {label}: {n_up:4d} upserted, {n_un:3d} unmatched")
    print(f"\nTotal upserted: {total_upserted}")
    print(f"Total unique unmatched names: {len(all_unmatched)}")

    if all_unmatched:
        unmatched_path = os.path.join(DATA_DIR, 'nst_unmatched.txt')
        with open(unmatched_path, 'w') as f:
            for name in sorted(all_unmatched):
                f.write(name + '\n')
        print(f"Unmatched names saved to {unmatched_path}")
        print(f"Sample (first 20):")
        for name in sorted(all_unmatched)[:20]:
            print(f"  {name}")


if __name__ == '__main__':
    main()
