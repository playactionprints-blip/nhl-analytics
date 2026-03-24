# Conversation Memory Log

Date: March 15, 2026
Workspace: `/Users/cspeedie/Desktop/nhl-analytics`

## Purpose

This log captures the full arc of the recent collaboration so a new conversation can resume without losing model context, implementation decisions, user preferences, or operational workflow.

---

## 1. Original Problem and How It Evolved

### Initial issue

The work started from a broken penalties pipeline and downstream WAR upload flow:

- `data-pipeline/upload_penalties.py` failed when writing to `players`
- Supabase raised:
  - `null value in column "full_name" of relation "players" violates not-null constraint`
- `compute_ratings.py` then ran with `0` penalty totals in `players`
- `Penalties WAR` stayed `0.00`
- skater WAR uploads to `players` also failed for the same reason

### First debugging phase

We traced this to partial-row `upsert()` behavior on the `players` table:

- Supabase was treating the payload like an insert instead of the intended update
- missing required columns like `full_name` caused insert failures

This led to:

- switching `players` writes from `upsert()` to targeted `update(...).eq('player_id', ...)`
- doing the same for WAR writes from `compute_ratings.py`

### Second phase: penalties model tuning

Once the data flow worked, the next issue was model realism:

- penalty totals flowed successfully
- `Penalties WAR` became live
- but the initial penalties impact was too strong

Examples:

- McDavid penalties bump was too large
- some players jumped materially in WAR from penalty effects alone

We tuned by:

- restricting the penalty pipeline to 2-minute minors
- clearing stale penalty totals before rewriting
- lowering `NET_XG_PER_PENALTY_MIN`

### Third phase: special teams inflation

After penalties were sane, `PP WAR` was clearly too large.

Examples:

- MacKinnon `PP WAR` around `4.86`
- Quinn Hughes `PP WAR` around `5.89`

This was much too dominant relative to EV and shooting value.

We corrected that by:

- replacing hardcoded PP/PK baselines with empirical league baselines from current data
- adding TOI-based shrinkage
- updating the diagnostic output to show the new PP/PK math

### Fourth phase: EV underpowered, then recalibration

After fixing PP, EV components became too small.

We then recalibrated EV conversion:

- adjusted offense and defense RAPM scaling
- introduced separate offense vs defense replacement baselines
- later reduced defensive inflation further

This improved the WAR leaderboard from “special-teams dominated” to something much more believable.

### Fifth phase: move from current-season WAR to 3-year weighted WAR

The user explicitly wanted:

- `WAR` to represent a multi-year card metric rather than a one-season small-sample estimate

This caused a conceptual shift:

- `ratings` were already 3-year weighted
- `WAR` was still current-season

We changed WAR to a 3-year weighted card-style number.

### Sixth phase: TopDown/JFresh-style architecture

The user wanted the cards and WAR model to be more like:

- JFresh / TopDown Hockey
- HockeyStats-style player cards

This shifted the project toward:

1. season-level RAPM
2. season-level WAR components
3. 3-year projected card values
4. percentile cards based on projected multi-year metrics
5. quality/context metrics like QoT/QoC

### Seventh phase: roster and UI issues

The user noticed:

- stale team assignments
- rookies missing from team pages
- card UI needing a more polished report-card feel

This led to:

- live NHL roster sync support
- rookie visibility fixes on team pages
- a redesigned percentile card matching the user’s mockup more closely

### Eighth phase: goalie model expansion

The user asked for:

- goalie `GSAA`, then clarified they actually wanted a MoneyPuck-style `GSAx`

We first added a simpler GSAA path, then replaced it with:

- shot-based `GSAx`
- `expected_goals_against`
- `expected_save_pct`
- `gsax`
- `gsax_pct`
- `gsax_per_xga`
- `save_pct_above_expected`

The user then clarified they want a future commercial product, so:

- we decided not to ingest MoneyPuck data directly into the product
- instead we moved toward “MoneyPuck-like, but our own”

### Ninth phase: xG and RAPM maturity work

The user asked to “do it all.”

This triggered a more foundational model-improvement pass:

- richer xG features
- first-pass rink-bias correction
- better RAPM context handling
- better data-quality diagnostics
- clearer stable vs provisional card messaging

This also surfaced repeated runtime bugs that required hardening:

- shape mismatches after noise filtering
- score-state leakage
- mis-sliced RAPM coefficients
- optional-column scalar/Series bugs in feature engineering

---

## 2. Key Insights and Solutions We Developed

### Data write / Supabase solutions

- `players` updates are safer with `update(...).eq('player_id', ...)` than partial `upsert()`
- `player_seasons` and `players` should be treated differently:
  - `player_seasons` = season-level storage
  - `players` = projected / live card layer

### Penalties model insights

- 2-minute minors are a safer first-pass signal than all penalty minutes
- majors/double-minors distort a simple per-minute model
- penalties should be a supporting WAR component, not a major driver

### Special teams insights

- hardcoded PP/PK baselines badly distorted WAR
- empirical league baselines + TOI shrinkage created much more believable PP/PK WAR
- PP should support elite stars, not explain almost all of their total WAR

### EV / RAPM insights

- EV offense needed more weight after PP normalization
- EV defense was repeatedly too generous for offense-first stars
- Kucherov was the clearest example of why defensive RAPM needed better isolation
- offense/defense coefficient separation materially improved RAPM interpretation
- EV defense still remains the weakest major model component

### Architecture insights

- the cleanest “TopDown-like” design is:
  1. compute season RAPM
  2. compute season WAR components
  3. project 3-year card values
  4. compute percentiles on projected values

This is much cleaner than trying to bolt card logic directly onto one-season live tables.

### Goalie model insights

- the project had enough raw NHL API shot data to build its own `GSAx`
- official NHL `shots_against` and `goals_against` should be preferred for final goalie stat lines
- direct MoneyPuck data use would create licensing/commercial risk
- MoneyPuck is a benchmark, not a production dependency

### xG model insights

- early “strong” xG output was misleading because:
  - score-state leakage existed
  - `scale_pos_weight` inflated predicted probabilities
- after removing leakage and calibration distortion, AUC dropped but realism improved
- `5v5` is the critical gating model for the pipeline
- `PP/PK` can be accepted at lower thresholds if `5v5` is sound

### Operational insight

- long pipeline reruns are expensive in time and attention
- it is better to batch meaningful fixes before rerunning than to iterate one bug at a time
- a standalone data-quality report became necessary because issues were increasingly about coverage and completeness, not just code correctness

---

## 3. User Working Style and Preferences Observed

### The user prefers

