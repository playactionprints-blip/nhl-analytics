# NHL Analytics Execution Roadmap

Last updated: 2026-03-14

## Goal

Build toward a more credible WAR stack while preserving the current strength of the product:

- a strong card-first frontend
- a useful custom `overall_rating`
- a cleaner separation between ratings, WAR, and descriptive stats

This roadmap assumes:

1. `overall_rating` remains the primary hero metric for now
2. WAR becomes a separate project track that gets more rigorous over time
3. We want to move closer to TopDownHockey's structure without pretending we can fully replicate it immediately

## Guiding Principles

- Do not rewrite everything at once
- Keep the current product usable at every phase
- Improve WAR by adding missing components, not by endlessly tweaking weights
- Validate each component before pushing it into the card UI
- Separate descriptive metrics from modeled value metrics

## Workstreams

### 1. Product and UX

- clarify what `overall_rating` means
- clarify what `WAR` means
- improve metric explanations on cards
- keep the frontend honest while the model evolves

### 2. Data Pipeline

- add missing WAR components
- improve RAPM isolation
- improve xG quality
- standardize season weighting and model outputs

### 3. Database and Schema

- add columns/tables for new WAR components
- version model outputs where needed
- avoid overwriting incompatible metric generations without traceability

### 4. Validation

- leaderboard sanity checks
- component sanity checks
- season-to-season stability
- comparison versus public leaders like TopDown/JFresh

## Phase 0: Stabilize Current Model

Status: mostly done

### Objectives

- keep the RAPM scaling fix
- preserve current card experience
- document the methodological gap clearly

### Tasks

- keep [TopDown_Comparison_Spec.md](/Users/cspeedie/Desktop/nhl-analytics/TopDown_Comparison_Spec.md) as the internal reference
- keep the corrected WAR conversion in [compute_ratings.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/compute_ratings.py)
- document current metric definitions in one place

### Deliverable

- stable baseline product with corrected EV WAR scaling

### Definition of done

- WAR is no longer obviously inflated
- model assumptions are documented
- the team agrees that `overall_rating` is the current headline metric

## Phase 1: Product Separation and Naming

Priority: highest

### Objectives

- stop blending different model families in the UI
- make the cards easier to trust

### Tasks

#### Frontend

- rename card sections/descriptions so users understand:
  - `Overall Rating` = custom 3-year weighted rating
  - `WAR` = season value estimate from public data
  - `RAPM` = experimental context-adjusted impact estimate
- add short tooltip/help copy for:
  - overall rating
  - WAR
  - RAPM
  - percentiles

#### Content

- write a simple methodology page for your site
- add “custom model” language where appropriate

### Deliverable

- clearer user-facing model language across player cards and team pages

### Definition of done

- a new user can tell the difference between rating, WAR, and percentile without guessing

## Phase 2: Add Missing WAR Components

Priority: highest

### Objectives

- move from a partial WAR model toward a fuller component model

### New components to add

- shooting WAR
- penalties WAR

### Tasks

#### Shooting WAR prototype

- define a shooter-over-expected framework
- candidate version:
  - use goals minus expected goals
  - apply sample threshold
  - regress or shrink toward league average to avoid noisy outliers
- convert excess goals into wins

Questions to settle:

- use 5v5 only, or all situations?
- use current season only, or weighted?
- how much shrinkage is needed?

#### Penalties WAR prototype

- collect penalties drawn and penalties taken by player
- model net penalty differential value
- convert net penalty impact into expected goal value, then wins

Questions to settle:

- can this be pulled reliably from NHL API play-by-play?
- should offensive zone penalties be valued differently?
- do we handle majors separately?

### Schema changes

Add columns to `players`:

- `war_shooting`
- `war_penalties`

Optional:

- `war_version`

### Deliverable

- WAR now includes six conceptual buckets:
  - EV offense
  - EV defense
  - PP
  - PK
  - shooting
  - penalties

### Definition of done

- new components exist in the pipeline
- values are uploaded
- the total WAR formula includes them
- no obvious outlier explosions in leaderboard sanity checks

## Phase 3: Rebuild Special Teams Value

Priority: high

### Objectives

- reduce the amount of PP and PK value driven by simple on-ice environment

### Current issue

Current PP/PK WAR is based on on-ice rates against league-average baselines.

That is useful, but can over-credit players on elite units and under-credit players in weaker environments.

### Tasks

- separate special-teams modeling from raw on-ice split comparisons
- prototype:
  - PP RAPM-style offense
  - PK RAPM-style defense
- compare:
  - current on-ice PP/PK WAR
  - isolated PP/PK model outputs

### Data needs

- special teams stint construction
- player on-ice deployment in PP and PK states
- xG for special-teams events

### Deliverable

- a replacement for current PP/PK WAR or a tested hybrid

### Definition of done

- elite PP environments no longer dominate player WAR unrealistically
- component leaderboard looks believable by role

