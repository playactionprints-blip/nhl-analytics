#!/usr/bin/env python3
"""
Compute 3-year weighted ratings from player_seasons table.
Season weights: 25-26 → 50%,  24-25 → 30%,  23-24 → 20%
Qualify: ≥20 GP in current season  OR  ≥40 GP combined across seasons.
"""
import pandas as pd
import numpy as np
import os
import math
from collections import defaultdict
from supabase import create_client
from sync_log import install_sync_logger

install_sync_logger('ratings')

SUPABASE_URL = os.getenv('SUPABASE_URL') or os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

SEASON_WEIGHTS = {'25-26': 0.50, '24-25': 0.30, '23-24': 0.20}
CURRENT_SEASON  = '25-26'

# ── Fetch data ────────────────────────────────────────────────────────────────
SEASONS = ['25-26', '24-25', '23-24']
PS_COLS = (
    'player_id,season,gp,toi,g,a1,a2,ixg,icf,tka,gva,xgf_pct,hdcf_pct,cf_pct,scf_pct,'
    'fow,fol,cf_pct_pk,toi_5v5,toi_pp,toi_pk,xgf_pp,xga_pk,penalty_minutes_drawn,penalty_minutes_taken,'
    'rapm_off,rapm_def,rapm_off_pct,rapm_def_pct,qot_impact,qoc_impact,qot_impact_pct,qoc_impact_pct'
)

print("Fetching player_seasons (per-season to avoid row limit)...")
ps_rows = []
for s in SEASONS:
    batch = sb.table('player_seasons').select(PS_COLS).eq('season', s).execute().data
    ps_rows.extend(batch)
    print(f"  {s}: {len(batch)} rows")
print(f"  Total: {len(ps_rows)} season rows")
missing_split_counts = {}
for s in SEASONS:
    season_rows = [r for r in ps_rows if r.get('season') == s]
    missing_split_counts[s] = sum(1 for r in season_rows if r.get('toi_5v5') is None)
if any(missing_split_counts.values()):
    print("  Warning: missing 5v5 split rows detected on player_seasons")
    for s in SEASONS:
        if missing_split_counts[s]:
            print(f"    {s}: {missing_split_counts[s]} rows missing toi_5v5")
    print("  → Run upload_nst_splits.py (or rebuild via upload_seasons.py) before trusting season EV trends.")

print("Fetching players + RAPM + finishing/PP data...")
player_info = {p['player_id']: p for p in
               sb.table('players').select('player_id,full_name,position').execute().data}

# Fetch RAPM values (columns may not exist if build_rapm.py hasn't run yet)
rapm_lookup = {}
try:
    rapm_rows = sb.table('players').select(
        'player_id,rapm_off,rapm_def,rapm_off_pct,rapm_def_pct,qot_impact,qoc_impact,qot_impact_pct,qoc_impact_pct'
    ).execute().data
    for r in rapm_rows:
        if r.get('rapm_off') is not None or r.get('rapm_def') is not None:
            rapm_lookup[r['player_id']] = {
                'rapm_off':     r.get('rapm_off'),
                'rapm_def':     r.get('rapm_def'),
                'rapm_off_pct': r.get('rapm_off_pct'),
                'rapm_def_pct': r.get('rapm_def_pct'),
                'qot_impact':   r.get('qot_impact'),
                'qoc_impact':   r.get('qoc_impact'),
                'qot_impact_pct': r.get('qot_impact_pct'),
                'qoc_impact_pct': r.get('qoc_impact_pct'),
            }
    print(f"  {len(rapm_lookup)} players with RAPM data")
except Exception as e:
    print(f"  RAPM columns not found — run build_rapm.py first ({e})")
    print("  SQL to add columns:")
    print("    alter table players add column if not exists rapm_off float8;")
    print("    alter table players add column if not exists rapm_def float8;")