- making several worthwhile improvements before a rerun
- practical realism over theoretical elegance
- outputs compared against public reference models like JFresh, TopDown, HockeyStats, and MoneyPuck
- fewer small reruns when a longer rerun can be made more likely to succeed
- direct, judgment-based recommendations instead of endless option lists
- actually implementing changes rather than just discussing them

### The user values

- card visuals that feel polished and intentional
- believable leaderboards over perfect methodological purity
- commercial viability in the long run
- self-owned models and data pipelines
- seeing where the model still differs from public benchmarks

### The user explicitly clarified

- they want `WAR` to be 3-year weighted
- they want player cards to look closer to JFresh / HockeyStats
- they want to be able to sell the product later, so third-party data reliance should be avoided

---

## 4. Collaboration Approaches That Worked Well

### Effective patterns

- Make the fix, then tell the user exactly what rerun command should change
- Diagnose with concrete examples:
  - MacKinnon
  - McDavid
  - Kucherov
  - Matthews
  - Sorokin
- Compare model behavior against public references when the user asked
- Push clean checkpoints frequently so the user can rerun from known-good code
- Use honest language like:
  - “this part is good enough to keep”
  - “this remains provisional”
  - “this is the weakest part of the model”

### What reduced friction

- telling the user when they could skip re-running a prior long step
- preserving unrelated local data files and not committing generated CSV/model artifacts
- explicitly distinguishing:
  - code bugs
  - data completeness problems
  - model-definition disagreements

---

## 5. Clarifications and Corrections the User Made

### Important corrections from the user

- “I want 3 year war !! better representation than small sample size of one season”
- Goalies should use a MoneyPuck-style `GSAx` concept, not simple `GSAA`
- Future commercial use means the system should remain self-owned
- The user wanted the player cards to resemble their own mockup, not just generic percentile tiles

### Cases where the user sharpened direction

- asked whether PP was too high
- asked whether EV or penalties should be tuned next
- asked whether the model could be made “pure TopDown style”
- pushed to improve model fidelity before rerunning expensive pipelines

---

## 6. Project Context and Examples We Used

### Main files involved

- [build_xg_model.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/build_xg_model.py)
- [fetch_goalie_gsax.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/fetch_goalie_gsax.py)
- [build_rapm.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/build_rapm.py)
- [compute_ratings.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/compute_ratings.py)
- [compute_percentiles.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/compute_percentiles.py)
- [upload_nst_splits.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/upload_nst_splits.py)
- [fetch_goalie_stats.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/fetch_goalie_stats.py)
- [report_data_quality.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/report_data_quality.py)
- [PlayerCard.jsx](/Users/cspeedie/Desktop/nhl-analytics/PlayerCard.jsx)
- [app/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/page.js)
- [app/team/[teamCode]/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/team/[teamCode]/page.js)
- [nhl_pipeline.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/nhl_pipeline.py)

### Example player references used repeatedly

- Connor McDavid
- Nathan MacKinnon
- Nikita Kucherov
- Leon Draisaitl
- Auston Matthews
- Quinn Hughes
- Jason Robertson
- Mitch Marner
- Beckett Sennecke

### Example goalie references used

- Ilya Sorokin
- Devin Cooley
- Andrei Vasilevskiy
- Scott Wedgewood

### Public comparison references used

- HockeyStats WAR leaderboard
- HockeyStats player cards
- JFresh-style card logic
- MoneyPuck goalie GSAx references

These were used as:

- sanity checks
- direction-of-travel benchmarks
- communication anchors

not as production data sources

---

## 7. Templates and Processes We Established

### Preferred rerun sequence

When the xG model changes:

```bash
./venv/bin/python data-pipeline/build_xg_model.py &&
./venv/bin/python data-pipeline/fetch_goalie_stats.py &&
./venv/bin/python data-pipeline/fetch_goalie_gsax.py &&
./venv/bin/python data-pipeline/build_rapm.py &&
./venv/bin/python data-pipeline/compute_ratings.py &&
./venv/bin/python data-pipeline/compute_percentiles.py
```

When only goalie data changes:

```bash
./venv/bin/python data-pipeline/fetch_goalie_stats.py &&
./venv/bin/python data-pipeline/fetch_goalie_gsax.py &&
./venv/bin/python data-pipeline/compute_ratings.py &&
./venv/bin/python data-pipeline/compute_percentiles.py
```

When doing quality verification:

```bash
./venv/bin/python data-pipeline/report_data_quality.py
```

### Debugging pattern

When a run fails:

1. identify whether it is:
   - code/runtime
   - schema/db
   - model calibration
   - missing data
2. patch all obvious adjacent runtime hazards before the next rerun
3. commit/push only source changes, not regenerated local artifacts
4. tell the user the smallest safe restart point

### Card philosophy template

The card now implicitly treats metrics in two groups:

#### Stable / more trustworthy

- WAR3
- EV Offence
- Goals
- Points
- ixG
- goalie GSAx

#### Provisional / still maturing

- EV Defence
- Penalties
- Competition
- Teammates

### Model philosophy template

- own the model
- benchmark externally
- label provisional areas honestly
- prioritize believable outputs over overfit metrics

---

## 8. Important Code / Model Changes Already Made

### Penalties and WAR upload

- fixed partial-row Supabase write failures by using targeted `update()`
- penalty totals now flow into `players`
- penalties WAR no longer always zero

### WAR model

- moved WAR toward a 3-year weighted card metric
- empirical PP/PK baselines added
- TOI shrinkage added to PP/PK
- EV conversion recalibrated
- EV defense toned down repeatedly
- missing season components no longer become fake zero seasons

### RAPM

- now supports season-level RAPM uploads to `player_seasons`
- projects 3-year RAPM back to `players`
- offense/defense coefficient blocks separated
- context terms added:
  - home ice
  - score state
  - score-state magnitude
  - period controls
- stints split on goals to keep score context cleaner
- QoT/QoC shrunk toward neutral and softened via blended impact signal
- RAPM diagnostics expanded

### xG

- shot scraping moved to NHL API v1 flow
- richer pre-shot movement features added
- score-state leakage fixed
- removed probability-distorting `scale_pos_weight`
- `5v5` gate retained as the key threshold
- `PP/PK` thresholds softened
- first-pass rink-bias correction added
- decile calibration output added

### Goalie model

- official `shots_against` and `goals_against` preferred
- goalie `GSAx` pipeline built from project’s own xG model
- `save_pct_above_expected` and related fields added
- goalie pipeline now has `0` goalies with `xGA` but no `GSAx`

### UI

- percentile card redesigned toward a report-card aesthetic
- trend charts added
- contract / role / deployment info added
- stable vs provisional messaging added
- rookie team-page visibility fixed

### Roster

