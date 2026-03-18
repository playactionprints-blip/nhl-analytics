#!/usr/bin/env python3
"""
Age curve and market value model for NHL players.

Fits asymmetric age curves from 19 seasons of EH data (07-08 → 25-26),
then computes market value and 7-year WAR trajectories using CURRENT
SEASON WAR (25-26 from player_seasons) so the dollar figure reflects
what a player is worth right now, not a 3-year average.

war_current  — current 25-26 single-season WAR (used for market value)
war_total    — 3-year weighted WAR from compute_ratings.py (for the
               ratings card; unchanged by this script)

Usage:
    cd data-pipeline
    python3 -u -c "
import os
with open('../.env.local') as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ[k] = v
            if k.startswith('NEXT_PUBLIC_'):
                os.environ[k[len('NEXT_PUBLIC_'):]] = v
if 'SUPABASE_KEY' not in os.environ:
    os.environ['SUPABASE_KEY'] = os.environ.get('SUPABASE_ANON_KEY', '')
exec(open('build_market_value.py').read())
"

SQL migration (run in Supabase SQL editor before running this script):
    alter table players add column if not exists war_current    float8;
    alter table players add column if not exists market_value   float8;
    alter table players add column if not exists surplus_value  float8;
    alter table players add column if not exists war_trajectory jsonb default '[]';
    alter table players add column if not exists peak_age       int;
    alter table players add column if not exists age_curve_phase text;
"""

import math
import os
import warnings

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit
from supabase import create_client
from sync_log import install_sync_logger

warnings.filterwarnings('ignore')
install_sync_logger('market_value')

# ── Supabase ───────────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv('SUPABASE_URL') or os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Constants ──────────────────────────────────────────────────────────────────
CAP_BY_SEASON = {
    '07-08': 50_300_000, '08-09': 56_700_000, '09-10': 56_800_000,
    '10-11': 59_400_000, '11-12': 64_300_000, '12-13': 70_200_000,
    '13-14': 64_300_000, '14-15': 69_000_000, '15-16': 71_400_000,
    '16-17': 73_000_000, '17-18': 75_000_000, '18-19': 79_500_000,
    '19-20': 81_500_000, '20-21': 81_500_000, '21-22': 81_500_000,
    '22-23': 82_500_000, '23-24': 83_500_000, '24-25': 88_000_000,
    '25-26': 88_000_000,
}

FUTURE_CAP_GROWTH = 2_500_000      # projected cap growth per year after 25-26
MIN_SALARY        = 775_000
CURRENT_SEASON    = '25-26'
CURRENT_CAP       = CAP_BY_SEASON[CURRENT_SEASON]
COVID_SEASON      = '20-21'
COVID_WEIGHT      = 0.68

# Market value calibration — adapted for our RAPM-WAR scale where elite
# players peak at ~3.0–3.5 WAR (vs 6–8 in some public models).
#
# Validation anchors (all based on 25-26 single-season WAR):
#   McDavid  3.40 WAR → $15.84M  (cap $12.5M → +$3.3M surplus, slight bargain)
#   Kucherov 2.08 WAR → $9.51M   (cap $9.5M  → nearly exact fair value)
#   Celebrini 1.68 WAR → $7.83M  (cap $0.975M → +$6.9M ELC bargain)
#   Depth 0.5 WAR → $2.88M       (reasonable for 3rd/4th line contributors)
WAR_LINEAR_RATE      = 4_200_000   # $ per WAR above replacement
WAR_PREMIUM_ABOVE    = 2.5         # quadratic premium kicks in above this WAR
WAR_PREMIUM_COEFF    = 1_500_000   # $ per (WAR - WAR_PREMIUM_ABOVE)^2
MAX_MKT_VALUE_PCT    = 0.18        # hard cap at 18% of cap ceiling (~$15.84M)


# ── Helpers ────────────────────────────────────────────────────────────────────
def safe_float(v):
    if v is None:
        return None
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except Exception:
        return None


