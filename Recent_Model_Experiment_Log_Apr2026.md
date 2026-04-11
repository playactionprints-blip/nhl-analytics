# Recent Model Experiment Log (April 2026)

This file is a focused memory log for the recent JFresh / HockeyStats alignment work.
It captures:
- what was added or changed
- what was removed or deprecated
- what was tested and rejected
- the most important numerical results
- what the current baseline now looks like

## Goals of this phase

- Bring even-strength RAPM, WAR, and player cards closer to JFresh / HockeyStats.
- Keep changes uniform across players rather than adding player-specific rules.
- Preserve the ability to reject experiments and keep the current live baseline when an experiment looks worse.
- Improve current-season alignment first, then explain why 3-year projected cards still differ.

## Major baseline changes that were kept

### 1. EV RAPM was rewritten from event-level to shift-level

Kept in:
- [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/build_rapm.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/build_rapm.py)

What changed:
- even-strength RAPM now fits on shifts/stints rather than shot rows
- two rows per stint: one for each attacking side
- target is shift-level `xGF/60`
- sample weight is full shift length
- offense and defense player blocks are separated
- context flips with attack direction instead of staying in home-team space
- priors stay in the same `xGF/60` space as the target

What was effectively removed:
- event-level EV RAPM as the main fit path
- shot-to-stint rematching as an active regression dependency

Why it mattered:
- this brought the model much closer to JFresh’s public RAPM structure
- it improved season-level behavior enough that later debugging became meaningful

### 2. 37-feature EV xG inference was fixed and kept

Kept in:
- [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/build_rapm.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/build_rapm.py)

What changed:
- live/cache EV xG scoring now uses the full feature schema expected by `xg_model_5v5.json`
- shooter handedness is loaded and used
- card-season stint xG is rebuilt in memory from the clean shot cache

Why it mattered:
- this was the first upstream xG fix that clearly improved RAPM behavior
- at the time of the fix, quick-test outputs improved sharply:
  - LaCombe EV Def season pcts: `24.8`, `69.0`, `91.1`
  - McDavid EV Def season pcts: `99.4`, `99.0`, `80.6`

### 3. Penalties data coverage was fixed

Kept in:
- [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/upload_penalties.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/upload_penalties.py)

What changed:
- season penalty minutes drawn/taken were backfilled and uploaded reliably
- the script now loads env files robustly

Why it mattered:
- McDavid had been missing his penalties component entirely
- this was a data wiring bug, not a model-judgment issue

Important recovered result at the time:
- McDavid `25-26 player_seasons.war_total`: `3.61 -> 4.42`
- McDavid `war_penalties`: `null -> 0.81`
- benchmark Spearman improved: `0.772 -> 0.795`

### 4. Current-season WAR leaderboard source was split from 3-year card WAR

Kept in:
- [/Users/cspeedie/Desktop/nhl-analytics/app/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/page.js)
- [/Users/cspeedie/Desktop/nhl-analytics/app/components/home/FeaturedPlayersPreview.jsx](/Users/cspeedie/Desktop/nhl-analytics/app/components/home/FeaturedPlayersPreview.jsx)
- [/Users/cspeedie/Desktop/nhl-analytics/app/lib/playerCardPageData.js](/Users/cspeedie/Desktop/nhl-analytics/app/lib/playerCardPageData.js)
- [/Users/cspeedie/Desktop/nhl-analytics/PlayerCard.jsx](/Users/cspeedie/Desktop/nhl-analytics/PlayerCard.jsx)

What changed:
- homepage/current-season WAR surfaces now use `player_seasons.war_total` for `25-26`
- cards/compare/history still use `players.war_total` as 3-year projected WAR

What was removed:
- using `players.war_total` as if it were a current-season leaderboard value

Why it mattered:
- it fixed ranking distortions like Stamkos/Lee appearing too high because 3-year card WAR was being shown as a current-season leaderboard

### 5. `upload_seasons.py` no longer wipes enriched `player_seasons` data

Kept in:
- [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/upload_seasons.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/upload_seasons.py)
- [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/refresh_pipeline.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/refresh_pipeline.py)