- live NHL roster sync added
- current NHL team assignments now refresh from live roster feed

---

## 9. Current State at End of This Conversation

### Latest quality report

The latest data-quality report showed:

```text
player_seasons coverage:
  25-26: rows=714 | missing_5v5_splits=13 | missing_war=0
  24-25: rows=641 | missing_5v5_splits=193 | missing_war=0
  23-24: rows=641 | missing_5v5_splits=190 | missing_war=0

players coverage:
  skaters with WAR but no percentiles: 8
  skaters with GP >= 10 but no RAPM: 19
  goalies with xGA but no GSAx: 0
```

### Interpretation

- goalies are in good shape
- WAR coverage is good
- the biggest remaining data issue is historical `player_seasons` split completeness
- especially `24-25` and `23-24` missing `toi_5v5` inputs for many rows

### Operational conclusion

The main blocker now is less about code correctness and more about:

- backfilling historical split inputs
- improving defensive RAPM quality
- improving mature-vs-provisional card communication

---

## 10. Recent Runtime Bugs and Fixes

### Bugs already fixed

- penalties upload insert/update failure
- WAR upload insert/update failure
- xG feature array length mismatch after noise filter
- xG score-state leakage
- RAPM coefficient slicing mismatch after adding context features
- optional-column scalar bug in `engineer_features()` affecting goalie GSAx
- goalie feature path missing `shooter_team` / `rink_team`

### Recent runtime fix

Most recent code fix:

- [build_xg_model.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/build_xg_model.py) now uses a helper returning row-aligned numeric Series even for missing optional columns
- [fetch_goalie_gsax.py](/Users/cspeedie/Desktop/nhl-analytics/data-pipeline/fetch_goalie_gsax.py) now passes the columns needed by the shared feature-engineering path

This was pushed in commit:

- `351d8d2` — `Harden xG feature engineering for goalie shots`

---

## 11. Commits Mentioned During This Arc

Not exhaustive, but important checkpoints included:

- `7256ac0` — Add percentile player card and live roster sync
- `a714e3f` — Switch WAR to 3-year weighted model
- `27cc261` — Refactor player cards to season-based RAPM and WAR
- `7ed6fcf` — Redesign percentile card to report layout
- `797e2ae` — Loosen RAPM quality gate tolerance
- `7680853` — Separate RAPM offense and defense coefficients
- `9eda2bb` — Harden RAPM scrape/name issues
- `ae6e1a3` — Add pre-shot movement features to xG model
- `87e7c34` — Stabilize RAPM context and card percentiles
- `b3ee06b` — Add model calibration and quality diagnostics
- `351d8d2` — Harden xG feature engineering for goalie shots

---

## 12. Next Steps Identified

### Highest-priority next steps

1. Backfill historical split data:

```bash
./venv/bin/python data-pipeline/upload_nst_splits.py
```

2. Refresh the full skater model layer:

```bash
./venv/bin/python data-pipeline/build_rapm.py &&
./venv/bin/python data-pipeline/compute_ratings.py &&
./venv/bin/python data-pipeline/compute_percentiles.py
```

3. Re-run quality reporting:

```bash
./venv/bin/python data-pipeline/report_data_quality.py
```

### Likely model-improvement next steps

- improve defensive RAPM context further
- improve rink-bias correction sophistication
- inspect the `19` skaters with GP >= 10 but no RAPM
- inspect the `8` skaters with WAR but no percentiles
- decide whether QoT/QoC should be:
  - kept
  - shrunk more
  - or visually de-emphasized further

### Future product-quality steps

- continue moving toward a stronger self-owned goalie xG model
- keep benchmarking against MoneyPuck and JFresh without depending on them
- further polish the card layout once the model stabilizes

---

## 13. Handoff Summary for a New Conversation

If a new conversation starts, the most important handoff statement is:

> This project has already moved from a broken current-season WAR/penalties pipeline to a much more mature 3-year projected card architecture with season-level RAPM, season WAR components, custom goalie GSAx, and a redesigned percentile card UI. The biggest remaining issue is not the core pipeline anymore; it is historical split completeness and continued defensive RAPM refinement.

And the most useful immediate command is:

```bash
./venv/bin/python data-pipeline/report_data_quality.py
```

That will show whether the current problem is:

- missing split data
- missing RAPM
- missing percentiles
- or a goalie data gap

---

## 14. Continuation Log — March 16, 2026

This section captures the next major phase of work after the original weekend handoff. The project expanded from analytics/modeling and player-card polish into broader product features: lottery simulation, predictions, homepage search, metadata/SEO plumbing, and a new armchair-GM roster builder.

---

## 15. How the Project Evolved After the Original Log

### A. Team / roster accuracy fixes became a product issue

The user noticed:

- some teams were stale
- Mitch Marner’s team looked wrong to them
- Beckett Sennecke and other rookies were missing

That led to two important product/data changes:

- team pages stopped hiding low-GP rookies
- live NHL roster sync support was added so the site could refresh team assignments directly from the NHL roster feed

This was also one of the first places where the user cared about the distinction between:

- “is the model good?”
- and “is the site using current, believable real-world roster data?”

### B. Player-card work shifted from “functional” to “presentation-grade”

After the core WAR/RAPM work, the user increasingly focused on presentation quality:

- percentile-card styling
- mockup fidelity
- trend chart readability
- clarity of labels like EV Defence vs Def Rating

This evolved into a sustained UI polish stream:

- redesigned report-card style player cards
- better trend charts
- tooltip improvements
- collapsible ON-ICE sections
- better homepage search
- breadcrumb navigation
- recent players

The user values polish and clarity, but they still expect the site to remain grounded in real data rather than becoming “design-only.”

### C. NHL Lottery Simulator became a full product feature

The user wanted a modern NHL lottery page inspired by Tankathon’s usability, but not copied.

This evolved through several stages:

1. create a standalone lottery page and nav tab
2. build a configurable lottery engine
3. wire in the 2026 first-round pick ownership ledger
4. resolve traded/protected picks after lottery order is finalized
5. handle Ottawa’s special static slot correctly
6. improve conveyed-pick visualization so ownership is obvious at a glance

The user especially cared about:

- original team vs selection owner clarity
- protection language being short and readable
- the page feeling native to the site rather than a disconnected demo

### D. Predictions became a major second product vertical

The project then expanded into a dedicated NHL game predictions experience:

- reusable TypeScript prediction engine
- predictions landing page
- individual game detail pages
- confidence metadata
- projected goalie support
- market odds comparison
- Daily Faceoff starter ingestion
- The Odds API integration with rate-limited caching

This was no longer just a backend model exercise. It became a real site feature with:

