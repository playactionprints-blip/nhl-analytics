#!/usr/bin/env python3
"""
Upload NST 5v5/PP/PK splits (3 seasons) to Supabase.
Computes finishing_pct (goals/ixG percentile) and uploads to players table.

Requires SQL migration first:
  Run data-pipeline/migrations/add_splits.sql in Supabase SQL editor.

Files used (all in data-pipeline/data/):
  5v5: nst_5v5_2526.csv, nst_5v5_2425.csv, nst_onice_2324.csv (alias for 5v5 23-24)
  PP:  nst_pp_2526.csv,  nst_pp_2425.csv,  nst_pp_2324.csv
  PK:  nst_pk_2526.csv,  nst_pk_2425.csv,  nst_pk_2324.csv
"""
import os, re, math, unicodedata
import pandas as pd
from supabase import create_client
from rapidfuzz import process, fuzz

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

# ── Name normalization ────────────────────────────────────────────────────────
def normalize(name):
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    name = re.sub(r"[^a-z ]", '', name.lower().strip())
    return re.sub(r'\s+', ' ', name).strip()


def safe_float(v):
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return None


# ── Load Supabase data ────────────────────────────────────────────────────────
print("Loading players from Supabase...")
all_players = sb.table('players').select('player_id,full_name,position').execute().data
print(f"  {len(all_players)} players")

name_to_id  = {normalize(p['full_name']): p['player_id'] for p in all_players}
names_list  = list(name_to_id.keys())
id_to_info  = {p['player_id']: p for p in all_players}

print("Loading player_seasons (player_id + season)...")
ps_rows = sb.table('player_seasons').select('player_id,season').execute().data
ps_key_set = {(r['player_id'], r['season']) for r in ps_rows}
print(f"  {len(ps_key_set)} player-season rows")


# ── Player name matching ──────────────────────────────────────────────────────
def match_player(nst_name, threshold=85):
    """Return player_id for nst_name, or None if no match."""
    key = normalize(nst_name)
    if key in name_to_id:
        return name_to_id[key]
    # Try hyphen/apostrophe stripped variant
    alt = re.sub(r'\s+', ' ', re.sub(r"[-']", ' ', key)).strip()
    if alt in name_to_id:
        return name_to_id[alt]
    # Rapidfuzz fallback
    result = process.extractOne(key, names_list, scorer=fuzz.token_sort_ratio,
                                score_cutoff=threshold)
    if result:
        return name_to_id[result[0]]
    return None


# ── CSV loading ───────────────────────────────────────────────────────────────
def load_nst_csv(fname):
    path = os.path.join(DATA_DIR, fname)
    df = pd.read_csv(path, encoding='utf-8-sig')
    # Normalise column names: strip whitespace, replace non-breaking spaces
    df.columns = [c.strip().replace('\xa0', ' ') for c in df.columns]
    return df


def extract_cols(row, situation):
    """Map CSV row to DB column names for the given situation."""
    toi        = safe_float(row.get('TOI'))
    cf         = safe_float(row.get('CF'))
    ca         = safe_float(row.get('CA'))
    xgf        = safe_float(row.get('xGF'))
    xga        = safe_float(row.get('xGA'))
    cf_pct_val = safe_float(row.get('CF%'))
    xgf_pct_v  = safe_float(row.get('xGF%'))

    if situation == '5v5':
        return {
            'toi_5v5':     toi,
            'cf_5v5':      cf,
            'ca_5v5':      ca,
            'xgf_5v5':     xgf,
            'xga_5v5':     xga,
            'cf_pct_5v5':  cf_pct_val,
            'xgf_pct_5v5': xgf_pct_v,
        }
    elif situation == 'pp':
        return {
            'toi_pp':    toi,
            'cf_pp':     cf,
            'xgf_pp':    xgf,
            'cf_pct_pp': cf_pct_val,
        }
    elif situation == 'pk':
        return {
            'toi_pk':    toi,
            'cf_pk':     cf,
            'xga_pk':    xga,
            'cf_pct_pk': cf_pct_val,
        }
    return {}


# ── File manifest ─────────────────────────────────────────────────────────────
# nst_onice_2324.csv is the 5v5 23-24 file (identical format, named differently)
FILES = [
    ('nst_5v5_2526.csv',   '5v5', '25-26'),
    ('nst_5v5_2425.csv',   '5v5', '24-25'),
    ('nst_onice_2324.csv', '5v5', '23-24'),
    ('nst_pp_2526.csv',    'pp',  '25-26'),
    ('nst_pp_2425.csv',    'pp',  '24-25'),
    ('nst_pp_2324.csv',    'pp',  '23-24'),
    ('nst_pk_2526.csv',    'pk',  '25-26'),
    ('nst_pk_2425.csv',    'pk',  '24-25'),
    ('nst_pk_2324.csv',    'pk',  '23-24'),
]


# ── Process files ─────────────────────────────────────────────────────────────
# players_updates[player_id]      = dict of cols   (25-26 only → players table)
# ps_updates[(player_id, season)] = dict of cols   (all seasons → player_seasons)
players_updates = {}
ps_updates      = {}

