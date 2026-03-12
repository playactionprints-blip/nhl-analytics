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
SEASONS = ['25-26', '24-25', '23-24']
PS_COLS = 'player_id,season,gp,toi,g,a1,a2,ixg,icf,tka,gva,xgf_pct,hdcf_pct,cf_pct,scf_pct,fow,fol,cf_pct_pk'

print("Fetching player_seasons (per-season to avoid row limit)...")
ps_rows = []
for s in SEASONS:
    batch = sb.table('player_seasons').select(PS_COLS).eq('season', s).execute().data
    ps_rows.extend(batch)
    print(f"  {s}: {len(batch)} rows")
print(f"  Total: {len(ps_rows)} season rows")

print("Fetching players + RAPM + finishing/PP data...")
player_info = {p['player_id']: p for p in
               sb.table('players').select('player_id,full_name,position').execute().data}

# Fetch RAPM values (columns may not exist if build_rapm.py hasn't run yet)
rapm_lookup = {}
try:
    rapm_rows = sb.table('players').select('player_id,rapm_off,rapm_def,rapm_off_pct,rapm_def_pct').execute().data
    for r in rapm_rows:
        if r.get('rapm_off') is not None or r.get('rapm_def') is not None:
            rapm_lookup[r['player_id']] = {
                'rapm_off':     r.get('rapm_off'),
                'rapm_def':     r.get('rapm_def'),
                'rapm_off_pct': r.get('rapm_off_pct'),
                'rapm_def_pct': r.get('rapm_def_pct'),
            }
    print(f"  {len(rapm_lookup)} players with RAPM data")
except Exception as e:
    print(f"  RAPM columns not found — run build_rapm.py first ({e})")
    print("  SQL to add columns:")
    print("    alter table players add column if not exists rapm_off float8;")
    print("    alter table players add column if not exists rapm_def float8;")

# Fetch finishing_pct and toi_pp (populated by upload_nst_splits.py)
extra_lookup = {}
try:
    extra_rows = sb.table('players').select('player_id,finishing_pct,toi_pp').execute().data
    for r in extra_rows:
        fp  = r.get('finishing_pct')
        tpp = r.get('toi_pp')
        if fp is not None or tpp is not None:
            extra_lookup[r['player_id']] = {'finishing_pct': fp, 'toi_pp': tpp}
    fp_count  = sum(1 for v in extra_lookup.values() if v.get('finishing_pct') is not None)
    tpp_count = sum(1 for v in extra_lookup.values() if v.get('toi_pp') is not None)
    print(f"  {fp_count} players with finishing_pct, {tpp_count} with toi_pp")
except Exception as e:
    print(f"  Could not fetch finishing_pct/toi_pp ({e}) — run upload_nst_splits.py first")


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
    xgf_n = hdcf_n = cf_n = cf_pk_n = 0.0
    xgf_d = hdcf_d = cf_d = cf_pk_d = 0.0

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

        cf_pk = safe(row.get('cf_pct_pk'))
        if cf_pk is not None:
            cf_pk_n += w * t60 * cf_pk
            cf_pk_d += w * t60

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

    rapm  = rapm_lookup.get(pid, {})
    extra = extra_lookup.get(pid, {})
    records.append({
        'player_id':     pid,
        'full_name':     info['full_name'],
        'position':      pos,
        'goals_60':      round(w_g    / w_toi60, 4),
        'pts_60':        round(w_pts  / w_toi60, 4),
        'ixg_60':        round(w_ixg  / w_toi60, 4),
        'a1_60':         round(w_a1   / w_toi60, 4),
        'icf_60':        round(w_icf  / w_toi60, 4),
        'tka_60':        round(w_tka  / w_toi60, 4),
        'gva_60':        round(w_gva  / w_toi60, 4),
        'xgf_pct':       round(xgf_n  / xgf_d,  4) if xgf_d  > 0 else None,
        'hdcf_pct':      round(hdcf_n / hdcf_d, 4) if hdcf_d > 0 else None,
        'cf_pct':        round(cf_n   / cf_d,   4) if cf_d   > 0 else None,
        'cf_pct_pk':     round(cf_pk_n / cf_pk_d, 4) if cf_pk_d > 0 else None,
        'fo_pct':        fo_pct,
        'finishing_pct': safe(extra.get('finishing_pct')),
        'toi_pp':        safe(extra.get('toi_pp')),
        'rapm_off':      safe(rapm.get('rapm_off')),
        'rapm_def':      safe(rapm.get('rapm_def')),
        'rapm_off_pct':  safe(rapm.get('rapm_off_pct')),
        'rapm_def_pct':  safe(rapm.get('rapm_def_pct')),
    })