- clickable cards
- matchup detail pages
- narrative-style assessment sections
- fair odds and edge framing

### E. Homepage search became search-first instead of static

The old homepage search experience relied on a static/hardcoded-feeling player button grid.

The user explicitly wanted:

- no hardcoded names
- search-first UX
- default top-10 current-season WAR players
- live Supabase filtering while typing

This was implemented by replacing the old default search behavior with:

- current-season `player_seasons` WAR-based defaults
- current-season substring search results ranked by WAR

### F. New product surface: Armchair GM Roster Builder

The user then asked for a fully self-contained new page:

- `/roster-builder`

with:

- searchable player pool
- line/slot assignment
- cap tracking
- roster analytics
- shareable URL state
- mobile fallback

The user explicitly wanted:

- this to be isolated from the rest of the app
- no hardcoded player data
- no disruption to existing routes/components

This became the newest major feature area added to the site.

---

## 16. Key Insights and Solutions From the Newer App/Product Phase

### Homepage / search insights

- The homepage player search UI actually lived inside [PlayerCard.jsx](/Users/cspeedie/Desktop/nhl-analytics/PlayerCard.jsx), not a dedicated home-only component.
- The server-side default state is best handled in [app/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/page.js), while the live search behavior is client-side in [PlayerCard.jsx](/Users/cspeedie/Desktop/nhl-analytics/PlayerCard.jsx).
- For the user’s requested behavior, the right split was:
  - `app/page.js` supplies top 10 current-season WAR players
  - `PlayerCard.jsx` filters against current-season `player_seasons` rows while typing

### Lottery feature insights

- The correct conceptual model is:
  - lottery order is determined by the **original team**
  - ownership is resolved **after** lottery order is finalized
- Ottawa must be treated as a truly special case:
  - static slot 32
  - excluded from the lottery draw
  - excluded from normal first-round ordering
  - appended afterward
- The user found it confusing when the original team was shown clearly but the conveyed owner was only present as text. Visual ownership treatment matters as much as logic correctness.

### Predictions product insights

- The user wants predictions to feel like a real editorial/product experience, not just a JSON dump in card form.
- Good UX references were:
  - HockeyStats slate/game cards
  - MoneyPuck matchup pages
- The right product structure became:
  - slate page with quick-scan cards
  - click-through single-game detail page
  - visible confidence explanation
  - market-vs-model framing
  - projected goalies and source/fallback handling

### The Odds API insight

- The user wants low API usage and explicitly wants to stay under `500 calls/month`.
- A practical compromise was:
  - server-only env var usage
  - aggressive cache windowing
  - max 15 refresh windows/day via 96-minute buckets
- Local `.env.local` does not imply Vercel has the same key. This distinction mattered in deployment debugging.

### Roster builder insights

- The user values shareability highly; URL state was explicitly required.
- Native HTML5 drag/drop was the right choice because:
  - no DnD package was installed
  - the user allowed native drag/drop
  - it avoided adding dependencies
- The player pool needed real cap/rating fields, which required combining:
  - `player_seasons` for current-season WAR/team/position snapshot
  - `players` for name, ratings, and contract info

### Deployment insight

- Several local-only helpers/files existed in the workspace but had not been pushed.
- The roster-builder deployment bug came from importing [app/lib/apiCache.js](/Users/cspeedie/Desktop/nhl-analytics/app/lib/apiCache.js), which existed locally but was not present in the deployed branch history.
- The fix was to inline those helpers in the new route rather than depending on broader unpushed backend work.

---

## 17. User Working Style and Preferences Observed More Recently

### The user continues to prefer

- shipping working features quickly so they can test on the live site
- pushing often
- practical improvements over abstract architecture talk
- one issue at a time for UI polish
- clear separation between:
  - backend/data changes
  - presentation-only changes

### The user often works like this

1. test a live feature
2. notice one concrete mismatch or rough edge
3. send a very specific refinement request
4. expect a direct implementation + push

This happened repeatedly for:

- lottery ownership display
- tooltip wording
- predictions layout
- confidence explanations
- breadcrumbs
- recent players
- homepage search behavior

### The user cares about

- visual hierarchy
- clarity of ownership/protection in the lottery tool
- making advanced stats understandable to normal users
- features that are “native to the app,” not bolted on
- preserving future commercial viability

### The user is especially sensitive to

- misleading labels
- hidden data caveats
- deployment/build issues after a push

When something is wrong, the user usually wants it corrected immediately and pushed quickly so they can test again.

---

## 18. Collaboration Approaches That Worked Well in This Newer Phase

### Effective working pattern

- make the smallest scoped change that satisfies the request
- lint or sanity-check only the touched files
- commit only the requested feature files
- push quickly so the user can verify live

This worked especially well because the repo often contained unrelated in-progress local changes.

### High-value communication pattern

- be explicit when something **was not** actually implemented yet
- distinguish:
  - “implemented locally”
  - “committed”
  - “pushed”
  - “deployed”

This mattered multiple times because the user often asked:

- “was this pushed?”
- “is this on the website?”

### Another strong pattern

- when the user asks for UI-only work, avoid touching data logic
- when the user asks for backend/data work, avoid touching UI

The user explicitly gives constraints in those terms and expects them to be respected.

### Good checkpointing behavior

- isolate commits to just the relevant files
- avoid dragging other unfinished changes into a push

This became especially important once the repo had:

- large backend feature branches in the working tree
- generated data/model files
- partially finished API/backend plumbing

---

## 19. Clarifications and Corrections the User Made in This Newer Phase

### Roster / lottery / predictions clarifications

- The user corrected the phrasing and behavior of pick-protection descriptions:
  - only show the actual protection, not article-like notes or verbose “checked” language
- The user wanted conveyed picks to look more like Tankathon:
  - original team still visible
  - new owner visually obvious
  - hoverable protection detail
- The user wanted standings context like:
  - `GP`
  - `P%`
  - `L10`
  on the lottery page

### Predictions clarifications

- The user asked whether The Odds API could be used and then added the key locally and in Vercel.
- The user explicitly wanted the odds API usage capped to stay under the plan limit.
- The user wanted Daily Faceoff starter confirmations checked on a recurring basis, then wanted the actual site ingestion path built too.
- The user wanted a cleaner, more editorial predictions layout inspired by public reference sites.

### Homepage clarification

- The user explicitly corrected course on the homepage:
  - they did **not** want the old static-ish player grid behavior anymore
  - they wanted search-first, dynamic, current-season WAR-ranked results

### Roster builder clarification

- When asked whether the roster builder had been created, the answer had to be “no” because only the homepage search change had been pushed.
- The user then reaffirmed: create the roster builder using the earlier detailed instructions.

---

