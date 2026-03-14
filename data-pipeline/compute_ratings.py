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

SUPABASE_URL = os.getenv('SUPABASE_URL') or os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

SEASON_WEIGHTS = {'25-26': 0.50, '24-25': 0.30, '23-24': 0.20}
CURRENT_SEASON  = '25-26'

# ── Fetch data ────────────────────────────────────────────────────────────────
SEASONS = ['25-26', '24-25', '23-24']
PS_COLS = (
    'player_id,season,gp,toi,g,a1,a2,ixg,icf,tka,gva,xgf_pct,hdcf_pct,cf_pct,scf_pct,'
    'fow,fol,cf_pct_pk,toi_5v5,toi_pp,toi_pk,xgf_pp,xga_pk,penalty_minutes_drawn,penalty_minutes_taken'
)

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

# Fetch finishing_pct, toi_pp, and penalty totals
extra_lookup = {}
try:
    extra_rows = sb.table('players').select(
        'player_id,finishing_pct,toi_pp,penalties_drawn,penalties_taken,penalty_minutes_drawn,penalty_minutes_taken'
    ).execute().data
    for r in extra_rows:
        fp  = r.get('finishing_pct')
        tpp = r.get('toi_pp')
        pens_drawn = r.get('penalties_drawn')
        pens_taken = r.get('penalties_taken')
        pmd = r.get('penalty_minutes_drawn')
        pmt = r.get('penalty_minutes_taken')
        if fp is not None or tpp is not None or pens_drawn is not None or pens_taken is not None or pmd is not None or pmt is not None:
            extra_lookup[r['player_id']] = {
                'finishing_pct': fp,
                'toi_pp': tpp,
                'penalties_drawn': pens_drawn,
                'penalties_taken': pens_taken,
                'penalty_minutes_drawn': pmd,
                'penalty_minutes_taken': pmt,
            }
    fp_count  = sum(1 for v in extra_lookup.values() if v.get('finishing_pct') is not None)
    tpp_count = sum(1 for v in extra_lookup.values() if v.get('toi_pp') is not None)
    pen_count = sum(1 for v in extra_lookup.values() if v.get('penalty_minutes_drawn') is not None or v.get('penalty_minutes_taken') is not None)
    print(f"  {fp_count} players with finishing_pct, {tpp_count} with toi_pp, {pen_count} with penalty totals")
