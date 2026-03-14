#!/usr/bin/env python3
"""
Upload 3 seasons of EH + NST on-ice data to player_seasons table.
EH provides: g, a1, a2, ixg (xG), icf (SAT), iff (SA), hits (HIT), blk, gva, tka, fow, fol, gp, toi
NST provides: cf_pct, xgf_pct, hdcf_pct, scf_pct
"""
import pandas as pd
import os
import re
import html
import unicodedata
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')

SEASONS = [
    ('25-26', 'evolving_hockey_stats.csv', 'nst_onice.csv'),
    ('24-25', 'eh_skaters_2425.csv',       'nst_onice_2425.csv'),
    ('23-24', 'eh_skaters_2324.csv',       'nst_onice_2324.csv'),
]

SPLIT_FILES = {
    '25-26': {
        '5v5': 'nst_5v5_2526.csv',
        'pp': 'nst_pp_2526.csv',
        'pk': 'nst_pk_2526.csv',
    },
    '24-25': {
        '5v5': 'nst_5v5_2425.csv',
        'pp': 'nst_pp_2425.csv',
        'pk': 'nst_pk_2425.csv',
    },
    '23-24': {
        '5v5': 'nst_onice_2324.csv',
        'pp': 'nst_pp_2324.csv',
        'pk': 'nst_pk_2324.csv',
    },
}


def norm_name(name):
    """Normalize for matching: strip HTML, remove accents/periods, lowercase."""
    if not isinstance(name, str) or not name:
        return ''
    name = re.sub(r'<[^>]+>', '', name)
    name = html.unescape(name)
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    name = re.sub(r'[^\w\s\-]', '', name)   # remove periods, apostrophes, etc.
    name = re.sub(r'\s+', ' ', name).lower().strip()
    return name


# EH often uses shortened/alternative first names vs. NHL API registered names
FIRST_NAME_SUBS = {
    'alex':      ['alexander', 'alexandre'],
    'alexei':    ['alexey'],
    'alexey':    ['alexei'],
    'alexandre': ['alex'],
    'mike':      ['michael'],
    'zach':      ['zachary'],
    'matt':      ['matthew'],
    'nick':      ['nicholas', 'nicolas'],
    'chris':     ['christopher'],
    'dan':       ['daniel'],
    'pat':       ['patrick'],
    'brad':      ['bradley'],
    'tom':       ['thomas'],
    'sam':       ['samuel'],
    'jake':      ['jacob'],
    'ben':       ['benjamin'],
    'max':       ['maxime', 'maximilian'],
    'maxime':    ['max'],
    'phil':      ['philip', 'phillip'],
    'will':      ['william'],
    'j-f':       ['jean-francois'],
    'cal':       ['calvin'],
    'rick':      ['richard'],
    'andy':      ['andrew'],
    'freddie':   ['frederic', 'frederik'],
    'frederic':  ['freddie'],
}


def lookup_player(norm, name_to_id):
    """Try exact match, then first-name substitutions."""
    if norm in name_to_id:
        return name_to_id[norm]
    parts = norm.split(' ', 1)
    if len(parts) == 2:
        first, last = parts
        for alt in FIRST_NAME_SUBS.get(first, []):
            alt_norm = f'{alt} {last}'
            if alt_norm in name_to_id:
                return name_to_id[alt_norm]
    return None


def safe_int(v):
    try:
        if v is None or (isinstance(v, float) and v != v): return None
        return int(v)
    except: return None


def safe_float(v):
    try:
        if v is None or (isinstance(v, float) and v != v): return None
        f = float(v)
        return None if f != f else f
    except: return None


def load_split_df(season, situation):
    path = os.path.join(DATA_DIR, SPLIT_FILES[season][situation])
    df = pd.read_csv(path, encoding='utf-8-sig')
    df.columns = [c.strip().replace('\xa0', ' ') for c in df.columns]
    df['_norm'] = df['Player'].apply(norm_name)
    df = df.sort_values('GP', ascending=False).drop_duplicates('_norm').reset_index(drop=True)

    if situation == '5v5':
        return df[['_norm', 'TOI', 'CF', 'CA', 'xGF', 'xGA', 'CF%', 'xGF%']].rename(columns={
            'TOI': 'toi_5v5',
            'CF': 'cf_5v5',
            'CA': 'ca_5v5',
            'xGF': 'xgf_5v5',
            'xGA': 'xga_5v5',
            'CF%': 'cf_pct_5v5',
            'xGF%': 'xgf_pct_5v5',
        })
    if situation == 'pp':
        return df[['_norm', 'TOI', 'CF', 'xGF', 'CF%']].rename(columns={
            'TOI': 'toi_pp',
            'CF': 'cf_pp',
            'xGF': 'xgf_pp',
            'CF%': 'cf_pct_pp',
        })
    if situation == 'pk':
        return df[['_norm', 'TOI', 'CF', 'xGA', 'CF%']].rename(columns={
            'TOI': 'toi_pk',
            'CF': 'cf_pk',
            'xGA': 'xga_pk',
            'CF%': 'cf_pct_pk',
        })
    raise ValueError(f"Unknown situation: {situation}")


# ── Fetch all players into a lookup dict ─────────────────────────────────────
print("Fetching players from Supabase...")
all_players = sb.table('players').select('player_id,full_name,position').execute().data
print(f"  {len(all_players)} players")