## 20. Project Context and Examples Used During This Newer Phase

### Reference products used conceptually

- Tankathon NHL lottery page
- HockeyStats player cards and predictions/slate layouts
- MoneyPuck matchup / odds / goalie presentation pages
- Daily Faceoff starting goalies page
- The Odds API docs/site

These were used as:

- usability references
- layout inspiration
- terminology anchors
- feature-flow examples

not as code/templates to copy exactly

### Important files touched during this newer phase

#### Lottery

- [LotterySimulator.jsx](/Users/cspeedie/Desktop/nhl-analytics/LotterySimulator.jsx)
- [app/lottery/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/lottery/page.js)
- [app/lib/lotteryEngine.js](/Users/cspeedie/Desktop/nhl-analytics/app/lib/lotteryEngine.js)
- [app/lib/lotteryResolver.js](/Users/cspeedie/Desktop/nhl-analytics/app/lib/lotteryResolver.js)
- [app/lib/nhl2026PickLedger.js](/Users/cspeedie/Desktop/nhl-analytics/app/lib/nhl2026PickLedger.js)

#### Predictions

- [app/predictions/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/predictions/page.js)
- [app/predictions/[date]/[gameId]/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/predictions/[date]/[gameId]/page.js)
- [app/lib/predictionsData.js](/Users/cspeedie/Desktop/nhl-analytics/app/lib/predictionsData.js)
- [src/models/predictGame.ts](/Users/cspeedie/Desktop/nhl-analytics/src/models/predictGame.ts)
- [src/data/leagueConstants.ts](/Users/cspeedie/Desktop/nhl-analytics/src/data/leagueConstants.ts)
- [src/types/types.ts](/Users/cspeedie/Desktop/nhl-analytics/src/types/types.ts)
- [src/sim/monteCarloSimulator.ts](/Users/cspeedie/Desktop/nhl-analytics/src/sim/monteCarloSimulator.ts)

#### Navigation / layout / UX

- [TopNav.jsx](/Users/cspeedie/Desktop/nhl-analytics/TopNav.jsx)
- [Breadcrumbs.jsx](/Users/cspeedie/Desktop/nhl-analytics/Breadcrumbs.jsx)
- [PlayerCard.jsx](/Users/cspeedie/Desktop/nhl-analytics/PlayerCard.jsx)
- [app/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/page.js)

#### Roster builder

- [app/roster-builder/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/roster-builder/page.js)
- [app/api/roster-builder/players/route.js](/Users/cspeedie/Desktop/nhl-analytics/app/api/roster-builder/players/route.js)
- [app/components/roster-builder/RosterBuilderApp.jsx](/Users/cspeedie/Desktop/nhl-analytics/app/components/roster-builder/RosterBuilderApp.jsx)
- [app/components/roster-builder/rosterBuilderConfig.js](/Users/cspeedie/Desktop/nhl-analytics/app/components/roster-builder/rosterBuilderConfig.js)
- [app/components/roster-builder/rosterBuilderUtils.js](/Users/cspeedie/Desktop/nhl-analytics/app/components/roster-builder/rosterBuilderUtils.js)

---

## 21. Templates and Processes Established in This Newer Phase

### Push/test loop

The most common modern workflow became:

1. user asks for one concrete feature/refinement
2. implement only the scoped files
3. lint the touched files
4. commit only those files
5. push immediately
6. user tests live
7. fix any deployment/runtime issue quickly

### Safe commit isolation

Because the repo often contains unrelated modified files, the right process is:

```bash
git add [only the touched files]
git commit -m "[feature-specific message]"
git push origin main
```

This is better than broad `git add .` in this repo.

### UI-only discipline

When the user says “presentation only” or “do not touch data logic,” the preferred process is:

- only adjust component/layout/styling files
- do not touch API routes or query behavior
- call out that the work was UI-only in the summary

### Backend-only discipline

When the user says “do NOT touch UI components,” the preferred process is:

- confine changes to data layer, API routes, types, or pipelines
- explicitly state that no UI work was done

### Deployment debugging pattern

When Vercel fails:

1. read the exact missing module/build error
2. verify whether the dependency/import exists in the pushed branch, not just the local workspace
3. patch only the failing feature surface
4. push the smallest fix commit

---

## 22. Notable Commits Mentioned During This Newer Phase

Important newer checkpoints included:

- `cb0a7b7` — Add NHL lottery simulator and pick resolver
- `d58f69d` — Fix lottery selection-owner clarity / live-field handling
- `268be05` — Improve lottery traded-pick visual treatment
- `8485576` — Add lottery standings context and cleaner protection tooltip text
- `20c627f` — Add predictions tab/page and TS prediction engine
- `c74807b` — Fix production build blockers around fonts / typings
- `2498cee` — Predictions UI polish pass
- `a5d7fa6` — Click-through game detail pages
- `85e2aca` — Add projected goalie and market odds comparison
- `f99414e` — Daily Faceoff goalie ingestion fallback
- `6fbd43c` — Limit The Odds API refresh cadence
- `4906e79` — Fix predictions date filtering / game count issue
- `8a89a3a` — Add predictions quick-date buttons
- `00ecb07` — Confidence tooltip + section dividers
- `a65f98d` — Global breadcrumbs
- `513fc09` — Recent players list
- `b5d3c89` — Refine back-to-back win probability penalties
- `a67131d` — Make homepage player search dynamic
- `54fb62a` — Add armchair GM roster builder
- `aa53460` — Inline roster builder cache helpers (deployment fix)

---

## 23. Current State at the End of This Updated Log

### Live product surface now includes

- player cards
- teams
- predictions
- NHL lottery
- homepage dynamic search-first player discovery
- roster builder

### Recent app-level improvements already in place

- breadcrumbs below top nav
- recent players on the player-cards page
- confidence tooltip support for predictions
- section dividers on game detail pages
- better traded-pick visualization in the lottery tool
- quick date switching on predictions
- server-cached The Odds API integration
- Daily Faceoff starter ingestion with fallback

### Current known caveat / active issue pattern

The repo still contains a mix of:

- pushed feature work
- local unpushed backend/data work
- generated pipeline/model artifacts

So future pushes should continue to be carefully scoped.

### Current roster builder state

The roster builder now exists and has been pushed. It includes:

- current-season player pool API
- search/filter pool
- slot assignment
- native drag/drop on desktop
- click-to-slot on mobile
- cap math
- roster analytics
- grouped slotted-player summary
- shareable URL encoding

The first deployment issue for it was fixed by removing reliance on an unpushed shared API cache helper.

---

## 24. Next Steps Identified From the Most Recent Work

### Highest-value immediate next steps