def season_start_year(s):
    """'25-26' → 2025,  '07-08' → 2007"""
    return 2000 + int(s.split('-')[0])


def pos_group(pos_str):
    """Return 'F', 'D', or None.  Handles multi-position like 'C/L', 'D/R'."""
    if not pos_str:
        return None
    primary = str(pos_str).split('/')[0].strip().upper()
    if primary in ('C', 'L', 'R', 'F'):
        return 'F'
    if primary == 'D':
        return 'D'
    return None


def compute_market_value(war, cap_ceiling):
    """
    Nonlinear WAR → market value.
    Linear base + quadratic star premium above WAR_PREMIUM_ABOVE.
    Calibrated so McDavid (3.40 WAR) hits the cap at 18% of $88M.
    """
    if war is None or war <= 0:
        return MIN_SALARY
    base = MIN_SALARY + (war * WAR_LINEAR_RATE)
    if war > WAR_PREMIUM_ABOVE:
        excess = war - WAR_PREMIUM_ABOVE
        base  += excess * excess * WAR_PREMIUM_COEFF
    return min(round(base), int(cap_ceiling * MAX_MKT_VALUE_PCT))


def project_war(cur_war, cur_age, fut_age, params):
    """
    Project WAR from cur_age to fut_age using the fitted age curve.

    Positive WAR: grows before peak_age, declines after.
    Negative WAR: magnitude shrinks (improves) before peak, grows (worsens)
    after — preserving the direction of change for below-average players.
    """
    if cur_war is None:
        return None
    peak_age, _pval, growth_rate, decline_rate = params
    grow_yrs = max(0.0, min(fut_age, peak_age) - cur_age)
    decl_yrs = max(0.0, fut_age - max(cur_age, peak_age))

    if cur_war >= 0:
        proj = cur_war * (1.0 + growth_rate) ** grow_yrs * (1.0 - decline_rate) ** decl_yrs
        return max(proj, 0.0)
    else:
        # Negative: magnitude shrinks before peak (getting better), grows after
        proj = cur_war * (1.0 - growth_rate) ** grow_yrs * (1.0 + decline_rate) ** decl_yrs
        return min(proj, 0.0)


def projected_cap(years_ahead):
    return CURRENT_CAP + years_ahead * FUTURE_CAP_GROWTH


def fmt_d(v):
    return f"${v:>10,.0f}" if v is not None else f"{'—':>11}"


def fmt_s(v):
    return f"${v:>+10,.0f}" if v is not None else f"{'—':>11}"


# ── Step 1: Load historical EH data ───────────────────────────────────────────
print("=" * 64)
print("STEP 1 — Loading historical EH data")
print("=" * 64)

_here     = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else os.getcwd()
_data_dir = os.path.join(_here, 'data')

df_all = pd.read_csv(os.path.join(_data_dir, 'eh_skaters_all_seasons.csv'))
print(f"  Rows: {len(df_all):,}  |  Seasons: {df_all['Season'].nunique()}"
      f"  |  Players: {df_all['Player'].nunique():,}")
print(f"  Season range: {df_all['Season'].min()} → {df_all['Season'].max()}")

# COVID weight; primary position group; drop goalies
df_all['season_wt'] = df_all['Season'].map(
    lambda s: COVID_WEIGHT if s == COVID_SEASON else 1.0)
df_all['pos_grp'] = df_all['Position'].map(pos_group)
df_sk = df_all[df_all['pos_grp'].isin(['F', 'D'])].copy()

# ── Step 2: Compute WAR proxy ──────────────────────────────────────────────────
print("\nSTEP 2 — Computing WAR proxy (all seasons)")

df_sk['toi_h'] = df_sk['TOI'] / 60.0
min_toi_h      = 200 / 60.0
df_sk          = df_sk[df_sk['toi_h'] >= min_toi_h].copy()

df_sk['ixg_60'] = df_sk['ixG'] / df_sk['toi_h']
df_sk['a1_60']  = df_sk['A1']  / df_sk['toi_h']
df_sk['icf_60'] = df_sk['iCF'] / df_sk['toi_h']

