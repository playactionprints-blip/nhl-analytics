#!/usr/bin/env python3
"""
Dynamically build a PLAYER_ID_PATCH for hockey-scraper name mismatches.

Hockey-scraper's player lookup table sometimes lacks IDs for certain players
(name format mismatches, recent signings, trades). This script:
  1. Scrapes a small batch of games with hockey-scraper to find all NaN player IDs
  2. For each missing name, queries the NHL search API (search.d3.nhle.com)
  3. Matches by full name (fuzzy) with a last-name-exact fallback
  4. Saves the patch to data/player_id_patch.json

The patch is intentionally team-agnostic — the NHL API returns the player's
CURRENT team, so it stays correct after trades (e.g. Marner → VGK, Miller → NYR).

USAGE:
    source venv/bin/activate
    python build_player_id_patch.py

The saved JSON file is loaded by build_rapm.py to fill NaN IDs before
constructing on-ice lineups.
"""
import os, re, json, time, unicodedata, warnings
import requests
import hockey_scraper
from rapidfuzz import process, fuzz

warnings.filterwarnings('ignore')

SEARCH_URL  = "https://search.d3.nhle.com/api/v1/search/player"
HEADERS     = {'User-Agent': 'nhl-analytics/1.0'}
DATA_DIR    = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
PATCH_FILE  = os.path.join(DATA_DIR, 'player_id_patch.json')

# Games used to discover missing IDs — first 20 of the 25-26 season.
# No need to change this; we add to the patch incrementally if new names appear.
PROBE_GAMES = list(range(2025020001, 2025020021))


# ── Name helpers ──────────────────────────────────────────────────────────────
def normalize(s):
    """Lowercase, strip accents, keep only letters and spaces."""
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z ]', '', s.lower()).strip()


def last_name_query(hs_upper):
    """
    Extract the best search term for the NHL API from an uppercase player name.
    Handles hyphenated names: 'ZACH ASTON-REESE' → 'Aston'.
    """
    parts = hs_upper.split()
    ln = parts[-1] if parts else hs_upper
    return ln.split('-')[0].title()


# ── NHL search API ────────────────────────────────────────────────────────────
def nhl_search(query, active=True):
    """Return list of player dicts from NHL search API."""
    params = {'culture': 'en-us', 'limit': 10, 'q': query}
    if active:
        params['active'] = 'true'
    try:
        r = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=10)
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, list) else []
    except Exception:
        pass
    return []