1. Verify the roster builder in production after the deploy fix:
   - `/roster-builder`
   - URL sharing
   - drag/drop
   - mobile click-to-slot behavior
   - cap totals

2. Continue predictions polish:
   - more matchup-detail depth if desired
   - possibly main-slate starter badges
   - possibly clearer market freshness messaging if needed

3. Continue lottery polish:
   - confirm conveyed/protected pick UI is intuitive under more scenarios
   - test more ledger cases and protection outcomes

### Likely future data/product work

- better projected goalie confidence logic
- more exact lineup integration for predictions
- richer compare/build features around roster composition
- eventually player comparison UI on top of the already-built data foundation

### Ongoing model-side priorities still relevant

Even though the product surface expanded a lot, these original analytics priorities still remain:

- historical split completeness
- defensive RAPM quality
- clarity around provisional vs stable defensive/context metrics

---

## 25. Handoff Summary for a New Conversation

If a new conversation starts now, the most useful short handoff is:

> The project is no longer just a stats pipeline. It now has multiple user-facing product surfaces: player cards, predictions, lottery simulator, dynamic homepage search, and a new roster builder. The user likes fast live testing, highly scoped pushes, and polished but honest presentation. The biggest engineering caution is that the repo often contains unrelated local in-progress work, so new changes should be isolated carefully. The biggest analytics caution remains defensive RAPM and historical split completeness.

If a fresh conversation needs to resume from the latest application work, the most likely immediate checkpoints are:

- test `/roster-builder`
- test The Odds API / Daily Faceoff behavior on predictions
- confirm lottery conveyed/protected pick behavior
- keep pushes narrowly scoped

---

## 26. Five-Day Extension: March 18-23, 2026

This section captures the full product and engineering work completed over the last five days so a new conversation can resume from the current site state instead of the older weekend-only memory.

### Scope of this period

The project expanded from a player-card/predictions site into a broader NHL analytics product suite with:

- a dedicated homepage
- a mobile-responsiveness pass
- a much stronger postgame experience
- a more mature lottery simulator
- a new Fantasy Hub with rankings, team builder, compare tools, and ongoing scoring/projection debugging
- multiple infrastructure and backend quality-of-life upgrades

### Commits in this period

- `a4c1725` — 8-season RAPM daisy chain / WAR and ratings refresh
- `29d7617` — finishing uses 3-year weighted average from `player_seasons`
- `c917837` — career stats tab and prediction log migration tooling
- `8e0282f` — expose missing season stats in `playerData.js`
- `efb5aa0` — add `/playoff-odds`
- `08f5313` — upgrade `/playoff-odds`
- `e30924c` — live/final score + scoring summary + game stats + boxscore
- `34772ea` — live scores banner
- `d43ffe3` — roster builder team load dropdown
- `ae0a955` — roster builder load-team UI fix
- `489d752` — game analytics panel, yesterday link, xG boxscore columns
- `6bdd2b7` — fix blank `GameStatsPanel`
- `0a719b6` — forced redeploy/cache bust
- `084d434` — upgraded player OG image and Share Card button
- `1d6e0ca` — predictions per-date revalidation
- `1bdd25d` — past-date predictions fix
- `524cf8e` — completed-game prediction null crash fix
- `963f398` — proxy NHL API calls to avoid client-side CORS
- `cc808cc` — `GameStatsPanel` visuals and merged boxscore work
- `ed3d8db` — betting unit tracker
- `86766f9` — nightly Vercel cron for predictions/results logging
- `797d12c` — prediction card layout fix
- `9130cbc` — prediction card overflow fix
- `08fd357` — large background logos, white rink, shot tooltips, meter labels
- `94187e8` — Deserved To Win meter
- `3049cf2` — gauge/shot-coordinate normalization fix
- `ee97ba1` — shot map excludes only blocked shots
- `c09e690` — wider shot map rink
- `6a6200e` — shot map fills full card width
- `b130a5c` — shot map geometry fix
- `5fc6c51` — allow anon sync log inserts
- `0ad0f4b` — Deserved To Win meter sweep fix
- `142e588` — better homepage player search
- `5eef20e` — expanded scores banner and simplified homepage
- `d1779c5` — game moments and playoff implications
- `c1acde2` — homepage scores banner fallback
- `626a8b0` — redesigned postgame dashboard
- `a6e1141` — polished postgame analytics layout
- `12a416e` — dedicated platform homepage
- `19ecac2` — clarified player card evaluation view
- `28eca51` — dramatic lottery reveal
- `a1f6f5b` — full-site mobile responsiveness pass
- `c40977a` — simplified lottery page around main board
- `bc54bc9` — Fantasy Hub
- `2c0c3ce` — Fantasy compare players tab
- `3146d94` — reorder fantasy league setup flow
- `ea1f95d` — fix fantasy projection mapping
- `ded41e0` — validate fantasy ranking projections
- `caccfb6` — harden fantasy player stat sourcing
- `fa4e885` — expand fantasy scoring settings and audit projections

### High-level evolution during this period

The product changed shape in a big way:

1. The site stopped being “mostly player cards + predictions” and became a broader platform.
2. Predictions evolved into both a pregame board and a true postgame analytics destination.
3. The homepage was elevated from a player-search-first landing page into a platform front door.
4. The lottery page was iterated twice:
   - first toward a more dramatic reveal experience
   - then toward a simpler, table-first simulator
5. Fantasy Hub became the newest major product area and quickly turned into the main debugging focus.

---

## 27. Original Problems During This Five-Day Window and How They Evolved

### A. Predictions/game detail experience started too thin

The game page originally still felt like a prediction detail page:

- weak top hierarchy
- unfinished analytics section
- sequential layout instead of dashboard structure
- no strong postgame identity

This evolved into:

- a dedicated postgame dashboard
- stronger hero/header
- scoring summary + key moments + model recap
- preserved analytics hooks with much better presentation

### B. Shot map/rink rendering was visibly broken

The rink in the game page had a real geometry bug:

- shots plotted outside boards
- rink lines did not extend full height
- coordinate scaling was misaligned

This was corrected by:

- fixing rink line dimensions
- fixing coordinate normalization
- clipping shots with SVG logic
- widening the rink treatment and cleaning visuals

### C. Homepage identity was too narrow

The homepage was too player-search-centric and did not explain the broader product well.

This evolved into:

- a dedicated homepage
- platform hero and CTA structure
- daily insights / featured content
- tool grid
- featured players preview
- a separate `/players` destination preserving the old player search experience

### D. Lottery page was useful but too dashboard-heavy

The lottery page first needed more drama, then later needed simplification.

This evolved in two steps:

1. more suspense:
   - staged reveal
   - overlay winner animation
   - reshuffle emphasis