except Exception as e:
    print(f"  Could not fetch finishing_pct/toi_pp/penalties ({e}) — run upload_nst_splits.py and upload_penalties.py first")


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
    w_toi_5v5 = w_toi_pp = w_toi_pk = 0.0
    w_xgf_pp = w_xga_pk = 0.0
    w_penalty_minutes_drawn = w_penalty_minutes_taken = 0.0
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

        toi_5v5 = safe(row.get('toi_5v5'))
        if toi_5v5 is not None:
            w_toi_5v5 += w * toi_5v5

        toi_pp = safe(row.get('toi_pp'))
        xgf_pp = safe(row.get('xgf_pp'))
        if toi_pp is not None:
            w_toi_pp += w * toi_pp
        if xgf_pp is not None:
            w_xgf_pp += w * xgf_pp

        toi_pk = safe(row.get('toi_pk'))
        xga_pk = safe(row.get('xga_pk'))
        if toi_pk is not None:
            w_toi_pk += w * toi_pk
        if xga_pk is not None:
            w_xga_pk += w * xga_pk

        pmd = safe(row.get('penalty_minutes_drawn'))
        if pmd is not None:
            w_penalty_minutes_drawn += w * pmd

        pmt = safe(row.get('penalty_minutes_taken'))
        if pmt is not None:
            w_penalty_minutes_taken += w * pmt

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
        'curr_g':        safe(curr.get('g')),
        'curr_ixg':      safe(curr.get('ixg')),
        'weighted_g':    round(w_g, 4),
        'weighted_ixg':  round(w_ixg, 4),
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
        'war_toi_5v5':   round(w_toi_5v5, 4),
        'war_toi_pp':    round(w_toi_pp, 4),
        'war_toi_pk':    round(w_toi_pk, 4),
        'war_xgf_pp':    round(w_xgf_pp, 4),
        'war_xga_pk':    round(w_xga_pk, 4),
        'penalties_drawn': safe(extra.get('penalties_drawn')),
        'penalties_taken': safe(extra.get('penalties_taken')),
        'penalty_minutes_drawn': round(w_penalty_minutes_drawn, 4),
        'penalty_minutes_taken': round(w_penalty_minutes_taken, 4),
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

    # Offensive rating — ixG/60 28%, A1/60 20%, RAPM_off 20%, Pts/60 8%,
    #                    iCF/60 8%, xGF% 8%, finishing_pct 8%
    # RAPM_off included at 20%: TOI filter (≥200 min) removes small-sample noise,
    # and the improved xG model (NHL API v1 coords) makes RAPM more accurate.
    # Other weights scaled ×0.80 to make room for the 20% RAPM component.
    OFF_WEIGHTS = {
        'ixg_60':        0.28,
        'a1_60':         0.20,
        'rapm_off_pct':  0.20,
        'pts_60':        0.08,
        'icf_60':        0.08,
        'xgf_pct':       0.08,
        'finishing_pct': 0.08,
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
EV_OFF_REPLACEMENT = -0.10
# Empirical calibration: build_rapm coefficients behave more like unit-level
# on-ice effects than final player-share xG/60 values. We scale offense and
# defense separately to bring EV WAR back into a believable range.
RAPM_OFF_PLAYER_SHARE = 1 / 5.0
DEF_RAPM_SHARE_FWD = 1 / 14.0
DEF_RAPM_SHARE_D   = 1 / 10.0
EV_DEF_REPLACEMENT_FWD = 0.07
EV_DEF_REPLACEMENT_D   = 0.04
SHOOTING_XG_SHRINK = 20.0  # Shrink low-volume finishers toward league average
NET_XG_PER_PENALTY_MIN = 0.11  # Minor-only first-pass estimate of net xG gained per penalty minute
PP_WAR_SHRINK_TOI = 120.0  # Shrink PP on-ice results toward league average
PK_WAR_SHRINK_TOI = 120.0  # Shrink PK on-ice results toward league average

# Empirical league baselines from the same 3-year weighted player_seasons split totals.
pp_xgf_total = 0.0
pp_toi_total = 0.0
pk_xga_total = 0.0
pk_toi_total = 0.0
for sp in ps_rows:
    season_weight = SEASON_WEIGHTS.get(sp.get('season'), 0.0)
    toi_pp_sp = safe(sp.get('toi_pp'))
    xgf_pp_sp = safe(sp.get('xgf_pp'))
    if toi_pp_sp and toi_pp_sp > 0 and xgf_pp_sp is not None:
        pp_xgf_total += xgf_pp_sp * season_weight
        pp_toi_total += toi_pp_sp * season_weight

    toi_pk_sp = safe(sp.get('toi_pk'))
    xga_pk_sp = safe(sp.get('xga_pk'))
    if toi_pk_sp and toi_pk_sp > 0 and xga_pk_sp is not None:
        pk_xga_total += xga_pk_sp * season_weight
        pk_toi_total += toi_pk_sp * season_weight

PP_AVG_XGF_PER_60 = (pp_xgf_total / pp_toi_total * 60.0) if pp_toi_total > 0 else 6.8
PK_AVG_XGA_PER_60 = (pk_xga_total / pk_toi_total * 60.0) if pk_toi_total > 0 else 6.8
print(f"League PP baseline: {PP_AVG_XGF_PER_60:.2f} xGF/60")
print(f"League PK baseline: {PK_AVG_XGA_PER_60:.2f} xGA/60")

war_data = {}   # player_id → dict of 3-year weighted WAR components (or {} if missing RAPM/splits)
for _, row in final.iterrows():
    pid        = row['player_id']
    rapm_off_v = safe(row.get('rapm_off'))
    rapm_def_v = safe(row.get('rapm_def'))
    toi_5v5    = safe(row.get('war_toi_5v5'))   # weighted minutes
    toi_pp_sp  = safe(row.get('war_toi_pp'))    # weighted minutes
    toi_pk_sp  = safe(row.get('war_toi_pk'))    # weighted minutes
    xgf_pp_v   = safe(row.get('war_xgf_pp'))
    xga_pk_v   = safe(row.get('war_xga_pk'))

    if rapm_off_v is None or rapm_def_v is None or not toi_5v5:
        war_data[pid] = {}
        continue

    is_defense = row.get('position') == 'D'
    def_share = DEF_RAPM_SHARE_D if is_defense else DEF_RAPM_SHARE_FWD
    def_replacement = EV_DEF_REPLACEMENT_D if is_defense else EV_DEF_REPLACEMENT_FWD
    rapm_off_xg60 = rapm_off_v * RAPM_OFF_PLAYER_SHARE
    rapm_def_xg60 = rapm_def_v * def_share
    h5     = toi_5v5 / 60.0
    ev_off = (rapm_off_xg60 - EV_OFF_REPLACEMENT) * h5 / GOALS_PER_WIN
    ev_def = (rapm_def_xg60 - def_replacement) * h5 / GOALS_PER_WIN

    pp_war = 0.0
    if toi_pp_sp and toi_pp_sp > 0 and xgf_pp_v is not None:
        pp_rate = xgf_pp_v / toi_pp_sp * 60
        pp_shrink = toi_pp_sp / (toi_pp_sp + PP_WAR_SHRINK_TOI)
        pp_war = ((pp_rate - PP_AVG_XGF_PER_60) * pp_shrink) * (toi_pp_sp / 60.0) / GOALS_PER_WIN

    pk_war = 0.0
    if toi_pk_sp and toi_pk_sp > 0 and xga_pk_v is not None:
        pk_rate = xga_pk_v / toi_pk_sp * 60
        pk_shrink = toi_pk_sp / (toi_pk_sp + PK_WAR_SHRINK_TOI)
        pk_war = ((PK_AVG_XGA_PER_60 - pk_rate) * pk_shrink) * (toi_pk_sp / 60.0) / GOALS_PER_WIN

    shooting_war = 0.0
    weighted_g = safe(row.get('weighted_g'))
    weighted_ixg = safe(row.get('weighted_ixg'))
    if weighted_g is not None and weighted_ixg is not None and weighted_ixg > 0:
        excess_goals = weighted_g - weighted_ixg
        shrink = weighted_ixg / (weighted_ixg + SHOOTING_XG_SHRINK)
        shooting_war = (excess_goals * shrink) / GOALS_PER_WIN

    penalties_war = 0.0
    pmd = safe(row.get('penalty_minutes_drawn')) or 0.0
    pmt = safe(row.get('penalty_minutes_taken')) or 0.0
    net_penalty_minutes = pmd - pmt
    if net_penalty_minutes:
        penalties_war = (net_penalty_minutes * NET_XG_PER_PENALTY_MIN) / GOALS_PER_WIN

    war_data[pid] = {
        'war_ev_off': round(ev_off, 2),
        'war_ev_def': round(ev_def, 2),
        'war_pp':     round(pp_war, 2),
        'war_pk':     round(pk_war, 2),
        'war_shooting': round(shooting_war, 2),
        'war_penalties': round(penalties_war, 2),
        'war_total':  round(ev_off + ev_def + pp_war + pk_war + shooting_war + penalties_war, 2),
    }

# Spotlight diagnostic for WAR scaling
spotlight = final[final['full_name'] == 'Nathan MacKinnon']
if not spotlight.empty:
    row = spotlight.iloc[0]
    rapm_off_raw = safe(row.get('rapm_off'))
    rapm_def_raw = safe(row.get('rapm_def'))
    toi_5v5 = safe(row.get('war_toi_5v5'))
    toi_pp_sp = safe(row.get('war_toi_pp'))
    toi_pk_sp = safe(row.get('war_toi_pk'))
    xgf_pp_v = safe(row.get('war_xgf_pp'))
    xga_pk_v = safe(row.get('war_xga_pk'))
    weighted_g = safe(row.get('weighted_g'))
    weighted_ixg = safe(row.get('weighted_ixg'))
    pmd = safe(row.get('penalty_minutes_drawn')) or 0.0
    pmt = safe(row.get('penalty_minutes_taken')) or 0.0
    if rapm_off_raw is not None and rapm_def_raw is not None and toi_5v5:
        is_defense = row.get('position') == 'D'
        def_share = DEF_RAPM_SHARE_D if is_defense else DEF_RAPM_SHARE_FWD
        def_replacement = EV_DEF_REPLACEMENT_D if is_defense else EV_DEF_REPLACEMENT_FWD
        h5 = toi_5v5 / 60.0
        rapm_off_xg60 = rapm_off_raw * RAPM_OFF_PLAYER_SHARE
        rapm_def_xg60 = rapm_def_raw * def_share
        ev_off = (rapm_off_xg60 - EV_OFF_REPLACEMENT) * h5 / GOALS_PER_WIN
        ev_def = (rapm_def_xg60 - def_replacement) * h5 / GOALS_PER_WIN
        pp_war = 0.0
        if toi_pp_sp and toi_pp_sp > 0 and xgf_pp_v is not None:
            pp_rate = xgf_pp_v / toi_pp_sp * 60
            pp_shrink = toi_pp_sp / (toi_pp_sp + PP_WAR_SHRINK_TOI)
            pp_war = ((pp_rate - PP_AVG_XGF_PER_60) * pp_shrink) * (toi_pp_sp / 60.0) / GOALS_PER_WIN
        pk_war = 0.0
        if toi_pk_sp and toi_pk_sp > 0 and xga_pk_v is not None:
            pk_rate = xga_pk_v / toi_pk_sp * 60
            pk_shrink = toi_pk_sp / (toi_pk_sp + PK_WAR_SHRINK_TOI)
            pk_war = ((PK_AVG_XGA_PER_60 - pk_rate) * pk_shrink) * (toi_pk_sp / 60.0) / GOALS_PER_WIN
        shooting_war = 0.0
        if weighted_g is not None and weighted_ixg is not None and weighted_ixg > 0:
            excess_goals = weighted_g - weighted_ixg
            shrink = weighted_ixg / (weighted_ixg + SHOOTING_XG_SHRINK)
            shooting_war = (excess_goals * shrink) / GOALS_PER_WIN
        penalties_war = ((pmd - pmt) * NET_XG_PER_PENALTY_MIN) / GOALS_PER_WIN
        print("\n--- 3-YEAR WEIGHTED WAR DIAGNOSTIC: Nathan MacKinnon ---")
        print(f"  rapm_off raw:   {rapm_off_raw:.4f}")
        print(f"  rapm_def raw:   {rapm_def_raw:.4f}")
        print(f"  toi_5v5 (3yr weighted min):  {toi_5v5:.2f}")
        print(f"  toi_pp  (3yr weighted min):  {toi_pp_sp:.2f}" if toi_pp_sp is not None else "  toi_pp  (3yr weighted min):  None")
        print(f"  weighted g / ixG:            {weighted_g:.2f} / {weighted_ixg:.2f}" if weighted_g is not None and weighted_ixg is not None else "  weighted g / ixG:            None")
        print(f"  rapm_off xG/60: {rapm_off_xg60:.4f}  (raw * {RAPM_OFF_PLAYER_SHARE:.3f})")
        print(f"  rapm_def xG/60: {rapm_def_xg60:.4f}  (raw * {def_share:.3f})")
        print(f"  EV Off WAR = ({rapm_off_xg60:.4f} - ({EV_OFF_REPLACEMENT:.2f})) * ({toi_5v5:.2f}/60) / {GOALS_PER_WIN:.1f} = {ev_off:.2f}")
        print(f"  EV Def WAR = ({rapm_def_xg60:.4f} - ({def_replacement:.2f})) * ({toi_5v5:.2f}/60) / {GOALS_PER_WIN:.1f} = {ev_def:.2f}")
        if toi_pp_sp and toi_pp_sp > 0 and xgf_pp_v is not None:
            pp_per60 = xgf_pp_v / toi_pp_sp * 60
            pp_shrink = toi_pp_sp / (toi_pp_sp + PP_WAR_SHRINK_TOI)
            print(f"  PP WAR     = (({pp_per60:.4f} - {PP_AVG_XGF_PER_60:.2f}) * {pp_shrink:.4f}) * ({toi_pp_sp:.2f}/60) / {GOALS_PER_WIN:.1f} = {pp_war:.2f}")
        if toi_pk_sp and toi_pk_sp > 0 and xga_pk_v is not None:
            pk_per60 = xga_pk_v / toi_pk_sp * 60
            pk_shrink = toi_pk_sp / (toi_pk_sp + PK_WAR_SHRINK_TOI)
            print(f"  PK WAR     = (({PK_AVG_XGA_PER_60:.2f} - {pk_per60:.4f}) * {pk_shrink:.4f}) * ({toi_pk_sp:.2f}/60) / {GOALS_PER_WIN:.1f} = {pk_war:.2f}")
        if weighted_g is not None and weighted_ixg is not None and weighted_ixg > 0:
            excess_goals = weighted_g - weighted_ixg
            shrink = weighted_ixg / (weighted_ixg + SHOOTING_XG_SHRINK)
            print(f"  Shooting WAR = (({weighted_g:.2f} - {weighted_ixg:.2f}) * {shrink:.4f}) / {GOALS_PER_WIN:.1f} = {shooting_war:.2f}")
        print(f"  Penalties WAR = (({pmd:.0f} - {pmt:.0f}) * {NET_XG_PER_PENALTY_MIN:.2f}) / {GOALS_PER_WIN:.1f} = {penalties_war:.2f}")
        print(f"  Total WAR  = {ev_off + ev_def + pp_war + pk_war + shooting_war + penalties_war:.2f}")

# Print top-20 WAR leaderboard
name_pos = {row['player_id']: (row['full_name'], row['position']) for _, row in final.iterrows()}
war_list = sorted(
    [(pid, d) for pid, d in war_data.items() if d.get('war_total') is not None],
    key=lambda x: x[1]['war_total'], reverse=True
)
print(f"\n--- TOP 20 WAR ---")
print(f"  {'Player':<26}  {'Pos':>3}  {'EV Off':>7}  {'EV Def':>7}  {'PP':>6}  {'PK':>6}  {'Shoot':>7}  {'Pen':>6}  {'Total':>7}")
print(f"  {'-'*26}  {'-'*3}  {'-'*7}  {'-'*7}  {'-'*6}  {'-'*6}  {'-'*7}  {'-'*6}  {'-'*7}")
for pid, d in war_list[:20]:
    name, pos = name_pos.get(pid, ('?', '?'))
    print(f"  {name:<26}  {pos:>3}  {d['war_ev_off']:>7.2f}  {d['war_ev_def']:>7.2f}"
          f"  {d['war_pp']:>6.2f}  {d['war_pk']:>6.2f}  {d['war_shooting']:>7.2f}  {d['war_penalties']:>6.2f}  {d['war_total']:>7.2f}")

shoot_list = sorted(
    [(pid, d) for pid, d in war_data.items() if d.get('war_shooting') is not None],
    key=lambda x: x[1]['war_shooting'], reverse=True
)
print(f"\n--- TOP 10 SHOOTING WAR ---")
print(f"  {'Player':<26}  {'Pos':>3}  {'Shoot':>7}  {'Total':>7}")
print(f"  {'-'*26}  {'-'*3}  {'-'*7}  {'-'*7}")
for pid, d in shoot_list[:10]:
    name, pos = name_pos.get(pid, ('?', '?'))
    print(f"  {name:<26}  {pos:>3}  {d['war_shooting']:>7.2f}  {d['war_total']:>7.2f}")

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
qualified_ids = set(final['player_id'].tolist())

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
        'war_total':      None,
        'war_ev_off':     None,
        'war_ev_def':     None,
        'war_pp':         None,
        'war_pk':         None,
        'war_shooting':   None,
        'war_penalties':  None,
    }
    war = war_data.get(row['player_id'], {})
    if war:
        data.update({
            'war_total':  war.get('war_total'),
            'war_ev_off': war.get('war_ev_off'),
            'war_ev_def': war.get('war_ev_def'),
            'war_pp':     war.get('war_pp'),
            'war_pk':     war.get('war_pk'),
            'war_shooting': war.get('war_shooting'),
            'war_penalties': war.get('war_penalties'),
        })
    try:
        result = sb.table('players').update(data).eq('player_id', int(row['player_id'])).execute()
        if result.data:
            updated += 1
        else:
            skipped += 1
    except Exception as e:
        skipped += 1
        if skipped == 1:
            print(f"  Upload error: {e}")
            print("  → Verify all required WAR and penalty columns exist in Supabase, then re-run.")