la = (df_sk.groupby('Season')[['ixg_60', 'a1_60', 'icf_60']]
          .mean().reset_index()
          .rename(columns={'ixg_60': 'lg_ixg60',
                           'a1_60':  'lg_a160',
                           'icf_60': 'lg_icf60'}))
df_sk = df_sk.merge(la, on='Season')

df_sk['war_proxy'] = (
    (df_sk['ixg_60'] - df_sk['lg_ixg60']) * 0.40 +
    (df_sk['a1_60']  - df_sk['lg_a160'])  * 0.35 +
    (df_sk['icf_60'] - df_sk['lg_icf60']) * 0.10
) * df_sk['toi_h'] / 6.0

print(f"  Qualified player-seasons (≥200 min): {len(df_sk):,}")
print(f"  WAR proxy — mean: {df_sk['war_proxy'].mean():.4f}  "
      f"std: {df_sk['war_proxy'].std():.3f}  "
      f"range: [{df_sk['war_proxy'].min():.2f}, {df_sk['war_proxy'].max():.2f}]")

# ── Step 3: Fetch player data from Supabase ────────────────────────────────────
print("\nSTEP 3 — Fetching player data from Supabase")

rows, start = [], 0
while True:
    batch = (sb.table('players')
               .select('player_id,full_name,position,birth_date,war_total,contract_info,age')
               .range(start, start + 999)
               .execute().data)
    rows.extend(batch)
    if len(batch) < 1000:
        break
    start += 1000

players_df = pd.DataFrame(rows)
print(f"  Fetched {len(players_df):,} players")

# Build name → player lookup (skaters with birth dates)
name_lookup: dict = {}
for _, r in players_df.iterrows():
    bd = r.get('birth_date')
    if r['position'] == 'G' or not bd or not isinstance(bd, str):
        continue
    name_lookup[str(r['full_name']).strip()] = {
        'player_id':     r['player_id'],
        'position':      r['position'],
        'birth_date':    r['birth_date'],
        'war_total':     safe_float(r.get('war_total')),
        'contract_info': r.get('contract_info') or {},
        'age':           safe_float(r.get('age')),
    }

print(f"  Skaters with birth_date: {len(name_lookup):,}")

# ── Step 3b: Fetch current-season WAR from player_seasons ─────────────────────
print("\nSTEP 3b — Fetching 25-26 WAR from player_seasons")

ps_rows = (sb.table('player_seasons')
             .select('player_id,war_total,war_ev_off,war_ev_def,war_pp,war_pk,'
                     'war_shooting,war_penalties')
             .eq('season', CURRENT_SEASON)
             .execute().data)

# player_id → current-season war_total
current_war_lookup: dict = {}
for r in ps_rows:
    pid  = r['player_id']
    cwar = safe_float(r.get('war_total'))
    if cwar is not None:
        current_war_lookup[pid] = cwar

print(f"  25-26 WAR available for {len(current_war_lookup):,} players")

# Spot-check calibration anchors before fitting anything
print(f"\n  Calibration anchors (current-season WAR → market value):")
print(f"  {'Player':<22} {'Curr WAR':>9} {'Mkt Val':>11}  (target)")
anchors = [
    ('Connor McDavid',   'C, ~$15.8M = cap ×18%'),
    ('Nikita Kucherov',  'R, ~$9.5M = fair for cap'),
    ('Macklin Celebrini','C, ~$7.8M vs $975K ELC'),
]
all_p = {r['player_id']: r['full_name']
         for r in players_df.to_dict('records')}
pid_map = {v['full_name']: k for k, v in
           {r['player_id']: {'full_name': r['full_name']}
            for r in players_df.to_dict('records')}.items()}

for (name, note) in anchors:
    pid = next((r['player_id'] for r in players_df.to_dict('records')
                if r['full_name'] == name), None)
    cwar = current_war_lookup.get(pid)
    mv   = compute_market_value(cwar, CURRENT_CAP) if cwar is not None else None
    mv_s = f"${mv:,.0f}" if mv else "—"
    cwar_s = f"{cwar:.2f}" if cwar is not None else "—"
    print(f"  {name:<22} {cwar_s:>9}  {mv_s:>11}  ({note})")