## Phase 4: Improve EV RAPM

Priority: high

### Objectives

- make EV WAR more trustworthy

### Tasks

- audit current stint design and target construction
- add contextual controls where feasible:
  - score state
  - zone starts
  - home/away
  - back-to-back flags
  - game state transitions
- review whether teammate/opponent encoding needs refinement
- consider prior-informed or multi-season regularization strategy

### Technical notes

The current RAPM already uses ridge regression and TOI filtering, which is a good foundation. The next step is richer context control and better calibration, not a full rewrite for its own sake.

### Deliverable

- more stable EV offense and EV defense coefficients

### Definition of done

- fewer implausible defensive ratings for offense-first stars
- stronger year-to-year consistency
- better alignment with public benchmark intuition

## Phase 5: Upgrade xG Model

Priority: medium-high

### Objectives

- improve the target quality that feeds RAPM and derived value estimates

### Tasks

- document current xG features and performance
- add richer shot context where possible:
  - rebounds
  - rush indicators
  - pre-shot movement proxies
  - game state context
  - shot location refinements
- calibrate predicted versus actual goal outcomes
- create holdout evaluation

### Deliverable

- a more credible xG model for internal use

### Definition of done

- calibration is measured and acceptable
- model clearly outperforms the current hand-built version

## Phase 6: Validation and Benchmarking Layer

Priority: highest, continuous

### Objectives

- prevent us from shipping elegant but wrong models

### Validation checks

#### Leaderboard sanity

- elite stars should appear near the top
- replacement players should cluster around zero or below
- specialists should show sensible component splits

#### Stability

- compare outputs season to season
- avoid massive swings from small sample noise

#### Benchmark comparison

- compare top 25 WAR list against TopDownHockey
- compare player-card profile shape against JFresh cards
- compare internal components for a small set of test players:
  - MacKinnon
  - McDavid
  - Kucherov
  - Matthews
  - Quinn Hughes
  - shutdown defensemen
  - heavy PK forwards

#### Role plausibility

- offensive stars should not automatically grade as strong defenders
- PP specialists should not automatically become 7-WAR players on unit quality alone

### Deliverable

- repeatable validation checklist and benchmark report

### Definition of done

- every major model revision ships with a validation summary

## Phase 7: Frontend Evolution

Priority: medium

### Objectives

- reflect the improved model in the UI without clutter

### Tasks

- update WAR tab to show full component stack
- show shooting and penalties components
- add compact explanatory labels
- consider a separate “Model Notes” drawer or tooltip system
- decide whether to display:
  - current-season WAR
  - weighted rating
  - both, with clearer hierarchy

### Deliverable

- more credible, more educational player card experience

### Definition of done

- users can understand why a player is valuable without reading an article

## Recommended Sprint Order

## Sprint 1

- Phase 1 naming cleanup
- schema prep for new WAR components
- prototype shooting WAR

## Sprint 2

- prototype penalties WAR
- add both components to pipeline and database
- update WAR tab to display them internally

## Sprint 3

- benchmark current PP/PK WAR versus isolated alternatives
- decide whether to replace or hybridize special-teams WAR

## Sprint 4

- improve EV RAPM context controls
- rerun validation benchmarks

## Sprint 5

- xG model upgrade and calibration

## First Sprint Ticket List

### Product

- write short public metric definitions
- update copy in player card tabs
- update WAR/RAPM descriptions

### Backend

- add migration for:
  - `war_shooting`
  - `war_penalties`
  - optional `war_version`
- create `compute_shooting_war.py` prototype or add section in `compute_ratings.py`
- create penalties extraction script from play-by-play data

### Validation

- create a benchmark player list
- output top 25 WAR before and after each model revision
- store validation notes in markdown

## Risks

### Risk 1: chasing parity too aggressively

If we aim to exactly match TopDownHockey too early, we may lose time and clarity.

Mitigation:

- keep our custom rating system intact
- improve WAR gradually

### Risk 2: overfitting public-data noise

More components can make the model look smarter while actually becoming less stable.

Mitigation:

- add shrinkage
- add thresholds
- validate every component

### Risk 3: frontend confusion

Adding more model outputs can make the cards feel messy.

Mitigation:

- preserve hierarchy
- keep `overall_rating` as the top-level product metric for now

## Recommended Immediate Decision

Make this the official near-term product stance:

- `Overall Rating` is our signature player metric
- `WAR` is our modeled season value estimate
- our next WAR work is:
  - shooting
  - penalties
  - special teams cleanup

## Bottom Line

The fastest credible path is not a full rewrite.

The fastest credible path is:

1. clarify the product language
2. add missing WAR pieces
3. reduce special-teams over-crediting
4. improve RAPM isolation
5. upgrade xG only after the structure is cleaner

That path keeps the site strong today while moving the analytics stack closer to the best public work in the space.