df = pd.DataFrame(records)
print(f"Processing {len(df)} qualified skaters (3-season weighted)")


# ── Rating computation ────────────────────────────────────────────────────────
def pct_rank(series):
    return series.rank(pct=True, na_option='keep') * 100


def compute_group(subdf, is_defense):
    subdf = subdf.copy()

    # Offensive rating — ixG/60 35%, A1/60 25%, Pts/60 10%, iCF/60 10%,
    #                    xGF% 10%, finishing_pct 10%
    # RAPM_off excluded: ridge RAPM with alpha=100 shrinks elite players toward zero
    # (McDavid/Kucherov score ~52nd pct because they face tougher competition).
    # Adding it at any meaningful weight displaces McDavid/MacKinnon from the top.
    OFF_WEIGHTS = {
        'ixg_60':        0.35,
        'a1_60':         0.25,
        'pts_60':        0.10,
        'icf_60':        0.10,
        'xgf_pct':       0.10,
        'finishing_pct': 0.10,
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

    # Defensive rating — xGF% 27%, HDCF% 27%, RAPM_def 10%, TKA/60 14%,
    #                    CF% PK 10%, GVA/60 inv 9%, CF% 5v5 3%
    # rapm_def_pct added at 10% — a small individual-level signal to supplement
    # the on-ice% metrics. Defensive RAPM is more reliable than offensive RAPM
    # (Josi=91st, Raddysh=89th — both sensible). xgf_pct/hdcf_pct reduced from
    # 31%→27% each to make room; cf_pct reduced 5%→3%.
    subdf['gva_inv'] = subdf['gva_60'] * -1
    DEF_WEIGHTS = {
        'xgf_pct':      0.27,
        'hdcf_pct':     0.27,
        'cf_pct':       0.03,
        'tka_60':       0.14,
        'gva_inv':      0.09,
        'cf_pct_pk':    0.10,
        'rapm_def_pct': 0.10,
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

# PP deployment bonus — max +3 points to overall_rating based on toi_pp rank
# across ALL skaters (reflects coach trust in offensive deployment)
if 'toi_pp' in final.columns and final['toi_pp'].notna().any():
    pp_bonus = (pct_rank(final['toi_pp']) / 100 * 3).fillna(0.0)
    final['overall_rating'] = (final['overall_rating'] + pp_bonus).round(1)
    pp_players = final['toi_pp'].notna().sum()
    print(f"PP bonus applied ({pp_players} players with toi_pp data)")

print(f"Ratings computed for {len(final)} players")

# ── WAR Computation ────────────────────────────────────────────────────────────
print("\nComputing WAR...")

GOALS_PER_WIN     = 6.0
REPLACEMENT_LEVEL = -0.15   # xG/60 below average = replacement level
PP_AVG_XGF_PER_60 = 2.8    # league avg PP xGF/60
PK_AVG_XGA_PER_60 = 2.4    # league avg PK xGA/60

# Fetch current-season TOI splits and PP/PK xG (populated by upload_nst_splits.py)
splits_rows   = sb.table('players').select(
    'player_id,toi_5v5,toi_pp,toi_pk,xgf_pp,xga_pk').execute().data
splits_lookup = {r['player_id']: r for r in splits_rows}

war_data = {}   # player_id → dict of WAR components (or {} if missing RAPM/splits)
for _, row in final.iterrows():
    pid        = row['player_id']
    sp         = splits_lookup.get(pid, {})
    rapm_off_v = safe(row.get('rapm_off'))
    rapm_def_v = safe(row.get('rapm_def'))
    toi_5v5    = safe(sp.get('toi_5v5'))   # minutes
    toi_pp_sp  = safe(sp.get('toi_pp'))    # minutes
    toi_pk_sp  = safe(sp.get('toi_pk'))    # minutes
    xgf_pp_v   = safe(sp.get('xgf_pp'))
    xga_pk_v   = safe(sp.get('xga_pk'))

    if rapm_off_v is None or rapm_def_v is None or not toi_5v5:
        war_data[pid] = {}
        continue

    h5     = toi_5v5 / 60.0
    ev_off = (rapm_off_v - REPLACEMENT_LEVEL) * h5 / GOALS_PER_WIN
    ev_def = (rapm_def_v - REPLACEMENT_LEVEL) * h5 / GOALS_PER_WIN

    pp_war = 0.0
    if toi_pp_sp and toi_pp_sp > 0 and xgf_pp_v is not None:
        pp_war = (xgf_pp_v / toi_pp_sp * 60 - PP_AVG_XGF_PER_60) * (toi_pp_sp / 60.0) / GOALS_PER_WIN

    pk_war = 0.0
    if toi_pk_sp and toi_pk_sp > 0 and xga_pk_v is not None:
        pk_war = (PK_AVG_XGA_PER_60 - xga_pk_v / toi_pk_sp * 60) * (toi_pk_sp / 60.0) / GOALS_PER_WIN

    war_data[pid] = {
        'war_ev_off': round(ev_off, 2),
        'war_ev_def': round(ev_def, 2),
        'war_pp':     round(pp_war, 2),
        'war_pk':     round(pk_war, 2),
        'war_total':  round(ev_off + ev_def + pp_war + pk_war, 2),
    }

# Print top-20 WAR leaderboard
name_pos = {row['player_id']: (row['full_name'], row['position']) for _, row in final.iterrows()}
war_list = sorted(
    [(pid, d) for pid, d in war_data.items() if d.get('war_total') is not None],
    key=lambda x: x[1]['war_total'], reverse=True
)
print(f"\n--- TOP 20 WAR ---")
print(f"  {'Player':<26}  {'Pos':>3}  {'EV Off':>7}  {'EV Def':>7}  {'PP':>6}  {'PK':>6}  {'Total':>7}")
print(f"  {'-'*26}  {'-'*3}  {'-'*7}  {'-'*7}  {'-'*6}  {'-'*6}  {'-'*7}")
for pid, d in war_list[:20]:
    name, pos = name_pos.get(pid, ('?', '?'))
    print(f"  {name:<26}  {pos:>3}  {d['war_ev_off']:>7.2f}  {d['war_ev_def']:>7.2f}"
          f"  {d['war_pp']:>6.2f}  {d['war_pk']:>6.2f}  {d['war_total']:>7.2f}")

# ── Leaderboards ──────────────────────────────────────────────────────────────
print("\n--- TOP 20 OVERALL ---")
print(final[['full_name','position','off_rating','def_rating','overall_rating']]
      .sort_values('overall_rating', ascending=False).head(20).to_string())

print("\n--- TOP 10 OFFENSIVE FORWARDS ---")
fwds = final[final['position'].isin(['C','L','R'])]
print(fwds[['full_name','position','off_rating','ixg_60','a1_60','finishing_pct']]
      .sort_values('off_rating', ascending=False).head(10).to_string())

print("\n--- TOP 10 DEFENSIVE DEFENSEMEN ---")
dmen = final[final['position'] == 'D']
print(dmen[['full_name','position','def_rating','xgf_pct','hdcf_pct','cf_pct_pk']]
      .sort_values('def_rating', ascending=False).head(10).to_string())

# Tkachuk brothers check
tkachuk_rows = final[final['full_name'].str.contains('Tkachuk', case=False, na=False)]
if not tkachuk_rows.empty:
    print("\n--- TKACHUK BROTHERS ---")
    print(tkachuk_rows[['full_name','position','off_rating','def_rating','overall_rating',
                         'finishing_pct']].to_string())

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
    war = war_data.get(row['player_id'], {})
    if war:
        data.update({
            'war_total':  war.get('war_total'),
            'war_ev_off': war.get('war_ev_off'),
            'war_ev_def': war.get('war_ev_def'),
            'war_pp':     war.get('war_pp'),
            'war_pk':     war.get('war_pk'),
        })
    result = sb.table('players').update(data).eq('player_id', row['player_id']).execute()
    if result.data:
        updated += 1
    else:
        skipped += 1

print(f"\nDone. Updated: {updated} | Skipped: {skipped}")