# ── Step 4: Assign ages to historical EH data ──────────────────────────────────
print("\nSTEP 4 — Matching EH players to Supabase (birth dates)")


def get_birth_year(player_name):
    info = name_lookup.get(str(player_name).strip())
    if info:
        bd = info.get('birth_date')
        if bd and isinstance(bd, str) and len(bd) >= 4:
            try:
                return int(bd[:4])
            except (ValueError, TypeError):
                pass
    return None


df_sk['birth_yr'] = df_sk['Player'].map(get_birth_year)
df_sk['age_at_season'] = df_sk.apply(
    lambda r: season_start_year(r['Season']) - r['birth_yr']
    if pd.notna(r['birth_yr']) else None, axis=1)

matched = df_sk['age_at_season'].notna().sum()
print(f"  Matched {matched:,}/{len(df_sk):,} player-seasons "
      f"({100 * matched / len(df_sk):.1f}%) to birth dates")

curve_df = df_sk[
    df_sk['age_at_season'].notna() &
    df_sk['age_at_season'].between(17, 44)
].copy()
print(f"  Age-curve observations (17–44): {len(curve_df):,}")

# ── Step 5: Fit age curves ─────────────────────────────────────────────────────
print("\nSTEP 5 — Fitting asymmetric age curves")
print()


def age_curve_model(age, peak_age, peak_value, growth_rate, decline_rate):
    delta = np.asarray(age, dtype=float) - peak_age
    return np.where(
        delta < 0,
        peak_value * (1.0 + growth_rate) ** delta,
        peak_value * (1.0 - decline_rate) ** delta,
    )


def fit_group_curve(group_df, label, p0_peak=26.0):
    agg = (group_df
           .groupby('age_at_season')
           .apply(lambda x: np.average(x['war_proxy'], weights=x['season_wt']))
           .reset_index())
    agg.columns = ['age', 'mean_war']

    counts = group_df.groupby('age_at_season').size().reset_index()
    counts.columns = ['age', 'n']
    agg = (agg.merge(counts, on='age')
               .query('n >= 5')
               .sort_values('age')
               .reset_index(drop=True))

    ages = agg['age'].values.astype(float)
    wars = agg['mean_war'].values

    print(f"  [{label}]  {len(group_df):,} obs  |  "
          f"age {int(ages.min())}–{int(ages.max())}  |  "
          f"{len(agg)} bins (≥5 obs each)")

    peak_val_guess = float(wars.max()) if wars.max() > 0 else 0.05
    p0     = [p0_peak, peak_val_guess, 0.08, 0.04]
    bounds = ([20.0, -2.0, 0.005, 0.005],
              [35.0,  2.0, 0.40,  0.25])

    try:
        popt, pcov = curve_fit(
            age_curve_model, ages, wars,
            p0=p0, bounds=bounds, maxfev=8000,
        )
        perr = np.sqrt(np.diag(pcov))
        peak_age_fit, peak_val_fit, growth_fit, decline_fit = popt
        print(f"    Peak age:     {peak_age_fit:.1f}  (±{perr[0]:.2f})")
        print(f"    Peak value:   {peak_val_fit:.4f}")
        print(f"    Growth/yr:    {growth_fit  * 100:.1f}%  (±{perr[2] * 100:.2f}%)")
        print(f"    Decline/yr:   {decline_fit * 100:.1f}%  (±{perr[3] * 100:.2f}%)")
        return popt, agg
    except Exception as exc:
        print(f"    curve_fit failed ({exc}); using literature defaults")
        defaults = {
            'F': np.array([25.0, 0.05, 0.08, 0.04]),
            'D': np.array([26.0, 0.04, 0.07, 0.035]),
        }
        return defaults.get(label, np.array([26.0, 0.05, 0.08, 0.04])), agg


