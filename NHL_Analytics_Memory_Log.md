# NHL Analytics — Session Log & Memory

*Last updated: 2026-03-11*

---

## Architecture Overview

**Stack:** Next.js 16 App Router + Supabase (Postgres) + Python data pipeline

| File | Role |
|------|------|
| `app/page.js` | Server component — fetches from Supabase, passes `players` + `seasonStats` to `App` |
| `PlayerCard.jsx` | Main UI component (`"use client"`) — all tabs, stats display |
| `data-pipeline/compute_ratings.py` | 3-season weighted ratings engine |
| `data-pipeline/compute_percentiles.py` | Updates `players.percentiles` jsonb |

**Env vars** (in `.env.local`):
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Pipeline scripts need `SUPABASE_URL` + `SUPABASE_KEY` — map from NEXT_PUBLIC_ variants

---

## Supabase Schema

### `players` table (key columns)
```
player_id, full_name, first_name, last_name, position, team, jersey,
birth_date, nationality, height_cm, weight_kg, shoots,
gp, g, a, pts, toi (string "MM:SS"), plus_minus,
off_rating, def_rating, overall_rating, percentiles (jsonb),
rapm_off, rapm_def (stored but NOT in ratings formula — too noisy)
```
**Pending SQL migration** (run in Supabase SQL editor):
```sql
alter table players add column if not exists age int;
alter table players add column if not exists contract_info jsonb default '{}';
```
After migration, run `python data-pipeline/update_ages.py` to populate age from birth_date.

### `player_seasons` table
```
player_id, season ('25-26'/'24-25'/'23-24'), team, gp, toi (total min as float),
g, a1, a2, pts, ixg, icf, iff, hits, blk, gva, tka, fow, fol,
cf_pct, xgf_pct, hdcf_pct, scf_pct
```

**Data source mapping:**
- `a1, a2, ixg (=xG), icf (=SAT), iff (=SA), hits, blk, gva, tka, fow, fol` → from `evolving_hockey_stats.csv` (EH, all-situations)
- `cf_pct, xgf_pct, hdcf_pct, scf_pct` → from `nst_onice.csv` (NST, 5v5 on-ice)
- `tka` is 0 for all players (EH export doesn't populate it reliably)

---

## Ratings Formula

**Season weights:** 25-26 → 50%, 24-25 → 30%, 23-24 → 20%
**Qualify:** ≥20 GP current season OR ≥40 GP combined

**Offensive rating (all skaters, ranked within position group):**
```
ixg_60 × 33%  +  a1_60 × 25%  +  pts_60 × 20%  +  icf_60 × 11%  +  xgf_pct × 11%
```

**Defensive rating:**
```
xgf_pct × 31%  +  hdcf_pct × 31%  +  cf_pct × 15%  +  tka_60 × 14%  +  gva_inv × 9%
```

**Overall:** Forwards: off×65% + def×35%. Defense: off×45% + def×55%.
Faceoff bonus for centers: max +3 points based on FO%.

**RAPM excluded:** Single-season home-built RAPM proved unreliable (McDavid rank 157/672, Kucherov 15th pct). NHL shift API has ~50% game coverage with temporal gaps.

**Current top 5 (2026-03-11):**
1. Connor McDavid — 95.1
2. Matthew Tkachuk — 94.7
3. Brady Tkachuk — 92.8
4. Darren Raddysh — 92.3 *(high def metrics)*
5. Kirill Kaprizov — 91.5

---

## PlayerCard UI

**Header line:** `#XX · POSITION · AGE yrs` (age computed client-side from `birth_date`)

**Tabs:** Overview | On-Ice | WAR/RAPM | Ratings

**Overview tab stats:**
- GP / G / A / PTS grid
- PPP / +/- / Pts/82 grid
- Avg TOI row
- Cap Hit row *(only shows if `player.contract_info?.cap_hit` is set)*
- Percentile radar chart

---

## Contract Data Research (2026-03-11)

Tested all 4 options. **Clear winner: Spotrac** (spotrac.com).

| Source | Result |
|--------|--------|
| NHL API `/v1/player/{id}/landing` | No contract fields at all |
| CapFriendly | Completely offline (connection timeout) |
| PuckPedia | Cloudflare 403 — blocked |
| **Spotrac** ✅ | HTML scrapeable, full contract data |

**Spotrac data available:**
- Cap hit (AAV) — from `Average Salary` label/value pair
- Total contract years — from `Contract Terms: N yr(s) / $TOTAL`
- Free agent year — from `Free Agent: 2028` or `2028 / UFA`
- UFA/RFA type — embedded in Free Agent field when available

**Spotrac scraping approach (two phases):**
1. **Team pages** (32 requests, ~30 sec): `/nhl/{team}/cap/` → parse `<tr>` rows → Spotrac ID + name + cap_hit
2. **Player pages** (~700 requests, ~6 min at 0.5s sleep): `/nhl/player/_/id/{id}/` → full contract details
3. **Name-match** Spotrac names to NHL player IDs in Supabase

**Sample verified data:**
```
McDavid:    $12.50M cap  3yr rem  2028 UFA
Matthews:   $13.25M cap  3yr rem  2028 (type inferred)
Draisaitl:  $14.00M cap  8yr rem  2033 UFA
Bouchard:   $10.50M cap  4yr rem  2029 UFA
Shesterkin: $11.50M cap  8yr rem  2033 UFA
```

**Next step:** Write `data-pipeline/fetch_contracts.py` to run both phases and upload to Supabase.

---

## Notable Players / Edge Cases

**Matthew Schaefer** (NYI #48, D, player_id=8485366, DOB 2007-09-05):
- Added manually — was missing from original roster fetch (debuted post-fetch)
- player_seasons fully populated from EH + NST (2026-03-11)
- Off rating: 8th → **87th percentile** among D after stats fix
- On entry-level contract

**RAPM pipeline** (`build_rapm.py`):
- NHL shift API (`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId={id}`) has ~50% coverage for 2025-26 games — specific game ID ranges return 0 shifts
- Play-by-play API does NOT have per-event `onIce` player arrays (contrary to assumption)
- Single-season RAPM too noisy for reliable rankings → excluded from formula

---

## Data Files (`data-pipeline/data/`)

| File | Content | Used For |
|------|---------|---------|
| `evolving_hockey_stats.csv` | All-situations individual (EH, 25-26) | player_seasons individual stats |
| `eh_skaters_2324.csv`, `eh_skaters_2425.csv` | EH prior seasons | player_seasons prior years |
| `nst_onice.csv` | 5v5 on-ice % (NST, 25-26) | cf_pct, xgf_pct, hdcf_pct, scf_pct |
| `nst_onice_2324.csv`, `nst_onice_2425.csv` | NST on-ice prior seasons | same |
| `nst_skaters.csv` | 5v5 individual (NST) — NOT primary source | reference only |
| `stints_2526.csv` | RAPM model stints data | build_rapm.py (excluded from git) |

---

## Git Workflow

- Main branch: `main`
- Remote: `https://github.com/playactionprints-blip/nhl-analytics.git`
- `stints_2526.csv`, `stints_checkpoint.csv`, `game_ids_2526.json` — in `.gitignore`
- Recent commits: Fix Schaefer stats + age display (4da1d84), cleanup stints_checkpoint (3ce123e)