print(f"\nDone. Updated: {updated} | Skipped: {skipped}")

# Clear stale WAR values for players not included in the current qualified skater set.
# This prevents old WAR rows from lingering on newly added players or players who no
# longer meet the qualification threshold.
print("\nClearing stale skater WAR values...")
all_skater_rows = sb.table('players').select('player_id,position').neq('position', 'G').execute().data
stale_ids = [r['player_id'] for r in all_skater_rows if r['player_id'] not in qualified_ids]
stale_reset = {
    'war_total': None,
    'war_ev_off': None,
    'war_ev_def': None,
    'war_pp': None,
    'war_pk': None,
    'war_shooting': None,
    'war_penalties': None,
}
cleared = 0
for pid in stale_ids:
    try:
        result = sb.table('players').update(stale_reset).eq('player_id', pid).execute()
        if result.data:
            cleared += 1
    except Exception as e:
        if cleared == 0:
            print(f"  Stale WAR clear error: {e}")
            print("  → Verify WAR columns exist, then re-run.")
        break
print(f"  Cleared stale WAR rows: {cleared}")

# ── Goalie Ratings ─────────────────────────────────────────────────────────────
print("\n--- COMPUTING GOALIE RATINGS ---")
print("SQL migration (run in Supabase editor if columns don't exist):")
print("  alter table players add column if not exists sv_pct_pct float8;")
print("  alter table players add column if not exists gaa_pct float8;")
print("  alter table players add column if not exists win_pct_pct float8;")
print("  alter table players add column if not exists shutout_pct float8;")