for fname, situation, season in FILES:
    print(f"\nProcessing {fname}  ({situation}, {season})...")
    df = load_nst_csv(fname)

    matched         = 0
    unmatched       = 0
    unmatched_names = []

    for _, row in df.iterrows():
        nst_name = str(row.get('Player', '')).strip()
        if not nst_name:
            continue

        pid = match_player(nst_name)
        if pid is None:
            unmatched += 1
            if len(unmatched_names) < 5:
                unmatched_names.append(nst_name)
            continue

        cols = {k: v for k, v in extract_cols(row, situation).items()
                if v is not None}
        if not cols:
            continue

        matched += 1

        # players table — current season only
        if season == '25-26':
            players_updates.setdefault(pid, {}).update(cols)

        # player_seasons — all seasons (only if row exists)
        ps_key = (pid, season)
        if ps_key in ps_key_set:
            ps_updates.setdefault(ps_key, {}).update(cols)

    total = matched + unmatched
    rate  = matched / total * 100 if total > 0 else 0.0
    print(f"  Matched: {matched} | Unmatched: {unmatched} | Rate: {rate:.1f}%")
    if unmatched_names:
        print(f"  Sample unmatched: {unmatched_names}")


# ── Upload: players table (25-26 splits) ─────────────────────────────────────
print(f"\n{'='*60}")
print(f"Uploading 25-26 splits to players table ({len(players_updates)} players)...")
p_done = 0
for pid, data in players_updates.items():
    sb.table('players').update(data).eq('player_id', pid).execute()
    p_done += 1
print(f"  Done: {p_done} players updated")


# ── Upload: player_seasons (all 3 seasons) ───────────────────────────────────
print(f"\nUploading splits to player_seasons ({len(ps_updates)} rows)...")
ps_done = 0
for (pid, season), data in ps_updates.items():
    sb.table('player_seasons').update(data) \
        .eq('player_id', pid).eq('season', season).execute()
    ps_done += 1
print(f"  Done: {ps_done} player-season rows updated")


# ── Compute finishing rating ──────────────────────────────────────────────────
print(f"\n{'='*60}")
print("Computing finishing rating (goals / ixG percentile)...")

finishing_rows = sb.table('player_seasons') \
    .select('player_id,g,ixg') \
    .eq('season', '25-26') \
    .execute().data

# Exclude goalies
skater_ids = {p['player_id'] for p in all_players if p.get('position') != 'G'}

finishing = {}   # player_id -> ratio (goals/ixg)
for row in finishing_rows:
    pid  = row['player_id']
    g    = safe_float(row.get('g'))
    ixg  = safe_float(row.get('ixg'))
    if pid not in skater_ids:
        continue
    if g is not None and ixg is not None and ixg > 5.0:
        # ixg > 5.0 floor: filters defensemen with 2-3 ixG who distort the leaderboard
        # Players below threshold get finishing_pct = NULL (excluded from off rating)
        finishing[pid] = g / ixg

if finishing:
    vals_sorted = sorted(finishing.values())
    n = len(vals_sorted)

    finishing_pcts = {}
    for pid, ratio in finishing.items():
        rank = sum(1 for v in vals_sorted if v < ratio)
        pct  = round(rank / n * 100, 1)
        finishing_pcts[pid] = pct

    # Print leaderboards
    sorted_fin = sorted(finishing_pcts.items(), key=lambda x: x[1], reverse=True)

    print(f"\n--- TOP 20 FINISHERS (goals/ixG > 1.0 = beats expectation) ---")
    print(f"  {'Player':<25}  {'Goals/ixG':>9}  {'Pct':>6}")
    print(f"  {'-'*25}  {'-'*9}  {'-'*6}")
    for pid, pct in sorted_fin[:20]:
        info  = id_to_info.get(pid, {})
        ratio = finishing.get(pid, 0)
        print(f"  {info.get('full_name','?'):<25}  {ratio:>9.3f}  {pct:>6.1f}")

    print(f"\n--- BOTTOM 10 FINISHERS (under-converting on high volume) ---")
    print(f"  {'Player':<25}  {'Goals/ixG':>9}  {'Pct':>6}")
    print(f"  {'-'*25}  {'-'*9}  {'-'*6}")
    for pid, pct in sorted_fin[-10:]:
        info  = id_to_info.get(pid, {})
        ratio = finishing.get(pid, 0)
        print(f"  {info.get('full_name','?'):<25}  {ratio:>9.3f}  {pct:>6.1f}")

    # NULL out all skaters first, then set values only for those above threshold.
    # This clears stale values from any previous run with a lower threshold.
    print(f"\nClearing old finishing_pct for all skaters...")
    cleared = 0
    for p in all_players:
        if p.get('position') != 'G':
            sb.table('players').update({'finishing_pct': None}).eq('player_id', p['player_id']).execute()
            cleared += 1
    print(f"  Cleared {cleared} skaters")

    print(f"Uploading finishing_pct for {len(finishing_pcts)} qualifying players (ixG > 5.0)...")
    f_done = 0
    for pid, pct in finishing_pcts.items():
        sb.table('players').update({'finishing_pct': pct}).eq('player_id', pid).execute()
        f_done += 1
    print(f"  Done: {f_done} players updated")
else:
    print("  No finishing data found — check that player_seasons.g / ixg are populated")

print("\nAll done.")