2. cleaner UX:
   - table-first layout
   - compact toolbar
   - tighter results strip
   - rules/config demoted in visual hierarchy

### E. Fantasy Hub rankings were repeatedly wrong

This became the biggest active debugging area.

Symptoms over several iterations:

- huge projected fantasy totals
- supporting category columns showing zeroes or nonsense
- mixed stat sources
- hidden stale fields inflating value
- rows ranked highly off malformed data

This evolved through multiple fixes:

1. normalize projected columns and ranking source
2. validate timeframe application
3. filter invalid projected rows
4. harden skater stat sourcing from `player_seasons` instead of stale `players` values
5. reject impossible skater-side `PPP`
6. extend scoring categories and make the projection logic auditable through explicit contribution breakdowns

### F. Fantasy settings UX was backward

League scoring lived too low in the page and users built rosters before defining format.

This was corrected by:

- moving league configuration above player search/roster tools
- framing it as “Step 1: Configure Your League”
- making it collapsible for returning users

---

## 28. Key Insights and Solutions Developed During These Five Days

### Predictions / postgame insights

- the postgame page works best when it feels like a game report first and a prediction route second
- existing analytics/data hooks were strong enough; presentation and section hierarchy were the main issues
- completed games need model recap data from `predictions_log`, not from the live pregame builder alone
- scoring summary and key moments were the correct foundation to preserve

### Shot map / game analytics insights

- geometry bugs on visualizations can make valid analytics feel untrustworthy
- the shot map became much more credible once the rink, clipping, and scale matched the actual NHL coordinate space
- strong empty states matter on analytics sections so the page doesn’t look broken when data is missing

### Homepage/product positioning insights

- the site needed a platform homepage, not just a functional page index
- the player search page was valuable enough to preserve, but it should not be the front door anymore
- daily relevance matters on the homepage:
  - predictions
  - featured games
  - featured players
  - live scores banner

### Lottery UX insights

- the user liked Tankathon’s usability more than the original dashboard-heavy structure
- a simpler board-first layout is more addictive and easier to repeat-run
- the reveal animation is best used as seasoning, not the dominant layout
- ownership/protection context belongs inline with the board as much as possible

### Fantasy Hub insights

- a waiver-style tool is premature without real ownership/availability data
- a compare-players tool is immediately valuable because it uses existing scoring + timeframe + schedule logic
- fantasy rankings must use one normalized stat schema end-to-end:
  - source stats
  - projected categories
  - projected fantasy points
  - visible columns
  - sorting
- hidden stale source fields, especially `PPP`, can wreck fantasy rankings even when the visible table looks cleaner
- league settings are the foundation of the feature and should appear before roster interaction
- advanced fantasy categories are fine, but only if missing stats stay `null` instead of silently becoming zeroes
- points-league totals needed an explicit contribution breakdown to make debugging believable

### Infrastructure insights

- nightly cron logging for predictions/results is important for long-run model accountability
- OG image/share flows add a lot of polish to a content-heavy product
- `sync_log`/freshness concepts are useful, but must remain backend-only until the UI layer is ready

---

## 29. User Working Style and Preferences Observed in This Period

### Product/design preferences

The user consistently prefers:

- premium dark styling
- polished, modern layouts
- pages that feel like real product destinations, not generic utilities
- strong clarity and interpretability over raw density
- table-first UX when it improves scanability
- fun, repeatable tool experiences where appropriate

### Workflow preferences

The user repeatedly prefers:

- making real changes and pushing quickly so they can review live
- one concrete request at a time for UI work
- backend/data fixes that address root causes instead of UI band-aids
- preserving working logic while upgrading UX around it
- practical, honest framing when data is missing or weak

### Communication preferences

The user responds well to:

- direct explanations of what was broken and why
- concise summaries of changed files
- quick push/test loops
- recommendations framed around what is “best next,” not giant option menus

---

## 30. Collaboration Approaches That Worked Well

### What worked best

- inspect existing structure first instead of rebuilding pages blindly
- preserve the user’s live product momentum by pushing incremental improvements
- keep major feature work modular:
  - homepage components
  - postgame page components
  - fantasy hub components
  - lottery simulator iterations
- treat visual redesigns as information-architecture problems, not just CSS changes
- when bugs persisted, move from “patch the output” to “audit the whole data path”

### Good implementation pattern established

For most product work, the successful loop was:

1. inspect current code paths
2. make a modular UI/data change
3. lint/check locally
4. push to `main`
5. user tests live on Vercel
6. refine from screenshots or behavior notes

This pattern worked particularly well for:

- postgame page redesign
- homepage work
- lottery UX iteration
- fantasy hub buildout
- mobile responsiveness

---

## 31. Clarifications and Corrections the User Made

The user gave several important corrections during this period:

- the dedicated homepage should not replace the Players page
- the new player page should remain a player-evaluation tool only, not betting-related
- the NHL lottery page should move closer to Tankathon usability without copying it
- the lottery page should ultimately become simpler and more table-first, not more dashboard-heavy
- a Waiver Finder should not be built yet because there is no reliable ownership/availability data
- Fantasy Compare Players should be the next major fantasy feature instead
- league settings belong above player/roster interaction in Fantasy Hub
- fantasy rankings bugs should be fixed in the data/projection pipeline, not merely hidden in the table UI
- projected fantasy totals must represent remaining-season or selected-timeframe value, not stale/full-season defaults
- PPP and SHP should not silently re-count goals/assists through hidden logic

---

## 32. Project Context and Examples Used

### External reference styles/products used conceptually

- HockeyStats:
  - postgame page structure
  - premium single-game dashboard feel
  - predictions/game cards inspiration
- MoneyPuck:
  - Deserved To Win meter concept
  - shot-map / xG-style inspiration
  - advanced game analytics inspiration
- Tankathon:
  - lottery simulator usability
  - table-first board focus
  - inline ownership/protection clarity

### Internal routes/features now relevant to a new conversation

- `/`
- `/players`
- `/players/[playerId]`
- `/predictions`
- `/predictions/[date]/[gameId]`
- `/playoff-odds`
- `/lottery`
- `/roster-builder`
- `/fantasy`

### Key files in this period

- Homepage:
  - [app/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/page.js)
  - [app/players/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/players/page.js)
  - [app/components/home/HomeHero.jsx](/Users/cspeedie/Desktop/nhl-analytics/app/components/home/HomeHero.jsx)
  - [app/lib/playerCardPageData.js](/Users/cspeedie/Desktop/nhl-analytics/app/lib/playerCardPageData.js)