def find_player(hs_name):
    """
    Resolve an uppercase hockey-scraper player name to an NHL player ID.

    Strategy:
      1. Search by last name (active players first, then all).
      2. Full-name fuzzy match (token_sort_ratio ≥ 72).
      3. Last-name-exact fallback: if the last name matches exactly but
         first names differ (e.g. 'ANTHONY' vs 'Tony', 'MITCHELL' vs 'Mitch'),
         accept the single best candidate when last-name score == 100.

    Returns: (player_id, api_name, team_abbrev, score, active) or None.
    """
    ln_query = last_name_query(hs_name)
    target   = normalize(hs_name)          # e.g. 'mitchell marner'
    target_ln = normalize(ln_query)        # e.g. 'marner'

    for active in (True, False):
        candidates = nhl_search(ln_query, active=active)
        if not candidates:
            continue

        api_norm = [normalize(c['name']) for c in candidates]

        # ── Primary: full-name fuzzy match ────────────────────────────────
        best = process.extractOne(target, api_norm, scorer=fuzz.token_sort_ratio)
        if best and best[1] >= 72:
            idx = api_norm.index(best[0])
            p   = candidates[idx]
            return int(p['playerId']), p['name'], p.get('teamAbbrev', '?'), best[1], active

        # ── Fallback: last-name-exact match (handles nickname mismatches) ─
        # e.g. 'ANTHONY DEANGELO' → search 'Deangelo' → 'Tony DeAngelo'
        # The last name tokens match perfectly even if first names differ.
        ln_scores = [fuzz.ratio(target_ln, normalize(c['name'].split()[-1]))
                     for c in candidates]
        best_ln_score = max(ln_scores) if ln_scores else 0
        if best_ln_score == 100:
            idx = ln_scores.index(best_ln_score)
            p   = candidates[idx]
            # Accept only if it's the sole 100-score candidate (no ambiguity)
            n_perfect = sum(1 for s in ln_scores if s == 100)
            if n_perfect == 1:
                full_score = fuzz.token_sort_ratio(target, normalize(p['name']))
                return int(p['playerId']), p['name'], p.get('teamAbbrev', '?'), full_score, active

    return None


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    # Load any existing patch so we don't re-query already-resolved names
    existing_patch = {}
    if os.path.exists(PATCH_FILE):
        with open(PATCH_FILE) as f:
            existing_patch = json.load(f)
        print(f"Loaded existing patch: {len(existing_patch)} entries")

    # ── Step 1: Scrape probe games to find missing IDs ────────────────────
    print(f"\nScraping {len(PROBE_GAMES)} probe games to find missing player IDs...")
    result = hockey_scraper.scrape_games(PROBE_GAMES, False, data_format='pandas')
    pbp    = result['pbp']
    print(f"PBP: {len(pbp)} rows across {pbp['Game_Id'].nunique()} games")

    # ── Step 2: Collect missing names from PBP DataFrame ─────────────────
    # Scan homePlayer{1-6} / awayPlayer{1-6} name+id column pairs.
    # A player is "missing" when their name is populated but their ID is NaN.
    player_slots = (
        [(f'homePlayer{i}', f'homePlayer{i}_id') for i in range(1, 7)] +
        [(f'awayPlayer{i}', f'awayPlayer{i}_id') for i in range(1, 7)]
    )
    goalie_names = {
        str(n).strip().upper()
        for col in ('Home_Goalie', 'Away_Goalie')
        for n in pbp[col].dropna()
        if str(n).upper() != 'NAN'
    }

    missing_set = set()
    for name_col, id_col in player_slots:
        if name_col not in pbp.columns or id_col not in pbp.columns:
            continue
        mask = pbp[id_col].isna() & pbp[name_col].notna() & (pbp[name_col] != '')
        for name in pbp.loc[mask, name_col]:
            name = str(name).strip().upper()
            if name and name != 'NAN' and name not in goalie_names:
                missing_set.add(name)

    # Remove names already in the patch
    new_missing = sorted(missing_set - set(existing_patch.keys()))
    print(f"\nNew missing names to resolve: {len(new_missing)}")
    for n in new_missing:
        print(f"  {n}")

    if not new_missing:
        print("Nothing new to resolve.")
        return existing_patch

    # ── Step 3: Resolve via NHL API ───────────────────────────────────────
    print(f"\n{'='*60}")
    print("Resolving via search.d3.nhle.com ...")
    print(f"{'='*60}")

    new_resolved  = {}
    unresolved    = []

    for hs_name in new_missing:
        match = find_player(hs_name)
        time.sleep(0.25)

        if match:
            pid, api_name, team, score, active = match
            flag = " [inactive/retired]" if not active else ""
            print(f"  ✓  '{hs_name}' → {pid}  '{api_name}'  ({team}){flag}  score={score:.0f}")
            new_resolved[hs_name] = pid
        else:
            print(f"  ✗  '{hs_name}' → NOT FOUND (add manually if needed)")
            unresolved.append(hs_name)

    # ── Step 4: Merge + save ──────────────────────────────────────────────
    patch = {**existing_patch, **new_resolved}
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(PATCH_FILE, 'w') as f:
        json.dump(patch, f, indent=2, sort_keys=True)

    print(f"\n{'='*60}")
    print(f"Total patch entries: {len(patch)}  "
          f"(+{len(new_resolved)} new, {len(unresolved)} unresolved)")
    if unresolved:
        print(f"Still unresolved: {unresolved}")
        print("  → Add manually: patch['NAME'] = player_id  then re-save")
    print(f"Saved → {PATCH_FILE}")

    print(f"\nFull patch ({len(patch)} entries):")
    for name, pid in sorted(patch.items()):
        print(f'  "{name}": {pid}')

    return patch


if __name__ == '__main__':
    main()