name_to_id = {}
for p in all_players:
    n = norm_name(p['full_name'])
    if n:
        name_to_id[n] = p['player_id']


# ── Process each season ───────────────────────────────────────────────────────
for season, eh_file, nst_file in SEASONS:
    print(f"\n=== Season {season} ===")

    # Load EH
    eh = pd.read_csv(os.path.join(DATA_DIR, eh_file))
    eh['_norm'] = eh['Player'].apply(norm_name)

    # Dedup traded players: prefer 'TOT' row, else highest GP
    eh['_is_tot'] = eh['Team'].str.upper() == 'TOT'
    eh = (eh.sort_values(['_norm', '_is_tot', 'GP'], ascending=[True, False, False])
            .drop_duplicates('_norm', keep='first')
            .drop(columns=['_is_tot'])
            .reset_index(drop=True))
    print(f"  EH: {len(eh)} unique players after dedup")

    # Load NST on-ice
    nst = pd.read_csv(os.path.join(DATA_DIR, nst_file))
    nst['_norm'] = nst['Player'].apply(norm_name)

    # Dedup traded players: highest GP row
    nst = nst.sort_values('GP', ascending=False).drop_duplicates('_norm').reset_index(drop=True)
    print(f"  NST: {len(nst)} unique players after dedup")

    # Merge EH + NST on normalized name
    nst_slim = nst[['_norm', 'CF%', 'xGF%', 'HDCF%', 'SCF%']].copy()
    merged = eh.merge(nst_slim, on='_norm', how='left')
    print(f"  EH-NST merge: {merged['CF%'].notna().sum()}/{len(merged)} have on-ice data")

    split_5v5 = load_split_df(season, '5v5')
    split_pp  = load_split_df(season, 'pp')
    split_pk  = load_split_df(season, 'pk')
    merged = merged.merge(split_5v5, on='_norm', how='left')
    merged = merged.merge(split_pp, on='_norm', how='left')
    merged = merged.merge(split_pk, on='_norm', how='left')
    print(
        "  Split coverage: "
        f"5v5 {merged['toi_5v5'].notna().sum()}/{len(merged)} | "
        f"PP {merged['toi_pp'].notna().sum()}/{len(merged)} | "
        f"PK {merged['toi_pk'].notna().sum()}/{len(merged)}"
    )

    # Build upload rows
    rows = []
    skipped = []

    for _, row in merged.iterrows():
        player_id = lookup_player(row['_norm'], name_to_id)
        if player_id is None:
            skipped.append(str(row.get('Player', row['_norm'])))
            continue

        rows.append({
            'player_id': int(player_id),
            'season':    season,
            'team':      str(row['Team']),
            'gp':        safe_int(row.get('GP')),
            'toi':       safe_float(row.get('TOI')),
            'g':         safe_int(row.get('G')),
            'a1':        safe_int(row.get('A1')),
            'a2':        safe_int(row.get('A2')),
            'ixg':       safe_float(row.get('xG')),
            'icf':       safe_int(row.get('SAT')),
            'iff':       safe_int(row.get('SA')),
            'hits':      safe_int(row.get('HIT')),
            'blk':       safe_int(row.get('BLK')),
            'gva':       safe_int(row.get('GVA')),
            'tka':       safe_int(row.get('TKA')),
            'fow':       safe_int(row.get('FOW')),
            'fol':       safe_int(row.get('FOL')),
            'cf_pct':    safe_float(row.get('CF%')),
            'xgf_pct':   safe_float(row.get('xGF%')),
            'hdcf_pct':  safe_float(row.get('HDCF%')),
            'scf_pct':   safe_float(row.get('SCF%')),
            'toi_5v5':   safe_float(row.get('toi_5v5')),
            'cf_5v5':    safe_float(row.get('cf_5v5')),
            'ca_5v5':    safe_float(row.get('ca_5v5')),
            'xgf_5v5':   safe_float(row.get('xgf_5v5')),
            'xga_5v5':   safe_float(row.get('xga_5v5')),
            'cf_pct_5v5': safe_float(row.get('cf_pct_5v5')),
            'xgf_pct_5v5': safe_float(row.get('xgf_pct_5v5')),
            'toi_pp':    safe_float(row.get('toi_pp')),
            'cf_pp':     safe_float(row.get('cf_pp')),
            'xgf_pp':    safe_float(row.get('xgf_pp')),
            'cf_pct_pp': safe_float(row.get('cf_pct_pp')),
            'toi_pk':    safe_float(row.get('toi_pk')),
            'cf_pk':     safe_float(row.get('cf_pk')),
            'xga_pk':    safe_float(row.get('xga_pk')),
            'cf_pct_pk': safe_float(row.get('cf_pct_pk')),
        })

    pct = 100 * len(rows) / len(merged)
    print(f"  Matched: {len(rows)}/{len(merged)} ({pct:.1f}%)")

    if skipped:
        print(f"  First 20 unmatched: {skipped[:20]}")
    if pct < 70:
        print("  WARNING: match rate below 70% — investigate name mismatches!")

    if rows:
        # Wipe season then bulk-insert
        sb.table('player_seasons').delete().eq('season', season).execute()
        for i in range(0, len(rows), 200):
            sb.table('player_seasons').insert(rows[i:i+200]).execute()
        print(f"  Inserted {len(rows)} rows into player_seasons")

print("\nAll seasons uploaded.")