What changed:
- destructive season delete + reinsert was replaced with row-level upsert keyed on `player_id,season`
- enriched fields such as penalties, RAPM, WAR, and percentiles are preserved
- a canonical refresh pipeline was added:
  1. `upload_seasons.py`
  2. `upload_nst_splits.py`
  3. `upload_penalties.py`
  4. `build_rapm.py`
  5. `compute_ratings.py`
  6. `compute_percentiles.py`

What was removed:
- destructive season refresh behavior
- dependence on legacy/manual ordering

### 6. Bouchard’s stale card percentile bug was fixed

Kept outcome:
- stale percentiles were refreshed by rerunning ratings + percentiles
- a refresh guard was added to fail on impossible EV percentile drift

Important result at the time:
- Bouchard card moved from stale `EV Off 24 / EV Def 21`
- to current high-percentile values matching raw WAR rank much more closely

### 7. Eval shot rebuild path was repaired and kept

Kept in:
- [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/scrape_eval_shots.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/scrape_eval_shots.py)
- [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/scrape_training_shots.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/scrape_training_shots.py)

What changed:
- eval and training shot scrapes now preserve:
  - `event_type`
  - `miss_reason`
  - `prior_miss_reason`
- stale checkpoints/files with empty `event_type` no longer count as complete
- `--force` was added for clean rebuilds
- valid shot rows are no longer dropped just because `hockey_scraper` omitted `xC/yC`
- NHL API enrichment now backfills:
  - `x_coord`
  - `y_coord`
  - `miss_reason`
  - `shooter_id` when inferable

What was removed:
- the old behavior of dropping valid shot rows when `x_coord`/`y_coord` were missing

Why it mattered:
- this turned out to be one of the clearest upstream root causes discovered in this phase

### 8. `24-25` defense-only collinearity reallocation was promoted into the baseline code path

Kept in:
- [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/build_rapm.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/build_rapm.py)

What changed:
- the former experiment `RAPM_EXPERIMENT=collinearity_reallocation_2425_defense`
  is now applied automatically to the baseline `24-25` EV RAPM raw results
- it remains defensemen-only
- it remains uniform
- the experiment flag still exists, but no longer adds a second copy of the same adjustment on top of the promoted baseline

Why it was promoted:
- a clean apples-to-apples full rerun on the rebuilt baseline showed:
  - Bouchard: `EV Off 0.62 -> 0.73`, `EV Def 0.54 -> 0.51`, `WAR 2.28 -> 2.36`
  - McDavid: `EV Off 1.50 -> 1.46`, `EV Def 0.07 -> 0.07`, `WAR 3.54 -> 3.50`
  - LaCombe: `EV Off 0.25 -> 0.23`, `EV Def 0.22 -> 0.22`, `WAR 0.90 -> 0.88`
- stability stayed excellent:
  - median `|EV Off pct delta| = 1.0`
  - median `|EV Def pct delta| = 2.0`
  - share within 10 EV Off pct points: `0.968`
  - share within 10 EV Def pct points: `0.996`
- benchmark held steady:
  - `Spearman (WAR): 0.794`

Important note:
- this is promoted in code
- it does **not** become visible in live DB/player-card outputs until the next normal baseline refresh:
  1. `build_rapm.py`
  2. `compute_ratings.py`
  3. `compute_percentiles.py`

## Major upstream discovery from the parity audit

### Hockey scraper was dropping usable shot information indirectly

What was found:
- `hockey_scraper` often kept valid shot events but left `xC/yC` as `NaN`
- the old eval-shot extractor dropped those rows entirely
- after patching the extractor and enriching from the raw NHL API, regulation/overtime shot-event parity became much better
- remaining “missing” sample events were mostly period-5 shootout events, which are not relevant to EV RAPM

This was the most important structural discovery of the late-stage audit.

## Rebuilt eval shot cache status

After the rebuilt eval shot pass:
- combined eval shots: `317,598`
- per season:
  - `23-24: 114,582 shots, 8,076 goals, short misses=859`
  - `24-25: 111,115 shots, 7,842 goals, short misses=1,198`
  - `25-26: 91,901 shots, 6,614 goals, short misses=970`

Relevant file:
- [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/shots_all_seasons_hs_backup.csv](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/shots_all_seasons_hs_backup.csv)