# Fetch toi_pp and penalty totals (finishing_pct now computed from player_seasons below)
extra_lookup = {}
try:
    extra_rows = sb.table('players').select(
        'player_id,toi_pp,penalties_drawn,penalties_taken,penalty_minutes_drawn,penalty_minutes_taken'
    ).execute().data
    for r in extra_rows:
        tpp = r.get('toi_pp')
        pens_drawn = r.get('penalties_drawn')
        pens_taken = r.get('penalties_taken')
        pmd = r.get('penalty_minutes_drawn')
        pmt = r.get('penalty_minutes_taken')
        if tpp is not None or pens_drawn is not None or pens_taken is not None or pmd is not None or pmt is not None:
            extra_lookup[r['player_id']] = {
                'toi_pp': tpp,
                'penalties_drawn': pens_drawn,
                'penalties_taken': pens_taken,
                'penalty_minutes_drawn': pmd,
                'penalty_minutes_taken': pmt,
            }
    tpp_count = sum(1 for v in extra_lookup.values() if v.get('toi_pp') is not None)
    pen_count = sum(1 for v in extra_lookup.values() if v.get('penalty_minutes_drawn') is not None or v.get('penalty_minutes_taken') is not None)
    print(f"  {tpp_count} with toi_pp, {pen_count} with penalty totals")
except Exception as e:
    print(f"  Could not fetch toi_pp/penalties ({e}) — run upload_nst_splits.py and upload_penalties.py first")


def safe(v):
    if v is None: return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except: return None


def fmt_metric(value):
    return f"{value:.2f}" if value is not None and not pd.isna(value) else "  — "


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
        # finishing_pct: 3-year weighted goals/ixG ratio.
        # Uses the same w_g and w_ixg accumulators as everything else.
        # Threshold = 10.0 on the weighted ixG sum — equivalent to requiring ~10 ixG/season
        # for a 3-year player, or ~20 ixG in a single current season.
        # This filters out small-sample outliers (rookies, callups, D-men with lucky streaks)
        # that would otherwise dominate the finishing leaderboard over established forwards.
        'finishing_pct': round(w_g / w_ixg, 4) if w_ixg >= 10.0 else None,
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
        'qot_impact':    safe(rapm.get('qot_impact')),
        'qoc_impact':    safe(rapm.get('qoc_impact')),
        'qot_impact_pct': safe(rapm.get('qot_impact_pct')),
        'qoc_impact_pct': safe(rapm.get('qoc_impact_pct')),
    })

df = pd.DataFrame(records)
print(f"Processing {len(df)} qualified skaters (3-season weighted)")


# ── Rating computation ────────────────────────────────────────────────────────
def pct_rank(series):
    return series.rank(pct=True, na_option='keep') * 100


