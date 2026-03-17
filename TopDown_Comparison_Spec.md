# NHL Analytics vs. TopDownHockey / JFresh

Last updated: 2026-03-14

## Purpose

This document explains how the current NHL Analytics model compares to the methodology used by JFresh / TopDownHockey, where the gaps are, and what to change if we want our WAR and player cards to move closer to that standard.

This is not a criticism of the current product. The current site already has a strong player-card experience and a useful skater rating model. The main question is whether we want:

1. a strong public-facing custom analytics product, or
2. a model that is much closer to TopDownHockey's WAR framework

Right now, we are closer to option 1.

## Current Product Identity

Our site currently combines three things:

1. A card-first frontend for players and teams
2. A 3-season weighted skater rating system
3. A current-season WAR-style component model

That means the app is not powered by one single unified model. Instead:

- `overall_rating` is a weighted percentile-based talent/performance rating
- `war_total` is a season-value estimate
- percentiles are a simplified descriptive layer
- team pages aggregate those outputs into roster and team views

This is useful, but it is importantly different from TopDownHockey, where WAR and card outputs are part of a more unified methodology.

## What We Already Share With JFresh / TopDown

### Shared product philosophy

- Card-first presentation
- Emphasis on readability for fans
- One big headline metric with supporting components
- Strong use of percentiles
- Multi-season weighting for player-card style evaluation
- Separation of offensive and defensive value

### Shared data ideas

- Expected goals matter
- RAPM matters
- Position-aware comparison matters
- Team context should not be the only explanation for player value

## What Our Model Does Today

### Ratings

The current skater ratings in `data-pipeline/compute_ratings.py` are based on 3-season weighted percentiles.

Offense currently uses:

- ixG/60
- A1/60
- RAPM offense percentile
- Pts/60
- iCF/60
- xGF%
- finishing percentile

Defense currently uses:

- xGF%
- HDCF%
- CF%
- TKA/60
- inverted giveaways
- PK CF%
- RAPM defense percentile

Overall rating:

- forwards: offense-heavy
- defensemen: defense-heavier
- centers get a faceoff bonus
- PP deployment adds a coach-trust style bonus

### WAR

The current WAR model is much simpler than TopDownHockey.

Current components:

- EV offense WAR from RAPM offense + 5v5 TOI
- EV defense WAR from RAPM defense + 5v5 TOI
- PP WAR from on-ice PP xGF/60 above league average
- PK WAR from on-ice PK xGA/60 better than league average

Missing components:

- isolated shooting WAR
- penalty drawing/taking WAR
- isolated special teams RAPM
- prior-informed RAPM

### RAPM

Our RAPM pipeline in `data-pipeline/build_rapm.py`:

- builds 5v5 stints from play-by-play and shift data
- fits ridge regression for offense and defense
- uses weighted stints and a TOI minimum

Important limitation:

The current RAPM model does not include many contextual controls that TopDownHockey includes, such as:

- zone starts
- score state
- home ice
- teammate/opponent structure beyond basic on-ice player dummies
- back-to-backs
- power-play expiry shift handling
- prior-informed carryover across seasons

### Expected Goals

Our xG in RAPM construction is a hand-built shot model using:

- distance
- angle
- shot type adjustments

That is directionally useful, but much simpler than TopDownHockey's machine-learned xG framework.

## What TopDownHockey Appears To Do Differently

Based on the published methodology pages, TopDownHockey's WAR framework is more complete and more isolated.

### WAR components

TopDown WAR includes:

- EV offense
- EV defense
- PP offense
- PK defense
- penalties
- shooting

That is the biggest structural difference.

### RAPM structure

TopDown RAPM is more context-adjusted and prior-informed.

That matters because the quality of EV offense and EV defense depends heavily on whether the model is really isolating player impact from deployment and teammate environment.

### Special teams

TopDown's special teams value is not just raw on-ice split performance versus league average. It appears to be modeled in a more isolated way.

Our current PP and PK WAR are much closer to:

- "what happened while this player was on the ice in that situation"

than:

- "what this player individually drove in that situation after context adjustment"

### Shooting

TopDown explicitly gives shooting its own WAR component.

Our model currently uses finishing only inside `overall_rating`, not inside `war_total`.

That means elite finishers and shot-makers can be undervalued in WAR if their value is not fully captured by RAPM or on-ice xG.

### Penalties

TopDown includes penalties in WAR.

We currently omit them entirely.

That matters more than it seems, because drawn penalties and avoided penalties can move player value meaningfully over a season.

## Why Our WAR Leaderboard Can Differ A Lot

Even after fixing the RAPM scaling bug, our WAR can still disagree with TopDownHockey for legitimate methodological reasons.

### MacKinnon example

TopDownHockey currently has Nathan MacKinnon leading WAR.

The published component mix shows that his value there comes heavily from:

- elite EV offense
- strong shooting value
- positive PP value
- not much PK value
- not necessarily strong EV defense

Our corrected WAR gave MacKinnon about:

- moderate EV offense
- moderate EV defense
- very large PP value
- almost no PK value
- no explicit shooting WAR

This tells us:

1. We likely over-assign special teams value to on-ice environment
2. We likely under-model shooting as an individual skill in WAR
3. Our EV defensive signal may still be flattering offensive stars too much

## Similarities and Differences by System

### Player cards

Similar:

- percentile-based visual presentation
- offensive/defensive component framing
- card as the core product

Different:

- JFresh / TopDown cards are more tightly tied to a unified WAR/projection framework
- our cards currently mix descriptive stats, custom ratings, and WAR-style outputs from separate systems