## Current baseline after the rebuilt eval shot cache

### Benchmark status

Current dry-run baseline benchmark:
- Top-10 overlap: `7/10`
- Top-25 overlap: `15/25`
- Spearman (WAR): `0.794`
- MAE:
  - `EVO 0.261`
  - `EVD 0.229`
  - `WAR 0.459`

This is the current “good” baseline to protect while testing new ideas.

### Current season-level status for key players

#### Connor McDavid

Current `25-26` season row:
- local: `WAR 4.25`, `EVO 1.64`, `EVD -0.16`
- JFresh benchmark: `WAR 5.74`, `EVO 3.06`, `EVD -0.60`

Current projected card:
- `WAR 3.54`
- `EV Off 1.50`
- `EV Def 0.07`
- `EV Def pct 87`

Interpretation:
- current-season EVD direction is now much healthier
- projected card remains too positive defensively because `23-24` and `24-25` still stay positive
- EVO remains materially low in all three seasons

#### Evan Bouchard

Current `25-26` season row:
- local: `WAR 2.45`, `EVO 0.53`, `EVD 0.40`
- JFresh benchmark: `WAR 4.01`, `EVO 1.91`, `EVD 0.40`

Current projected card:
- `WAR 2.28`
- `EV Off 0.62`
- `EV Def 0.54`
- `EV Def pct 96`

Interpretation:
- current-season EVD is now basically aligned
- projected EVD remains too high because `23-24` and `24-25` are still very positive
- projected EVO remains too low, especially because `24-25` and `25-26` offense are weak

### Season-by-season EV deltas vs JFresh benchmark

#### Connor McDavid

- `23-24`: local `EVO 1.37` vs bench `2.73`; local `EVD 0.24` vs bench `-0.05`
- `24-25`: local `EVO 1.37` vs bench `2.99`; local `EVD 0.35` vs bench `-0.30`
- `25-26`: local `EVO 1.64` vs bench `3.06`; local `EVD -0.16` vs bench `-0.60`

#### Evan Bouchard

- `23-24`: local `EVO 1.13` vs bench `1.46`; local `EVD 0.77` vs bench `0.26`
- `24-25`: local `EVO 0.43` vs bench `1.25`; local `EVD 0.62` vs bench `-0.12`
- `25-26`: local `EVO 0.53` vs bench `1.91`; local `EVD 0.40` vs bench `0.40`

Main lesson:
- the remaining card disagreement is now mostly older-season EV shape, especially `24-25`

## What was tested and rejected

These experiments were implemented, evaluated, and not promoted to the live baseline.

### 1. Event-row weighting experiment

Idea:
- change event-row weighting to resemble JFresh shift-length weighting more closely

Result:
- some movement, but failed the decision rule
- reverted

### 2. Expanded EV alpha grid

Idea:
- widen EV RidgeCV alpha search upward

Result:
- essentially no meaningful output change
- falsified the “alpha cap too low” hypothesis

### 3. Simple chained-only EV prior parity

Idea:
- use chained EV RAPM priors only, no box-score blending, no GP dampening

Result:
- made the model shape worse
- hurt LaCombe and Knies
- reverted

### 4. Score-state fix trial in live EV xG build

Idea:
- stop hardcoding `score_state=0` in the EV shot scorer

Result:
- worsened quick-test shape
- reverted

### 5. Early xG parity pass with attack-direction/rink/noise filtering

Idea:
- mirror training-pipeline normalization and filtering more fully

Result:
- worsened LaCombe while not fixing McDavid enough
- reverted

### 6. `RAPM_EXPERIMENT=teammate_share_defense`

Idea:
- uniformly shrink EV defense for players with high top-teammate concentration

Result:
- Bouchard moved in the desired direction
- but McDavid moved down too much
- overall benchmark worsened beyond tolerance

Representative result:
- Bouchard `EV Def 0.60 -> 0.37`
- McDavid `WAR 3.54 -> 2.68`

Rejected.

### 7. `RAPM_EXPERIMENT=ev_prior_parity`

Idea:
- EV-only prior-path experiment against JFresh-style carryover

Result:
- drift was too broad, especially on EV offense
- McDavid got worse
- benchmark did not improve

Rejected.