fwd_params, fwd_bins = fit_group_curve(
    curve_df[curve_df['pos_grp'] == 'F'], 'F', p0_peak=25.0)
def_params, def_bins = fit_group_curve(
    curve_df[curve_df['pos_grp'] == 'D'], 'D', p0_peak=26.0)

f_peak, _fv, f_grow, f_decl = fwd_params
d_peak, _dv, d_grow, d_decl = def_params

print(f"\n  Sanity check (hockey literature expectations):")
print(f"    Fwd peak age  {f_peak:.1f}   expected 24–27  "
      + ("✓" if 23 <= f_peak <= 28 else "⚠  CHECK"))
print(f"    Def peak age  {d_peak:.1f}   expected 25–28  "
      + ("✓" if 24 <= d_peak <= 29 else "⚠  CHECK"))
print(f"    Fwd growth    {f_grow * 100:.1f}%/yr  expected 6–12%   "
      + ("✓" if 0.04 <= f_grow <= 0.15 else "⚠  CHECK"))
print(f"    Fwd decline   {f_decl * 100:.1f}%/yr  expected 3–8%    "
      + ("✓" if 0.02 <= f_decl <= 0.12 else "⚠  CHECK"))
print(f"    Def growth    {d_grow * 100:.1f}%/yr  expected 5–10%   "
      + ("✓" if 0.03 <= d_grow <= 0.13 else "⚠  CHECK"))
print(f"    Def decline   {d_decl * 100:.1f}%/yr  expected 2–7%    "
      + ("✓" if 0.02 <= d_decl <= 0.10 else "⚠  CHECK"))

# Blend survivorship-compressed rates with literature when below sensible floors
LIT = {'F': {'grow': 0.08, 'decl': 0.04}, 'D': {'grow': 0.07, 'decl': 0.035}}
BLEND_FLOOR_GROW  = 0.04
BLEND_FLOOR_DECL  = 0.025


def _blend(fitted, lit, floor):
    return (0.5 * fitted + 0.5 * lit) if fitted < floor else fitted


f_grow_proj = _blend(f_grow, LIT['F']['grow'], BLEND_FLOOR_GROW)
f_decl_proj = _blend(f_decl, LIT['F']['decl'], BLEND_FLOOR_DECL)
d_grow_proj = _blend(d_grow, LIT['D']['grow'], BLEND_FLOOR_GROW)
d_decl_proj = _blend(d_decl, LIT['D']['decl'], BLEND_FLOOR_DECL)

fwd_proj_params = np.array([f_peak, fwd_params[1], f_grow_proj, f_decl_proj])
def_proj_params = np.array([d_peak, def_params[1], d_grow_proj, d_decl_proj])

print(f"\n  Projection rates (post-blend):")
print(f"    Fwd  growth {f_grow_proj*100:.1f}%/yr  decline {f_decl_proj*100:.1f}%/yr  peak {f_peak:.1f}")
print(f"    Def  growth {d_grow_proj*100:.1f}%/yr  decline {d_decl_proj*100:.1f}%/yr  peak {d_peak:.1f}")

# ── Step 6: Compute market value and 7-year trajectories ──────────────────────
print("\nSTEP 6 — Computing market value and trajectories")
print("  (using current-season WAR for dollar values; 3yr WAR for trajectory base)")