goalie_rows = sb.table('players').select(
    'player_id,full_name,position,gp,wins,losses,shutouts,gaa,save_pct'
).eq('position', 'G').execute().data

gdf = pd.DataFrame(goalie_rows)
for col in ['gp', 'wins', 'losses', 'shutouts', 'gaa', 'save_pct']:
    gdf[col] = pd.to_numeric(gdf[col], errors='coerce')
gdf['wins']     = gdf['wins'].fillna(0)
gdf['losses']   = gdf['losses'].fillna(0)
gdf['shutouts'] = gdf['shutouts'].fillna(0)
gdf = gdf[gdf['gp'] >= 10].copy()
print(f"Qualified goalies: {len(gdf)} (≥10 GP)")

if len(gdf) > 0:
    gdf['win_pct']       = gdf['wins']     / gdf['gp']
    gdf['shutout_rate']  = gdf['shutouts'] / gdf['gp']

    gdf['sv_pct_pct']   = gdf['save_pct'].rank(pct=True) * 100
    gdf['gaa_pct']      = (1 - gdf['gaa'].rank(pct=True)) * 100   # inverted: lower GAA → higher pct
    gdf['win_pct_pct']  = gdf['win_pct'].rank(pct=True) * 100
    gdf['shutout_pct']  = gdf['shutout_rate'].rank(pct=True) * 100

    gdf['overall_rating'] = (
        gdf['sv_pct_pct']  * 0.40 +
        gdf['gaa_pct']     * 0.35 +
        gdf['win_pct_pct'] * 0.15 +
        gdf['shutout_pct'] * 0.10
    ).round(1)

    gdf['percentiles'] = gdf.apply(lambda r: {
        'SV%':     round(float(r['sv_pct_pct']),  1),
        'GAA':     round(float(r['gaa_pct']),      1),
        'Win%':    round(float(r['win_pct_pct']),  1),
        'SO Rate': round(float(r['shutout_pct']),  1),
    }, axis=1)

    print("\n--- TOP 10 GOALIES ---")
    top10 = gdf.sort_values('overall_rating', ascending=False).head(10)
    print(top10[['full_name','gp','wins','save_pct','gaa','shutouts','overall_rating']].to_string())

    g_updated = g_failed = 0
    for _, row in gdf.iterrows():
        data = {
            'overall_rating': float(row['overall_rating']),
            'sv_pct_pct':     float(row['sv_pct_pct']),
            'gaa_pct':        float(row['gaa_pct']),
            'win_pct_pct':    float(row['win_pct_pct']),
            'shutout_pct':    float(row['shutout_pct']),
            'percentiles':    row['percentiles'],
        }
        try:
            result = sb.table('players').update(data).eq('player_id', row['player_id']).execute()
            if result.data:
                g_updated += 1
            else:
                g_failed += 1
        except Exception as e:
            g_failed += 1
            if g_failed == 1:
                print(f"  Upload error: {e}")
                print("  → Run the SQL migration above in Supabase editor first, then re-run.")
    print(f"Goalie ratings uploaded: {g_updated} | failed: {g_failed}")