### 8. `RAPM_EXPERIMENT=xg_context_parity`

Idea:
- training-style rush/rebound / pre-shot-movement context parity

Result:
- helped Bouchard somewhat
- hurt McDavid materially
- benchmark Spearman fell to about `0.764`

Rejected.

### 9. `RAPM_EXPERIMENT=short_miss_parity`

Idea:
- exclude `miss_reason='short'` shots from xG/Fenwick totals while keeping them as context

Result after real miss metadata became available:
- Bouchard: `EV Off 0.56 -> 0.21`, `EV Def 0.63 -> 0.58`, `WAR 2.31 -> 1.91`
- McDavid: `EV Off 1.49 -> 1.40`, `EV Def 0.25 -> 0.03`, `WAR 3.71 -> 3.40`
- LaCombe: `EV Off 0.18 -> 0.30`, `EV Def 0.33 -> 0.29`, `WAR 0.94 -> 1.02`
- Spearman about `0.789`

Rejected.

### 10. `RAPM_EXPERIMENT=collinearity_reallocation_2425`

Idea:
- uniform `24-25` post-fit reallocation using:
  - top teammate share
  - on-ice offensive tilt
- move some positive defense credit into offense

Result:
- helped McDavid
- hurt Bouchard and LaCombe too much
- benchmark stayed flat rather than clearly improving

Representative dry-run:
- McDavid: `EV Off 1.50 -> 1.59`, `EV Def 0.07 -> -0.01`, `WAR 3.54 -> 3.55`
- Bouchard: `EV Off 0.62 -> 0.49`, `EV Def 0.54 -> 0.48`, `WAR 2.28 -> 2.09`

Rejected.

## Promoted collinearity adjustment

### `RAPM_EXPERIMENT=collinearity_reallocation_2425_defense`

Status:
- implemented
- fast dry-run looked promising
- an early repo-artifact run gave mixed/confusing results
- traced and re-evaluated on a clean full baseline rerun
- promoted into the baseline code path

Idea:
- same `24-25` collinearity reallocation concept
- but applied only to defensemen
- avoids dragging forwards like McDavid around while still testing the Bouchard-style credit-allocation hypothesis

Fast shortcut result:
- Bouchard: `EV Off 0.62 -> 0.84`, `EV Def 0.54 -> 0.49`, `WAR 2.28 -> 2.45`
- McDavid: `EV Off 1.50 -> 1.48`, `EV Def 0.07 -> 0.07`, `WAR 3.54 -> 3.52`
- LaCombe: `EV Off 0.25 -> 0.24`, `EV Def 0.22 -> 0.22`, `WAR 0.90 -> 0.89`

Important trace finding:
- the fast shortcut and the earlier repo-artifact run were not truly apples-to-apples
- they were built from different baseline inputs
- after tracing, the defense-only function itself behaved correctly when applied directly to the current rebuilt baseline:
  - McDavid stayed untouched
  - Bouchard moved substantially

Clean full-rerun result that drove promotion:
- Bouchard: `EV Off 0.62 -> 0.73`, `EV Def 0.54 -> 0.51`, `WAR 2.28 -> 2.36`
- McDavid: `EV Off 1.50 -> 1.46`, `EV Def 0.07 -> 0.07`, `WAR 3.54 -> 3.50`
- LaCombe: `EV Off 0.25 -> 0.23`, `EV Def 0.22 -> 0.22`, `WAR 0.90 -> 0.88`

Clean full-rerun stability:
- median `|EV Off pct delta| = 1.0`
- median `|EV Def pct delta| = 2.0`
- share within 10 EV Off pct points: `0.968`
- share within 10 EV Def pct points: `0.996`

Benchmark:
- `25-26 Spearman (WAR): 0.794`
- effectively unchanged vs baseline

Current interpretation:
- this is the first uniform collinearity correction that survived a clean full comparison
- it helps Bouchard in the right direction
- it leaves McDavid essentially stable
- it barely moves the rest of the model
- it is now part of the baseline code path

Artifacts:
- fast shortcut comparison:
  - [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/rapm_experiment_collinearity_reallocation_2425_defense_fast.csv](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/rapm_experiment_collinearity_reallocation_2425_defense_fast.csv)