results = []
for _, player in players_df.iterrows():
    pos = str(player.get('position') or '').strip()
    if pos == 'G':
        continue

    pid      = player['player_id']
    name     = player['full_name']
    war_3yr  = safe_float(player.get('war_total'))   # 3-year weighted (ratings)
    war_curr = current_war_lookup.get(pid)            # current season (market value)
    bd       = player.get('birth_date')
    ci       = player.get('contract_info') or {}

    cur_age = safe_float(player.get('age'))
    if cur_age is None and bd and isinstance(bd, str) and len(bd) >= 4:
        try:
            cur_age = float(season_start_year(CURRENT_SEASON) - int(bd[:4]))
        except (ValueError, TypeError):
            pass

    cap_hit    = safe_float(ci.get('cap_hit'))    if isinstance(ci, dict) else None
    yrs_remain = safe_float(ci.get('years_remaining')) if isinstance(ci, dict) else None
    yrs_remain = int(yrs_remain) if yrs_remain is not None else 0

    pg     = pos_group(pos)
    params = fwd_proj_params if pg == 'F' else def_proj_params
    peak   = f_peak          if pg == 'F' else d_peak

    if cur_age is not None:
        delta_to_peak = peak - cur_age
        if delta_to_peak > 1.5:
            phase = 'improving'
        elif delta_to_peak < -1.5:
            phase = 'declining'
        else:
            phase = 'peak'
    else:
        phase = None

    # Market value uses current-season WAR (reflects what player is worth NOW)
    mv = compute_market_value(war_curr, CURRENT_CAP)
    sv = round(mv - cap_hit) if (cap_hit and cap_hit > 0 and war_curr is not None) else None

    # Trajectory: start from current-season WAR, apply age curve forward
    # Falls back to 3yr WAR if current season not available
    traj_base = war_curr if war_curr is not None else war_3yr

    trajectory = []
    if traj_base is not None and cur_age is not None:
        for y in range(8):
            fut_age  = cur_age + y
            proj_war = project_war(traj_base, cur_age, fut_age, params)
            fut_cap  = projected_cap(y)
            proj_mv  = compute_market_value(proj_war, fut_cap)

            s_start = 25 + y
            s_end   = 26 + y
            season_label = f"{s_start:02d}-{s_end:02d}"

            under   = y < yrs_remain
            surplus = round(proj_mv - cap_hit) if (under and cap_hit) else None

            trajectory.append({
                'year':          y,
                'age':           int(fut_age),
                'season':        season_label,
                'projected_war': round(proj_war, 2),
                'market_value':  proj_mv,
                'cap_hit':       int(cap_hit) if under and cap_hit else None,
                'surplus_value': surplus,
            })

    results.append({
        'player_id':       pid,
        'full_name':       name,
        'position':        pos,
        'war_total':       war_3yr,    # 3yr weighted — NOT modified here
        'war_current':     war_curr,   # current season — stored separately
        'current_age':     cur_age,
        'cap_hit':         cap_hit,
        'market_value':    mv if war_curr is not None else None,
        'surplus_value':   sv,
        'peak_age':        int(round(peak)),
        'age_curve_phase': phase,
        'war_trajectory':  trajectory,
    })

res = pd.DataFrame(results)
has_curr = res['war_current'].notna()
print(f"  Market value computed for {has_curr.sum()}/{len(res)} skaters "
      f"(with current-season WAR)")

# ── Step 7: Surplus leaderboards (by current-season WAR) ─────────────────────
hdr = (f"  {'Player':<26} {'Pos':>3} {'Curr WAR':>9} {'3yr WAR':>8} "
       f"{'Mkt Val':>11} {'Cap Hit':>11} {'Surplus':>12}")
sep = (f"  {'-'*26} {'-'*3} {'-'*9} {'-'*8} "
       f"{'-'*11} {'-'*11} {'-'*12}")


def print_row(r):
    cw = f"{r['war_current']:>9.2f}" if r['war_current'] is not None else f"{'—':>9}"
    tw = f"{r['war_total']:>8.2f}" if r['war_total'] is not None else f"{'—':>8}"
    print(f"  {r['full_name']:<26} {r['position']:>3} {cw} {tw} "
          f"{fmt_d(r['market_value'])} {fmt_d(r['cap_hit'])} {fmt_s(r['surplus_value'])}")


print("\n--- TOP 10 SURPLUS VALUE (most team-friendly contracts) ---")
print(hdr); print(sep)
for _, r in res[res['surplus_value'].notna()].nlargest(10, 'surplus_value').iterrows():
    print_row(r)