- Postgame/predictions:
  - [app/predictions/[date]/[gameId]/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/predictions/[date]/[gameId]/page.js)
  - [app/predictions/[date]/[gameId]/PostgameDashboardClient.jsx](/Users/cspeedie/Desktop/nhl-analytics/app/predictions/[date]/[gameId]/PostgameDashboardClient.jsx)
  - [app/predictions/[date]/[gameId]/GameStatsPanel.jsx](/Users/cspeedie/Desktop/nhl-analytics/app/predictions/[date]/[gameId]/GameStatsPanel.jsx)
  - [app/lib/predictionsData.js](/Users/cspeedie/Desktop/nhl-analytics/app/lib/predictionsData.js)

- Lottery:
  - [LotterySimulator.jsx](/Users/cspeedie/Desktop/nhl-analytics/LotterySimulator.jsx)

- Fantasy Hub:
  - [app/fantasy/page.js](/Users/cspeedie/Desktop/nhl-analytics/app/fantasy/page.js)
  - [app/components/fantasy-hub/FantasyHubApp.jsx](/Users/cspeedie/Desktop/nhl-analytics/app/components/fantasy-hub/FantasyHubApp.jsx)
  - [app/components/fantasy-hub/FantasyLeagueSettings.jsx](/Users/cspeedie/Desktop/nhl-analytics/app/components/fantasy-hub/FantasyLeagueSettings.jsx)
  - [app/components/fantasy-hub/FantasyRankingsTable.jsx](/Users/cspeedie/Desktop/nhl-analytics/app/components/fantasy-hub/FantasyRankingsTable.jsx)
  - [app/components/fantasy-hub/FantasyComparePlayers.jsx](/Users/cspeedie/Desktop/nhl-analytics/app/components/fantasy-hub/FantasyComparePlayers.jsx)
  - [app/components/fantasy-hub/fantasyHubUtils.js](/Users/cspeedie/Desktop/nhl-analytics/app/components/fantasy-hub/fantasyHubUtils.js)
  - [app/api/fantasy/players/route.js](/Users/cspeedie/Desktop/nhl-analytics/app/api/fantasy/players/route.js)
  - [app/api/fantasy/schedule/route.js](/Users/cspeedie/Desktop/nhl-analytics/app/api/fantasy/schedule/route.js)

---

## 33. Templates and Processes Established

### Push-and-test template

Use this rhythm:

1. implement one focused feature/fix
2. run lint or targeted validation
3. push to `main`
4. user checks Vercel deployment/live route
5. iterate from screenshots or bug reports

### Fantasy rankings debugging template

The debugging process that emerged for Fantasy Hub was:

1. identify the exact normalized projection object
2. ensure visible columns and ranking sort use the same object
3. separate actual stats vs projected stats
4. validate timeframe alignment
5. reject malformed rows before ranking
6. add targeted debug logging for top rows
7. inspect one known player manually for end-to-end validation

### UI redesign template

When redesigning a page, the effective method was:

1. keep data hooks/backend logic intact
2. preserve one or two working foundation sections
3. fix information hierarchy
4. modularize into smaller components
5. only then add polish and motion

### Mobile pass template

For responsive work, the best approach became:

1. shared layout/container audit
2. nav/header mobile fix
3. cards/tables/charts/control patterns
4. page-specific cleanups
5. final overflow/tap-target QA

---

## 34. Current State at the End of This Five-Day Window

### Homepage

- dedicated product homepage exists
- Players remains a separate route
- homepage now acts as the front door to the platform

### Predictions / postgame

- postgame page is substantially more premium and usable
- scoring summary, key moments, and analytics are all present
- shot map geometry issues were fixed
- live scores banner exists
- nightly cron and prediction logging exist

### Lottery

- simulator logic remains intact
- page is now more board-first and closer to a fast repeat-use simulator
- reveal flow is still present but less dominant

### Player pages

- player card interpretation layer improved
- player page is clearer as an evaluation tool
- share card OG route exists

### Fantasy Hub

- major new section exists with:
  - My Team
  - Rankings
  - Compare Players
  - Schedule
- league setup is now the first step
- rankings logic has been hardened multiple times
- scoring settings are now broader and grouped more cleanly
- fantasy projection logic now has explicit contribution breakdown support

### Infrastructure / backend

- prediction logging + units + cron work are in place
- some backend freshness/sync concepts were added in adjacent work
- repo still needs careful scoping because many features have landed quickly

---

## 35. Active Caveats / Likely Open Problems

### Fantasy Hub remains the most likely active debugging area

Even after the recent hardening, the most likely remaining issues are still in Fantasy Hub:

- validating advanced stat availability for every fantasy category
- ensuring no stale upstream fields leak into projections
- verifying that the expanded scoring categories behave sensibly in live settings
- checking whether `PPP`/`SHP` should remain hidden columns or become visible when weighted

### Likely place to resume next

If a new conversation resumes right now, the highest-probability next work item is:

- keep debugging Fantasy Rankings projections live after deploy

The next most likely product work areas are:

- more Fantasy Hub polish
- more targeted postgame analytics improvements
- continued lottery UX tuning

---

## 36. Recommended Next Steps

### Highest-priority immediate steps

1. Test the live Fantasy Hub after the latest scoring/projection deploy:
   - `/fantasy`
   - league settings expansion
   - rankings under different scoring weights
   - compare player behavior under the same settings

2. Validate one known fantasy player manually in dev/live:
   - Matthew Tkachuk was the chosen manual audit reference
   - confirm remaining-games logic and contribution totals make sense

3. Decide whether fantasy rankings should expose more of the weighted categories in the table when those weights are active:
   - especially `PPP`, `SHP`, `FW%`, `TOI`, `PP TOI`

### Strong future additions

- fantasy ranking mode split:
  - earned to date
  - rest of season projection
- fantasy-specific tooltips explaining projected stats/timeframe
- better fantasy schedule context and opponent strength
- more polished player fit / roster fit notes in Fantasy Compare
- eventual waiver tool only after real ownership/availability data exists

### Product-level continuation ideas

- further postgame page polish from live screenshots
- continue tightening mobile UX after real-device review
- keep simplifying complex tools toward clearer first-use experiences

---

## 37. Short Handoff Summary

If a new conversation needs the quickest possible restart:

> Over the last five days, the site became a broader NHL analytics platform with a dedicated homepage, stronger postgame pages, a mobile responsiveness pass, a refined lottery simulator, and a new Fantasy Hub. The biggest current active area is Fantasy Hub rankings/scoring reliability. The user prefers fast live pushes, preserving working logic, premium dark styling, and root-cause data fixes rather than cosmetic patches. The most likely next step is to keep validating and refining Fantasy projections using the new explicit contribution breakdowns and live testing on `/fantasy`.