### Team cards

Similar:

- aggregate team strength into a card/grid view
- use underlying analytics, not just standings

Different:

- our team pages are roster aggregates
- TopDown team cards are more model-native and forecasting-oriented

### Microstats

We currently do not have a true microstat layer comparable to TopDown's microstat cards.

Our site shows usage and shot-based impacts, but not a dedicated passing/carrying/entry/exit style microstat model.

## What Our Current Model Is Good At

- Clean, understandable player presentation
- Strong offensive skill surfacing through weighted ratings
- Good fan-facing readability
- Fast path to team/player browsing
- Reasonable use of public data sources
- Flexible product design that does not depend on one single methodology

## What Our Current Model Is Weak At

- WAR is not yet a complete all-in-one value model
- RAPM isolation is much weaker than TopDown's published approach
- PP/PK WAR are too dependent on raw on-ice results
- shooting is not separated inside WAR
- penalties are absent
- xG model is much simpler than what top public leaders likely use
- ratings and WAR are conceptually mixed on the frontend

## Recommended Product Decision

We should decide explicitly between two paths.

### Path A: Keep our custom identity

Positioning:

"A modern NHL player card site with custom weighted ratings, WAR-style value estimates, and clean public-data analytics."

What this means:

- keep `overall_rating` as the hero metric
- keep WAR as a secondary metric
- be honest that WAR is a custom public-data estimate, not a TopDown clone
- iterate for usefulness and readability instead of methodological parity

Pros:

- faster
- easier to explain
- less risk of chasing a methodology we cannot fully reproduce

Cons:

- WAR comparisons to TopDown/JFresh will keep surfacing
- advanced users may question model rigor

### Path B: Move toward a TopDown-style WAR system

Positioning:

"A deeper public WAR platform modeled more closely on top public methodology."

What this means:

- rebuild WAR architecture, not just tweak weights
- treat `overall_rating` and WAR as separate products
- improve RAPM, xG, and component decomposition materially

Pros:

- more credible WAR output
- closer comparability to the market leader
- better chance of leaderboard agreement on elite players

Cons:

- significantly more modeling work
- more data engineering burden
- harder validation problem

## Recommended Build Path

Recommended approach: hybrid.

We should keep the current custom rating system, but rebuild WAR in a more principled way over time.

That means:

- `overall_rating` remains our signature public-facing metric
- WAR becomes a separate, more rigorous project track

## WAR Rebuild Priorities

### Phase 1: Clean separation and labeling

Goal:

Make the product honest and easier to reason about.

Changes:

- label current WAR as a custom WAR estimate
- keep `overall_rating` as the card hero
- add component explanations on the site
- stop implying all card values come from the same model family

### Phase 2: Fix WAR structure

Goal:

Bring the model structure closer to TopDown.

Add:

- shooting WAR
- penalties WAR

Change:

- PP and PK should move away from raw on-ice split value and toward more isolated player value

### Phase 3: Improve RAPM

Goal:

Make EV value more trustworthy.

Add context features where possible:

- zone starts
- score effects
- home/away
- teammate/opponent structure refinements
- back-to-back flags

Longer-term:

- introduce priors across seasons

### Phase 4: Upgrade xG

Goal:

Reduce error in the target that feeds RAPM and other value estimates.

Potential improvements:

- add rebound information
- rush / pre-shot movement proxies if available
- shot context expansion
- scorekeeper normalization where possible
- calibration testing

### Phase 5: Validation layer

Goal:

Make sure the model is not just elegant, but believable.

Validation checks:

- leaderboard sanity for elite players
- year-to-year stability
- out-of-sample predictiveness
- component plausibility by role
- comparison against TopDown/JFresh public outcomes

## Concrete Differences To Close First

If the goal is to get closer to TopDown with the least amount of work, the order should be:

1. Add shooting WAR
2. Add penalties WAR
3. Reduce PP/PK dependence on raw on-ice rates
4. Improve EV RAPM isolation
5. Upgrade xG model

This order matters because the biggest current leaderboard differences are likely coming from missing shooting WAR and oversized special-teams assignment.

## Practical Interpretation For The Current Site

Today, the strongest statement we can make is:

"Our site provides custom NHL player cards powered by weighted ratings, public-data RAPM, and WAR-style value estimates."

The weaker statement would be:

"Our WAR means the same thing as TopDownHockey WAR."

It does not, at least not yet.

## Recommended Messaging On The Site

Suggested public framing:

- `Overall Rating`: our custom 3-year weighted player rating
- `WAR`: our season value estimate from public data
- `RAPM`: context-adjusted impact estimate, experimental and improving

This keeps the product credible while leaving room to improve.

## Implementation Checklist

Short term:

- keep the corrected RAPM scaling fix
- add this comparison framing to internal docs
- decide whether `overall_rating` or `WAR` is the primary public hero metric

Medium term:

- add shooting WAR prototype
- add penalties WAR prototype
- test whether PP WAR is too team-environment-driven

Long term:

- rebuild RAPM inputs and priors
- upgrade xG pipeline
- separate descriptive cards from predictive cards if needed

## Bottom Line

Our current product is already strong as a fan-facing analytics site.

But analytically, we are not yet doing the same thing TopDownHockey is doing.

The biggest differences are:

- incomplete WAR decomposition
- simpler RAPM
- simpler xG
- no shooting WAR
- no penalties WAR
- too much special-teams value assigned through raw on-ice splits

If we want closer leaderboard agreement with TopDownHockey, we should not just tweak weights. We should rebuild WAR as a fuller component model while keeping our current rating system as a separate strength.