- clean full-rerun repo-artifact outputs:
  - [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/per_season_rapm_collinearity_reallocation_2425_defense.json](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/per_season_rapm_collinearity_reallocation_2425_defense.json)
  - [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/rapm_experiment_collinearity_reallocation_2425_defense.csv](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/rapm_experiment_collinearity_reallocation_2425_defense.csv)
  - [/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/rapm_experiment_collinearity_reallocation_2425_defense_summary.json](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/data/rapm_experiment_collinearity_reallocation_2425_defense_summary.json)

## Added experiment infrastructure

The model now supports reversible A/B work instead of direct mutation first.

Important internal interfaces:
- `RAPM_EXPERIMENT=teammate_share_defense`
- `RAPM_EXPERIMENT=ev_prior_parity`
- `RAPM_EXPERIMENT=xg_context_parity`
- `RAPM_EXPERIMENT=short_miss_parity`
- `RAPM_EXPERIMENT=collinearity_reallocation_2425`
- `RAPM_EXPERIMENT=collinearity_reallocation_2425_defense`
- `RAPM_JSON_OVERRIDE=/abs/path/to/per_season_rapm_....json`
- `DRY_RUN_ONLY=1`

Why this matters:
- experiments can be evaluated without touching the live baseline
- benchmark effects can be checked before any upload

## Current best understanding of the model

### What is now probably true

- The project is no longer “far off because the model family is wrong.”
- The project is now “close in architecture, but still different in upstream event construction and some credit-allocation behavior.”
- The rebuilt shot cache and coordinate-retention fixes were real upstream wins.
- Current-season `25-26` alignment is much better than it was.
- The remaining biggest disagreement is older-season EV component shape, especially `24-25`.

### What is probably not the main problem anymore

- simple WAR conversion constants alone
- missing penalties data
- stale current-season leaderboard source
- short-miss handling by itself
- generic alpha-grid tuning

### What still seems most plausible

- older-season credit allocation under highly concentrated elite deployments
- especially defense/offense split for defensemen in `24-25`

## EVO Scale Gap Audit (2026-04-10)

### Goal

Diagnose why our EVO WAR is roughly 40–55 % of JFresh's for elite players
(McDavid, Bouchard) despite the benchmark calibration being active.

### Step 1 — Season-level distribution comparison (≥ 500 min toi_5v5, all matched players)

```
Season   n      Our_mean   JF_mean   Our_std   JF_std   Ratio_mean  Ratio_std  Spearman
23-24    542    +0.354     +0.314    0.473     0.619    1.131       0.764      0.743
24-25    571    +0.376     +0.291    0.458     0.621    1.294       0.737      0.759
25-26    513    +0.330     +0.302    0.404     0.577    1.094       0.700      0.712
```

Key finding: our EVO WAR **mean** is slightly ABOVE JFresh's (ratio 1.09–1.29), but our
**std** is only 70–76 % of JFresh's.  This is distribution *compression*, not a simple
scale offset.  McDavid appears low not because of a uniform underscaling but because
the distribution is squeezed toward the mean.

### Step 2 — xGF/60 target variable (Step 3 in task)

From `stints_2526.csv`:
- league-wide xGF/60 (average of home + away): **2.74**
- expected range (JFresh scale): 2.5–3.0

Target variable scale is **correct**.  Hypothesis A (xGF/60 too low) is **rejected**.

### Step 3 — GOALS_PER_WIN (Step 4)

Calibration computes GPW from benchmark and applies it.  GPW cancels in the formula
(`ev_off = (rapm_off - repl) * slope * toi_hr` after substitution), so the clipping at
4.5 is irrelevant.  Hypothesis B is **not a factor**.

### Step 4 — ev_off_replacement (Step 5)

Calibrated replacement is ~−0.07, near the 20th percentile (more generous than empirical
35th pct ≈ −0.02).  This pushes the mean up slightly but does not explain why elite
players are compressed.  Hypothesis C is **not the primary cause**.

### Step 5 — RAPM std comparison (Step 6)

```
Season   our_rapm_off_std   jf_implied_rapm_off_std   off_std_ratio
23-24    0.122              0.170                     0.721
24-25    0.103              0.140                     0.739
25-26    0.104              0.151                     0.688
```