def compute_group(subdf, is_defense):
    subdf = subdf.copy()

    # Offensive weights differ by position:
    # Forwards: finishing_pct included (direct scoring impact)
    # Defense: finishing_pct excluded (D-men not evaluated on finishing per industry standard)
    OFF_WEIGHTS_FWD = {
        'ixg_60':        0.28,
        'a1_60':         0.20,
        'rapm_off_pct':  0.20,
        'pts_60':        0.08,
        'icf_60':        0.08,
        'xgf_pct':       0.08,
        'finishing_pct': 0.08,
    }
    OFF_WEIGHTS_DEF = {
        'ixg_60':        0.30,
        'a1_60':         0.22,
        'rapm_off_pct':  0.22,
        'pts_60':        0.10,
        'icf_60':        0.08,
        'xgf_pct':       0.08,
    }
    OFF_WEIGHTS = OFF_WEIGHTS_DEF if is_defense else OFF_WEIGHTS_FWD
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

    # Defensive rating weights — updated based on hockey analytics literature.
    # xGF%/HDCF% reduced (18% each): these are possession/linemate metrics,
    # not purely individual defensive metrics.
    # RAPM Def increased to 20%: only truly individual defensive metric,
    # controls for teammates and opponents via ridge regression.
    # cf_pct_pk increased to 15%: PK performance is more individually meaningful.
    # tka_60 increased to 16%, gva_inv to 10%: individual defensive actions.
    # All weights sum to 1.00.
    subdf['gva_inv'] = subdf['gva_60'] * -1
    DEF_WEIGHTS = {
        'xgf_pct':      0.18,
        'hdcf_pct':     0.18,
        'cf_pct':       0.03,
        'tka_60':       0.16,
        'gva_inv':      0.10,
        'cf_pct_pk':    0.15,
        'rapm_def_pct': 0.20,
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

# ── Finishing validation ───────────────────────────────────────────────────────
print("\n--- TOP 10 FINISHERS (3yr weighted goals/ixG) ---")
_fin = final[final['finishing_pct'].notna()].copy()
_fin_top = _fin.nlargest(10, 'finishing_pct')
print(f"  {'Player':<26} {'Pos':>3} {'G/ixG ratio':>12} {'Finishing%':>11}")
print(f"  {'-'*26} {'-'*3} {'-'*12} {'-'*11}")
for _, r in _fin_top.iterrows():
    fp_pct = r.get('op_finishing_pct')
    fp_pct_s = f"{fp_pct:.1f}" if fp_pct is not None and not pd.isna(fp_pct) else "—"
    print(f"  {r['full_name']:<26} {r['position']:>3} {r['finishing_pct']:>12.4f} {fp_pct_s:>11}")

_mc = final[final['full_name'] == 'Connor McDavid']
if not _mc.empty:
    r = _mc.iloc[0]
    fp_pct = r.get('op_finishing_pct')
    print(f"\n  McDavid finishing: ratio={r['finishing_pct']:.4f}  pct={fp_pct:.1f}  "
          f"(target: 70–85th pct per JFresh)")

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

GOALS_PER_WIN      = 6.0
# EV_OFF_REPLACEMENT and EV_DEF_REPLACEMENT_FWD/D are computed empirically after ratings
# (see below) so they stay calibrated to whatever alpha build_rapm.py last used.
# RAPM_OFF_PLAYER_SHARE (1/5) and DEF_RAPM_SHARE (1/14 fwd, 1/10 D) are removed — the
# Ridge regression already produces individual-level coefficients; the old division by
# 5 or 14 was double-shrinkage that compressed elite players to ~20% of their real value.
SHOOTING_XG_SHRINK = 20.0  # Shrink low-volume finishers toward league average
NET_XG_PER_PENALTY_MIN = 0.11  # Minor-only first-pass estimate of net xG gained per penalty minute
PP_WAR_SHRINK_TOI = 120.0  # Shrink PP on-ice results toward league average
PK_WAR_SHRINK_TOI = 120.0  # Shrink PK on-ice results toward league average

pp_baseline_by_season = {}
pk_baseline_by_season = {}
for season_key in SEASONS:
    season_rows = [sp for sp in ps_rows if sp.get('season') == season_key]
    pp_xgf_total = pp_toi_total = 0.0
    pk_xga_total = pk_toi_total = 0.0
    for sp in season_rows:
        toi_pp_sp = safe(sp.get('toi_pp'))
        xgf_pp_sp = safe(sp.get('xgf_pp'))
        if toi_pp_sp and toi_pp_sp > 0 and xgf_pp_sp is not None:
            pp_xgf_total += xgf_pp_sp
            pp_toi_total += toi_pp_sp

        toi_pk_sp = safe(sp.get('toi_pk'))
        xga_pk_sp = safe(sp.get('xga_pk'))
        if toi_pk_sp and toi_pk_sp > 0 and xga_pk_sp is not None:
            pk_xga_total += xga_pk_sp
            pk_toi_total += toi_pk_sp
    pp_baseline_by_season[season_key] = (pp_xgf_total / pp_toi_total * 60.0) if pp_toi_total > 0 else 6.8
    pk_baseline_by_season[season_key] = (pk_xga_total / pk_toi_total * 60.0) if pk_toi_total > 0 else 6.8

for season_key in SEASONS:
    print(f"  {season_key} PP baseline: {pp_baseline_by_season[season_key]:.2f} xGF/60")
    print(f"  {season_key} PK baseline: {pk_baseline_by_season[season_key]:.2f} xGA/60")

# Empirical RAPM replacement levels — computed from the qualified skater distribution
# so WAR scales correctly regardless of which alpha build_rapm.py last selected.
# EV Off replacement  = mean RAPM Off across all qualified skaters (avg player ≈ 0 WAR).
# EV Def replacement = 35th percentile RAPM Def per position group.
# Industry standard (HockeyStats.com) shows 0 WAR ≈ 37th percentile,
# meaning ~35-37% of qualified players are below replacement level.
# This is more defensible than 20th (too generous) or 50th (too harsh).
_all_rapm_off   = df['rapm_off'].dropna()
_fwd_rapm_def   = df[df['position'] != 'D']['rapm_def'].dropna()
_def_rapm_def   = df[df['position'] == 'D']['rapm_def'].dropna()
ev_off_replacement     = float(_all_rapm_off.mean())              if len(_all_rapm_off) > 0 else 0.0
ev_def_replacement_fwd = float(np.percentile(_fwd_rapm_def, 35))  if len(_fwd_rapm_def) > 0 else 0.0
ev_def_replacement_d   = float(np.percentile(_def_rapm_def, 35))  if len(_def_rapm_def) > 0 else 0.0
print(f"Empirical RAPM replacement levels:")
print(f"  EV Off:       {ev_off_replacement:.4f} xG/60  (mean, all qualified skaters)")
print(f"  EV Def (Fwd): {ev_def_replacement_fwd:.4f} xG/60  (35th pctile, forwards)")
print(f"  EV Def (D):   {ev_def_replacement_d:.4f} xG/60  (35th pctile, defensemen)")


def compute_season_war_component(row, position, ev_off_replacement, ev_def_replacement_fwd, ev_def_replacement_d):
    season_key = row.get('season')
    rapm_off_v = safe(row.get('rapm_off'))
    rapm_def_v = safe(row.get('rapm_def'))
    toi_5v5 = safe(row.get('toi_5v5'))
    toi_pp_sp = safe(row.get('toi_pp'))
    toi_pk_sp = safe(row.get('toi_pk'))
    xgf_pp_v = safe(row.get('xgf_pp'))
    xga_pk_v = safe(row.get('xga_pk'))
    g_val = safe(row.get('g'))
    ixg_val = safe(row.get('ixg'))
    pmd = safe(row.get('penalty_minutes_drawn')) or 0.0
    pmt = safe(row.get('penalty_minutes_taken')) or 0.0

    is_defense = position == 'D'
    def_replacement = ev_def_replacement_d if is_defense else ev_def_replacement_fwd

    ev_off = ev_def = pp_war = pk_war = shooting_war = penalties_war = None
    if rapm_off_v is not None and toi_5v5 and toi_5v5 > 0:
        ev_off = (rapm_off_v - ev_off_replacement) * (toi_5v5 / 60.0) / GOALS_PER_WIN
    if rapm_def_v is not None and toi_5v5 and toi_5v5 > 0:
        ev_def = (rapm_def_v - def_replacement) * (toi_5v5 / 60.0) / GOALS_PER_WIN

    if toi_pp_sp and toi_pp_sp > 0 and xgf_pp_v is not None:
        pp_rate = xgf_pp_v / toi_pp_sp * 60.0
        pp_shrink = toi_pp_sp / (toi_pp_sp + PP_WAR_SHRINK_TOI)
        pp_baseline = pp_baseline_by_season.get(season_key, 6.8)
        pp_war = ((pp_rate - pp_baseline) * pp_shrink) * (toi_pp_sp / 60.0) / GOALS_PER_WIN

    if toi_pk_sp and toi_pk_sp > 0 and xga_pk_v is not None:
        pk_rate = xga_pk_v / toi_pk_sp * 60.0
        pk_shrink = toi_pk_sp / (toi_pk_sp + PK_WAR_SHRINK_TOI)
        pk_baseline = pk_baseline_by_season.get(season_key, 6.8)
        pk_war = ((pk_baseline - pk_rate) * pk_shrink) * (toi_pk_sp / 60.0) / GOALS_PER_WIN

    if g_val is not None and ixg_val is not None and ixg_val > 0:
        excess_goals = g_val - ixg_val
        shrink = ixg_val / (ixg_val + SHOOTING_XG_SHRINK)
        shooting_war = (excess_goals * shrink) / GOALS_PER_WIN

    if pmd or pmt:
        penalties_war = ((pmd - pmt) * NET_XG_PER_PENALTY_MIN) / GOALS_PER_WIN

    total_war = sum(v for v in (ev_off, ev_def, pp_war, pk_war, shooting_war, penalties_war) if v is not None)
    return {
        'war_ev_off': round(ev_off, 2) if ev_off is not None else None,
        'war_ev_def': round(ev_def, 2) if ev_def is not None else None,
        'war_pp': round(pp_war, 2) if pp_war is not None else None,
        'war_pk': round(pk_war, 2) if pk_war is not None else None,
        'war_shooting': round(shooting_war, 2) if shooting_war is not None else None,
        'war_penalties': round(penalties_war, 2) if penalties_war is not None else None,
        'war_total': round(total_war, 2) if total_war is not None else None,
    }


SEASON_WAR_KEYS = ('war_ev_off', 'war_ev_def', 'war_pp', 'war_pk', 'war_shooting', 'war_penalties')
season_war_updates = []
war_data = {}
for pid, season_data in seasons_by_player.items():
    position = player_info[pid]['position']
    projected = {k: 0.0 for k in SEASON_WAR_KEYS}
    weight_sums = {k: 0.0 for k in SEASON_WAR_KEYS}

    for season_key, row in season_data.items():
        season_war = compute_season_war_component(
            row, position,
            ev_off_replacement, ev_def_replacement_fwd, ev_def_replacement_d,
        )
        season_war_updates.append({
            'player_id': pid,
            'season': season_key,
            **season_war,
        })
        weight = SEASON_WEIGHTS.get(season_key, 0.0)
        for key in SEASON_WAR_KEYS:
            if season_war[key] is None:
                continue
            projected[key] += season_war[key] * weight
            weight_sums[key] += weight

    if not any(weight_sums.values()):
        war_data[pid] = {}
        continue

    player_war = {}
    for key in SEASON_WAR_KEYS:
        player_war[key] = round(projected[key] / weight_sums[key], 2) if weight_sums[key] > 0 else None
    player_war['war_total'] = round(sum(player_war[key] or 0.0 for key in SEASON_WAR_KEYS), 2)
    war_data[pid] = player_war

# Spotlight diagnostic for the new projected card WAR
spotlight = final[final['full_name'] == 'Nathan MacKinnon']
if not spotlight.empty:
    row = spotlight.iloc[0]
    pid = row['player_id']
    print("\n--- PROJECTED 3-YEAR WAR DIAGNOSTIC: Nathan MacKinnon ---")
    for season_key in SEASONS:
        season_row = seasons_by_player.get(pid, {}).get(season_key)
        if not season_row:
            continue
        season_war = next((sw for sw in season_war_updates if sw['player_id'] == pid and sw['season'] == season_key), None)
        if not season_war:
            continue
        print(
            f"  {season_key}: EV Off {fmt_metric(season_war['war_ev_off'])} | EV Def {fmt_metric(season_war['war_ev_def'])} | "
            f"PP {fmt_metric(season_war['war_pp'])} | PK {fmt_metric(season_war['war_pk'])} | "
            f"Shoot {fmt_metric(season_war['war_shooting'])} | Pen {fmt_metric(season_war['war_penalties'])} | "
            f"Total {fmt_metric(season_war['war_total'])}"
        )
    projected_war = war_data.get(pid, {})
    if projected_war:
        print(
            f"  Projected: EV Off {fmt_metric(projected_war['war_ev_off'])} | EV Def {fmt_metric(projected_war['war_ev_def'])} | "
            f"PP {fmt_metric(projected_war['war_pp'])} | PK {fmt_metric(projected_war['war_pk'])} | "
            f"Shoot {fmt_metric(projected_war['war_shooting'])} | Pen {fmt_metric(projected_war['war_penalties'])} | "
            f"Total {fmt_metric(projected_war['war_total'])}"
        )

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
    print(f"  {name:<26}  {pos:>3}  {fmt_metric(d['war_ev_off']):>7}  {fmt_metric(d['war_ev_def']):>7}"
          f"  {fmt_metric(d['war_pp']):>6}  {fmt_metric(d['war_pk']):>6}  {fmt_metric(d['war_shooting']):>7}  {fmt_metric(d['war_penalties']):>6}  {fmt_metric(d['war_total']):>7}")

shoot_list = sorted(
    [(pid, d) for pid, d in war_data.items() if d.get('war_shooting') is not None],
    key=lambda x: x[1]['war_shooting'], reverse=True
)
print(f"\n--- TOP 10 SHOOTING WAR ---")
print(f"  {'Player':<26}  {'Pos':>3}  {'Shoot':>7}  {'Total':>7}")
print(f"  {'-'*26}  {'-'*3}  {'-'*7}  {'-'*7}")
for pid, d in shoot_list[:10]:
    name, pos = name_pos.get(pid, ('?', '?'))
    print(f"  {name:<26}  {pos:>3}  {fmt_metric(d['war_shooting']):>7}  {fmt_metric(d['war_total']):>7}")

print("\nUploading season WAR components to player_seasons...")
season_war_updated = 0
season_war_failed = 0
for row in season_war_updates:
    payload = {
        'war_total': row['war_total'],
        'war_ev_off': row['war_ev_off'],
        'war_ev_def': row['war_ev_def'],
        'war_pp': row['war_pp'],
        'war_pk': row['war_pk'],
        'war_shooting': row['war_shooting'],
        'war_penalties': row['war_penalties'],
    }
    try:
        result = (
            sb.table('player_seasons')
            .update(payload)
            .eq('player_id', int(row['player_id']))
            .eq('season', row['season'])
            .execute()
        )
        if result.data:
            season_war_updated += 1
        else:
            season_war_failed += 1
    except Exception as e:
        season_war_failed += 1
        if season_war_failed == 1:
            print(f"  Season WAR upload error: {e}")
            print("  → Run data-pipeline/migrations/add_card_model_columns.sql in Supabase, then re-run.")
print(f"  player_seasons WAR updated: {season_war_updated} | failed: {season_war_failed}")

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
print("  alter table players add column if not exists goals_against int;")
print("  alter table players add column if not exists shots_against int;")
print("  alter table players add column if not exists expected_goals_against float8;")
print("  alter table players add column if not exists expected_save_pct float8;")
print("  alter table players add column if not exists gsax float8;")
print("  alter table players add column if not exists gsax_pct float8;")
print("  alter table players add column if not exists gsax_per_xga float8;")
print("  alter table players add column if not exists save_pct_above_expected float8;")
print("  alter table players add column if not exists sv_pct_pct float8;")
print("  alter table players add column if not exists gaa_pct float8;")
print("  alter table players add column if not exists win_pct_pct float8;")
print("  alter table players add column if not exists shutout_pct float8;")

goalie_rows = sb.table('players').select(
    'player_id,full_name,position,gp,wins,losses,shutouts,gaa,save_pct,goals_against,shots_against,expected_goals_against,expected_save_pct,gsax,gsax_pct,gsax_per_xga,save_pct_above_expected'
).eq('position', 'G').execute().data

gdf = pd.DataFrame(goalie_rows)
for col in ['gp', 'wins', 'losses', 'shutouts', 'gaa', 'save_pct', 'goals_against', 'shots_against',
            'expected_goals_against', 'expected_save_pct', 'gsax', 'gsax_pct', 'gsax_per_xga', 'save_pct_above_expected']:
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
    gdf['gsax_pct_calc'] = gdf['gsax'].rank(pct=True) * 100 if gdf['gsax'].notna().any() else None
    gdf['sv_ae_pct'] = gdf['save_pct_above_expected'].rank(pct=True) * 100 if gdf['save_pct_above_expected'].notna().any() else None

    gdf['overall_rating'] = (
        gdf['gsax_pct_calc'].fillna(50) * 0.30 +
        gdf['sv_ae_pct'].fillna(50) * 0.25 +
        gdf['sv_pct_pct']  * 0.20 +
        gdf['gaa_pct']     * 0.15 +
        gdf['win_pct_pct'] * 0.05 +
        gdf['shutout_pct'] * 0.05
    ).round(1)

    gdf['percentiles'] = gdf.apply(lambda r: {
        'GSAx':    round(float(r['gsax_pct_calc']), 1) if pd.notna(r.get('gsax_pct_calc')) else None,
        'SVAE':    round(float(r['sv_ae_pct']), 1) if pd.notna(r.get('sv_ae_pct')) else None,
        'SV%':     round(float(r['sv_pct_pct']),  1),
        'GAA':     round(float(r['gaa_pct']),      1),
        'Win%':    round(float(r['win_pct_pct']),  1),
        'SO Rate': round(float(r['shutout_pct']),  1),
    }, axis=1)

    print("\n--- TOP 10 GOALIES ---")
    top10 = gdf.sort_values('overall_rating', ascending=False).head(10)
    print(top10[['full_name','gp','wins','save_pct','gaa','gsax','save_pct_above_expected','shutouts','overall_rating']].to_string())

    g_updated = g_failed = 0
    for _, row in gdf.iterrows():
        data = {
            'overall_rating': float(row['overall_rating']),
            'gsax_pct':       None if pd.isna(row['gsax_pct_calc']) else float(row['gsax_pct_calc']),
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