print("\n--- BOTTOM 10 SURPLUS VALUE (most overpaid) ---")
print(hdr); print(sep)
for _, r in res[res['surplus_value'].notna()].nsmallest(10, 'surplus_value').iterrows():
    print_row(r)

# ── Step 8: Key player spotlight ──────────────────────────────────────────────
print("\nSTEP 8 — Key player spotlight")
spotlight_names = [
    'Connor McDavid', 'Nathan MacKinnon', 'Leon Draisaitl',
    'Nikita Kucherov', 'Auston Matthews', 'Macklin Celebrini',
    'Connor Bedard', 'Matthew Schaefer',
]

for sname in spotlight_names:
    row = res[res['full_name'] == sname]
    if row.empty:
        print(f"\n  {sname}: not found in DB")
        continue
    r      = row.iloc[0]
    age_s  = f"{int(r['current_age'])}" if r['current_age'] is not None else "—"
    cw_s   = f"{r['war_current']:.2f}" if r['war_current'] is not None else "—"
    tw_s   = f"{r['war_total']:.2f}" if r['war_total'] is not None else "—"
    print(f"\n  {sname}  |  Age {age_s}  |  {r['position']}"
          f"  |  WAR curr {cw_s}  3yr {tw_s}"
          f"  |  Phase: {r['age_curve_phase'] or '—'}")
    print(f"    Market value: {fmt_d(r['market_value']).strip()}"
          f"   Cap hit: {fmt_d(r['cap_hit']).strip() if r['cap_hit'] else '—'}"
          f"   Surplus: {fmt_s(r['surplus_value']).strip() if r['surplus_value'] is not None else '—'}")
    if r['war_trajectory']:
        print(f"    {'Season':<8} {'Age':>4} {'WAR':>6} {'Mkt Val':>11} "
              f"{'Cap Hit':>11} {'Surplus':>12}")
        for t in r['war_trajectory']:
            ch  = fmt_d(t['cap_hit'])       if t['cap_hit']    else f"{'—':>11}"
            sv2 = fmt_s(t['surplus_value']) if t['surplus_value'] is not None else f"{'—':>12}"
            print(f"    {t['season']:<8} {t['age']:>4} {t['projected_war']:>6.2f} "
                  f"{fmt_d(t['market_value'])} {ch} {sv2}")

# ── Step 9: Upload to Supabase ─────────────────────────────────────────────────
print("\nSTEP 9 — Uploading to Supabase")
print("  SQL migration (run in editor if columns are missing):")
print("    alter table players add column if not exists war_current    float8;")
print("    alter table players add column if not exists market_value   float8;")
print("    alter table players add column if not exists surplus_value  float8;")
print("    alter table players add column if not exists war_trajectory jsonb default '[]';")
print("    alter table players add column if not exists peak_age       int;")
print("    alter table players add column if not exists age_curve_phase text;")
print()

updated = failed = 0
for _, row in res.iterrows():
    cw_val  = None if row['war_current'] is None else float(row['war_current'])
    mv_val  = None if row['market_value'] is None else float(row['market_value'])
    sv_val  = (None if (pd.isna(row['surplus_value']) or row['surplus_value'] is None)
               else float(row['surplus_value']))
    pa_val  = None if row['peak_age'] is None else int(row['peak_age'])
    traj    = row['war_trajectory'] if row['war_trajectory'] else []

    payload = {
        'war_current':     cw_val,
        'market_value':    mv_val,
        'surplus_value':   sv_val,
        'war_trajectory':  traj,
        'peak_age':        pa_val,
        'age_curve_phase': row['age_curve_phase'],
    }
    try:
        result = (sb.table('players')
                    .update(payload)
                    .eq('player_id', int(row['player_id']))
                    .execute())
        if result.data:
            updated += 1
        else:
            failed += 1
    except Exception as exc:
        failed += 1
        if failed <= 3:
            print(f"  Upload error ({row['full_name']}): {exc}")
        if failed == 1:
            print("  → Run the SQL migration above in Supabase editor, then re-run.")

print(f"  Updated: {updated}  |  Failed: {failed}")
print("\nDone.")