Our rapm_off distribution is 69–72 % as wide as JFresh's implied distribution.
EV Def is even more compressed (def_std_ratio ≈ 0.48–0.53).

### Root cause confirmed — Hypothesis D: ridge over-shrinkage

The OLS calibration slope = `r × std(y)/std(x1)` where `r` is the Pearson correlation
between our `(rapm_off × toi_hr)` and JFresh EVO WAR.  Measured `r`:

```
23-24: 0.770
24-25: 0.738
25-26: 0.688
```

After OLS calibration, output EVO WAR std = `r × bench_war std` ≈ 70 % of JFresh's.

No linear post-calibration fix can exceed `r × bench_std` as the output std without
also re-ordering players.

The compression is *non-uniform*: elite players on collinear lines (McDavid + Draisaitl
+ Hyman) are shrunk more than average players.  Ridge regularisation cannot separate
their individual contributions, so all three get pulled toward 0 more aggressively.

### Three calibration fixes tried and rejected

All three were implemented in `fit_component_calibration`, tested with `DRY_RUN_ONLY=1`,
and reverted.

**Attempt A — std-ratio slope + adjusted replacement (all non-inverted components)**

Change: replace OLS slope with `std(y)/std(x1)`, adjust replacement to preserve mean,
apply to EV Off, EV Def (F), EV Def (D), PP.

Result:
- EV Def scale ballooned (forwards 1.0 → 1.91, D 0.91 → 1.52)
- Spearman: 0.795 → **0.766** (−0.029)  ← REVERT

**Attempt B — std-ratio slope + adjusted replacement (EV Off only)**

Change: same expansion but only for `rapm_off` component.

Result:
- EV Off replacement shifted −0.069 → −0.033, re-ranking borderline players
- LaCombe EV Off: 0.25 → 0.11 (hurt)
- McDavid EV Off: 1.50 → 1.90 (improved)
- Spearman: 0.795 → **0.765** (−0.030)  ← REVERT

**Attempt C — std-ratio slope, OLS replacement preserved (EV Off only)**

Change: use `std(y)/std(x1)` as slope but keep OLS replacement unchanged, so all EVO
WAR values scale up proportionally (monotonic transform within EVO WAR).

Result:
- Rankings within EVO WAR preserved
- But scaling up EV Off relative to Shooting WAR / EV Def changed TOTAL WAR ranking
- McDavid EV Off: 1.50 → 2.14 (improved)
- Bouchard EV Off: 0.62 → 0.88 (improved)
- LaCombe EV Off: 0.25 → 0.37 (improved)
- Spearman: 0.795 → **0.775** (−0.020)  ← REVERT

All three attempts fail because the benchmark ranking (`Spearman WAR`) worsens beyond
the −0.005 tolerance.  The reason: JFresh's total WAR already balances EVO WAR against
Shooting WAR at a specific ratio.  Inflating EVO WAR relative to Shooting WAR distorts
that balance and degrades total ranking accuracy.

### Why the fix must live in build_rapm.py, not compute_ratings.py

The OLS calibration is mathematically optimal given the underlying `rapm_off` values.
Any post-hoc scale expansion will:
- inflate EVO WAR for everyone, changing the EVO/Shooting WAR balance
- degrade Spearman (rankings shift relative to JFresh)

The only path to a higher Spearman AND better key-player alignment is to produce
better `rapm_off` values upstream — i.e., less ridge-compressed RAPM estimates.

### Recommended next step for the EVO gap

The most targeted upstream fix is to reduce effective ridge regularisation for the
**offense block only** in `build_rapm.py`.  Options:

1. **Asymmetric alpha**: apply a different (lower) L2 penalty to offensive player
   columns vs defensive player columns.  This would require fitting offense and defense
   in separate regressions (or using a block-diagonal penalty matrix), which is a
   meaningful refactor.

2. **Forward collinearity reallocation (all seasons)**: analogous to the promoted
   `collinearity_reallocation_2425_defense` but for forwards.  Experiment #10
   (all-player reallocation for 24-25) was rejected because it hurt Bouchard and
   LaCombe.  A *forward-only* version for *24-25 and 25-26* is unexplored.

3. **Post-regression rapm_off scaling in build_rapm.py**: scale `rapm_off` by
   `target_std / current_std` after fitting, before storing.  Combined with the OLS
   calibration, this would effectively give the std-ratio result without the component-
   balance distortion — because `rapm_def` and `pp_rapm` would be equally scaled.
   Risk: changes meaning of stored rapm values and may break the prior chain.

### Current baseline numbers (after forward collinearity promotion — 2026-04-10)

- Top-10 overlap: 7/10
- Top-25 overlap: 15/25
- Spearman (WAR): **0.797** (was 0.795)
- MAE (WAR): 0.459
- McDavid card: EV Off **1.59**, WAR **3.55** (was 1.50 / 3.54)
- Bouchard card: EV Off **0.70**, WAR **2.33** (was 0.62 / 2.28)
- LaCombe card: EV Off 0.21, WAR 0.86 (was 0.25 / 0.90 — minor regression, within tolerance)

## Promoted experiment: forward-only collinearity reallocation (24-25 + 25-26)

### `RAPM_EXPERIMENT=collinearity_reallocation_forward_2425_2526`

Status: **promoted into baseline code path** (2026-04-10)

Idea:
- same collinearity reallocation concept as the promoted defense-only adjustment
- applied to **forwards only** (non-D positions)
- applied to **both 24-25 and 25-26** (unlike defense-only which is 24-25 only)
- defensemen are unaffected (defense-only promotion still handles them in 24-25)

Implementation:
- added `forward_only=True` parameter to `apply_2425_collinearity_reallocation_experiment()`
- when `forward_only=True`, zeroes out collinearity score for players with position=='D'
- `PROMOTE_COLLINEARITY_REALLOCATION_FORWARD_2425_2526 = True` in `build_rapm.py`
- `apply_promoted_baseline_rapm_adjustments()` applies it after the defense-only pass

Experiment result (dry-run, full prior chain):

| Metric | Before | After |
|--------|--------|-------|
| Spearman (WAR) | 0.795 | **0.797** |
| Top-10 overlap | 7/10 | 7/10 |
| Top-25 overlap | 15/25 | 15/25 |
| MAE WAR | 0.460 | 0.459 |
| Median \|EV Off pct delta\| | — | 2.0 |
| Share within 10 EV Off pct pts | — | 0.968 |

Key player changes:
- McDavid: EV Off 1.50 → **1.59**, EV Def 0.07 → **-0.01**, WAR 3.54 → **3.55**
- Bouchard: EV Off 0.62 → **0.70**, EV Def 0.54 → **0.51**, WAR 2.28 → **2.33**
- LaCombe: EV Off 0.25 → 0.21, EV Def 0.22 → 0.22, WAR 0.90 → 0.86 (minor regression)

Decision rule: Spearman improved (+0.002) ✓ AND key players improved ✓ → promoted.

Note: this does NOT become visible in live DB/cards until the next normal baseline refresh:
  1. `build_rapm.py`
  2. `compute_ratings.py`
  3. `compute_percentiles.py`

## What was tested and rejected (continued)

### 11. `RAPM_EXPERIMENT=asymmetric_alpha_k130` (Attempt 2 — 2026-04-10)

Idea:
- scale offense player columns by k=1.30 before ridge regression, unscale coefficients after
- effective L2 penalty for offense block ≈ alpha/1.69× (less shrinkage on offense)
- applied uniformly across all 8 seasons via full second prior chain

Quick validation: 23-24 off std 0.172 (baseline 0.127, JFresh implied 0.170) — looked on target.

Full dry-run + compute_ratings result:

| Metric | Baseline | k=1.3 |
|--------|----------|-------|
| Spearman (WAR) | 0.798 | 0.798 |
| Top-10 overlap | 7/10 | **6/10** ↓ |
| MAE WAR | 0.459 | 0.461 ↓ |
| McDavid EV Off | 1.59 | **1.49** ↓ |
| McDavid WAR | 3.55 | **3.45** ↓ |
| Knies off_pct | ~26% | **19.8%** (fails quality gate >25) |

Root cause of failure:
- OLS calibration absorbed the std expansion by lowering the scale factor (25-26 EV Off scale: 1.125 → 1.000)
- Pearson r did NOT improve — so calibrated EVO WAR = r × bench_std / our_expanded_std collapses back
- Knies and similar Leafs forwards got hurt: less regularization let the optimizer separate correlated players more aggressively
- k=1.5/1.7 not attempted: same failure mechanism, Knies quality gate already failing

**Rejected.**

## Experiment 3 — Target variable scale investigation (2026-04-10)

**Hypothesis**: build_rapm.py might have TWO active code paths with different y scales:
- Path A: raw xG per event (~0.05–0.15 range) via `_derive_events_from_stints()`
- Path B: xGF/60 per shift (~2–30 range) — the correct JFresh-style path

If Path A was active, the regression target would be 15–30× too small relative to JFresh's, causing
RidgeCV to find far too much regularization and explaining the 30% rapm_off std compression.

**Investigation method**: added `TARGET (y) diagnostics` print just before RidgeCV call; ran
QUICK_TEST=1 SKIP_SCRAPING=1 to capture actual y distribution.

**y distribution (card seasons, shift-level xGF/60 prior-subtracted):**

| Season | n_rows | pct_zero | mean | std | median |
|--------|--------|----------|------|-----|--------|
| 23-24  | 237,564 | 0.0% | 2.2324 | 6.1797 | 0.0998 |
| 24-25  | 238,112 | 0.0% | 2.1856 | 6.2343 | 0.0219 |
| 25-26  | 189,224 | 0.0% | 2.2390 | 6.3513 | 0.0306 |

**Conclusion**: Path B is active. Mean ~2.22 xGF/60 matches JFresh's expected ~2–3 xGF/60.
Scale hypothesis DISPROVED.

**Alpha selection analysis**: converting sklearn alpha to glmnet λ using `λ = α / (n × mean_weight)`:
- 23-24: best alpha=20k, n=237k, mean_weight=16.5s → λ ≈ 0.0051 (below JFresh's λ=0.01–0.10)
- 24-25: best alpha=50k, n=238k, mean_weight=20.0s → λ ≈ 0.0105 (at JFresh's lower bound)
- 25-26: best alpha=20k, n=189k, mean_weight=23.6s → λ ≈ 0.0045 (below JFresh's range)

Alpha selection is appropriate for the data. No over-regularization from scale mismatch.

**Root cause of 30% compression (confirmed)**: Pearson r ≈ 0.69–0.77 between rapm_off and JFresh EVO WAR.
OLS calibration gives EVO WAR std = r × bench_std — permanently capped at 70–77% of JFresh regardless
of rapm_off std expansion. The gap is structural: collinearity between elite linemates limits rank
ordering, not a model implementation error.

**Side effect**: QUICK_TEST=1 run uploaded 3-season chain values to Supabase/JSON (lacks proper
8-season prior history). Full restore run immediately started to overwrite. See note below.

**Note — QUICK_TEST upload guard needed**: QUICK_TEST mode should either skip Supabase uploads or
warn loudly. Currently it uploads without the full 8-season prior chain, producing inflated per-season
values (e.g., McDavid 24-25 rapm_off 0.4164 vs full-chain 0.2205). Added to TODO list.

## Recommended next move

Normal refresh completed 2026-04-10. Current live baseline (restored after QUICK_TEST incident):
- Spearman 0.798, Top-10 7/10
- McDavid card: EV Off 1.59, WAR 3.55
- Bouchard card: EV Off 0.70, WAR 2.33

Remaining EVO gap: McDavid 1.59 vs JFresh 3.06; Bouchard 0.70 vs JFresh 1.91.

Updated understanding after three experiments:
- Expanding rapm_off std does NOT help because OLS calibration compresses it back (Experiment 2)
- The target scale IS correct — xGF/60 with mean ~2.22 (Experiment 3)
- The problem is Pearson r (≈0.69–0.77), not std, scale, or alpha
- To improve, we need better rank ordering of players upstream
- Options remaining:
  1. Improve prior chain quality in early seasons (affects r propagation)
  2. Accept remaining gap as structural — JFresh likely uses a different model family or tuning
  3. Use LASSO/elastic-net on offense block (would shrink small players more, less distortion of elites)
