#!/usr/bin/env python3
"""
Fix contract data for players missed in the initial fetch_contracts.py run
due to common-name vs legal-name mismatches (Josh→Joshua, TJ→Timothy, etc.).

Steps:
  1. Find all Supabase players with missing/empty contract_info
  2. Fetch their legal names from NHL API player landing pages
  3. Re-run Spotrac Phase 1 (32 team cap pages) to rebuild name→spotrac_id map
  4. Match unmatched players using legal names
  5. Fetch individual Spotrac pages only for newly resolved players
  6. Upload to Supabase

USAGE:
    export SUPABASE_URL=...
    export SUPABASE_KEY=...
    python fix_contract_mismatches.py
"""
import os, re, time, unicodedata
from datetime import date
import requests
from supabase import create_client
from rapidfuzz import process, fuzz

sb      = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    )
}
NHL_HEADERS  = {'User-Agent': 'nhl-analytics/1.0'}
NHL_API      = 'https://api-web.nhle.com/v1'
SLEEP        = 0.4
CURRENT_YEAR = 2025

NHL_TEAMS = [
    'anaheim-ducks', 'boston-bruins', 'buffalo-sabres', 'calgary-flames',
    'carolina-hurricanes', 'chicago-blackhawks', 'colorado-avalanche',
    'columbus-blue-jackets', 'dallas-stars', 'detroit-red-wings',
    'edmonton-oilers', 'florida-panthers', 'los-angeles-kings',
    'minnesota-wild', 'montreal-canadiens', 'nashville-predators',
    'new-jersey-devils', 'new-york-islanders', 'new-york-rangers',
    'ottawa-senators', 'philadelphia-flyers', 'pittsburgh-penguins',
    'san-jose-sharks', 'seattle-kraken', 'st-louis-blues',
    'tampa-bay-lightning', 'toronto-maple-leafs', 'utah-hockey-club',
    'vancouver-canucks', 'vegas-golden-knights', 'washington-capitals',
    'winnipeg-jets',
]


def normalize(name):
    """Lowercase, strip accents, remove non-alpha for fuzzy name match."""
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    name = re.sub(r"[^a-z ]", '', name.lower().strip())
    return re.sub(r'\s+', ' ', name).strip()


def name_variants(raw):
    """Return (primary_key, hyphen_stripped_alt) for spotrac_lookup."""
    key = normalize(raw)
    alt = re.sub(r'\s+', ' ', re.sub(r"[-']", ' ', key)).strip()
    return key, alt


# ── Step 1: Find players with missing contract data ───────────────────────────
print("=" * 60)
print("Step 1: Finding players with missing contract data")
print("=" * 60)

all_players = sb.table('players').select(
    'player_id,full_name,team,birth_date,contract_info'
).execute().data

unmatched = [
    p for p in all_players
    if not p.get('contract_info')  # None or {}
]
unmatched.sort(key=lambda x: x['full_name'])

print(f"Total players in Supabase:      {len(all_players)}")
print(f"Players with missing contracts: {len(unmatched)}")
print()
for p in unmatched:
    print(f"  {p['full_name']:<30}  {p.get('team', '?')}")


# ── Step 2: (skipped) ─────────────────────────────────────────────────────────
# NHL API returns the same common names as Supabase (both sourced from NHL API).
# Spotrac uses its own display names (Joshua vs Josh, Mitchell vs Mitch, etc.).
# Fuzzy matching in Step 4 handles Spotrac↔Supabase mismatches directly.


# ── Step 3: Re-run Spotrac Phase 1 — team cap pages ──────────────────────────
print(f"\n{'='*60}")
print("Step 3: Scraping 32 Spotrac team cap pages")
print("=" * 60)

# spotrac_id → {name, cap_hit}
spotrac_players = {}

for team in NHL_TEAMS:
    url = f'https://www.spotrac.com/nhl/{team}/cap/'
    try:
        r = requests.get(url, headers=HEADERS, timeout=12)
        trs = re.findall(r'<tr[^>]*>(.*?)</tr>', r.text, re.S)
        player_trs = [t for t in trs if '/player/_/id/' in t]
        added = 0
        for tr in player_trs:
            pm = re.search(r'/player/_/id/(\d+)/[^"]+"\s[^>]*>([^<]+)</a>', tr)
            if not pm:
                continue
            sid, name = pm.group(1), pm.group(2).strip()
            cap_m = re.search(r'\$([0-9,]+)', tr)
            cap   = int(cap_m.group(1).replace(',', '')) if cap_m else None
            if sid not in spotrac_players:
                spotrac_players[sid] = {'name': name, 'cap_hit': cap, 'spotrac_id': sid}
                added += 1
        print(f"  {team}: {len(player_trs)} rows, +{added} new")
    except Exception as e:
        print(f"  {team}: ERROR {e}")
    time.sleep(SLEEP)

print(f"\nPhase 1 done: {len(spotrac_players)} unique Spotrac players")

# Build reverse lookup: normalized_name → spotrac info
spotrac_lookup = {}
for sid, info in spotrac_players.items():
    key, alt = name_variants(info['name'])
    if key not in spotrac_lookup:
        spotrac_lookup[key] = info
    if alt not in spotrac_lookup:
        spotrac_lookup[alt] = info


# ── Step 4: Match unmatched players via name-component fuzzy matching ─────────
print(f"\n{'='*60}")
print("Step 4: Matching unmatched players via fuzzy name matching")
print(f"  (Spotrac uses legal names: Joshua/Mitchell/Timothy vs Josh/Mitch/TJ)")
print("=" * 60)

# Build flat list of all Spotrac normalized names for fuzzy search
spotrac_norm_list = list(spotrac_lookup.keys())


def _name_tokens(normalized):
    """Return (first_token, last_token) from a normalized name string."""
    parts = normalized.split()
    if len(parts) >= 2:
        return parts[0], parts[-1]
    return normalized, normalized


def _component_match(supabase_name, spotrac_norm):
    """
    Returns True only when BOTH first-name and last-name are similar.
    Thresholds: last-name ratio ≥ 85, first-name ratio ≥ 60.
    This prevents cross-player matches like 'Patrick Maroon'→'Patrick Brown'
    or 'Alex Nylander'→'William Nylander'.
    """
    s_fn, s_ln = _name_tokens(supabase_name)
    t_fn, t_ln = _name_tokens(spotrac_norm)
    return (fuzz.ratio(s_ln, t_ln) >= 85 and
            fuzz.ratio(s_fn, t_fn) >= 60)


newly_matched = []   # list of {player, spotrac_info, score}
still_missing = []

for p in unmatched:
    common = p['full_name']

    # Stage 1: exact match (normalized key or hyphen-stripped alt)
    key, alt = name_variants(common)
    info = spotrac_lookup.get(key) or spotrac_lookup.get(alt)
    if info:
        newly_matched.append({'player': p, 'spotrac': info, 'score': 100})
        print(f"  ✓  {common:<28} → '{info['name']}'  (exact)")
        continue

    # Stage 2: fuzzy — token_sort_ratio ≥ 80 AND component check
    best = process.extractOne(
        key, spotrac_norm_list,
        scorer=fuzz.token_sort_ratio,
        score_cutoff=80,
    )
    if best and _component_match(key, best[0]):
        info = spotrac_lookup[best[0]]
        newly_matched.append({'player': p, 'spotrac': info, 'score': best[1]})
        cap_str = f"  cap=${info['cap_hit']:,}" if info.get('cap_hit') else ''
        print(f"  ✓  {common:<28} → '{info['name']}'  score={best[1]:.0f}{cap_str}")
        continue

    # Stage 3: last-name exact fallback — handles Gabe↔Gabriel, first-name mismatches.
    # Require: last name matches 100%, only ONE such candidate, and first names
    # have some similarity (≥ 50) to prevent sibling/same-last-name false positives.
    target_fn, target_ln = _name_tokens(key)
    ln_scores = [
        (nm, fuzz.ratio(target_ln, _name_tokens(nm)[1]))
        for nm in spotrac_norm_list
        if nm.split()
    ]
    perfect_ln = [(nm, s) for nm, s in ln_scores if s == 100]
    if len(perfect_ln) == 1:
        match_key  = perfect_ln[0][0]
        match_fn   = _name_tokens(match_key)[0]
        fn_sim     = fuzz.ratio(target_fn, match_fn)
        if fn_sim >= 50:  # first names must have some resemblance
            info  = spotrac_lookup[match_key]
            score = fuzz.token_sort_ratio(key, match_key)
            newly_matched.append({'player': p, 'spotrac': info, 'score': score})
            cap_str = f"  cap=${info['cap_hit']:,}" if info.get('cap_hit') else ''
            print(f"  ✓  {common:<28} → '{info['name']}'  score={score:.0f} "
                  f"(last-name fallback, fn_sim={fn_sim:.0f}){cap_str}")
            continue

    still_missing.append(p)
    closest = process.extractOne(key, spotrac_norm_list, scorer=fuzz.token_sort_ratio)
    closest_str = f"  (closest: '{closest[0]}' score={closest[1]:.0f})" if closest else ''
    print(f"  ✗  {common:<28}{closest_str}")

print(f"\nResolved: {len(newly_matched)} | Still missing: {len(still_missing)}")


# ── Step 5: Fetch individual Spotrac pages for newly matched players ──────────
print(f"\n{'='*60}")
print(f"Step 5: Fetching individual Spotrac pages for {len(newly_matched)} players")
print("=" * 60)

for item in newly_matched:
    info = item['spotrac']
    sid  = info.get('spotrac_id')
    if not sid:
        continue
    url = f'https://www.spotrac.com/nhl/player/_/id/{sid}/'
    try:
        r = requests.get(url, headers=HEADERS, timeout=12)
        pairs = re.findall(
            r'class="label">([^<]+)</div>\s*<div class="value">([^<]+)</div>', r.text
        )
        d = {}
        for lbl, val in pairs:
            key = lbl.strip().rstrip(':').strip()
            if key not in d:
                d[key] = val.strip()

        # Prefer "Cap Hit" card; fall back to team-page value
        cap_card = re.search(
            r'card-title[^>]*>[^<]*Cap Hit[^<]*</h\d>\s*<p class="card-text[^"]*"[^>]*>\s*\$([0-9,]+)',
            r.text, re.S
        )
        if not cap_card:
            cap_card = re.search(r'cap hit of \$([0-9,]+)', r.text, re.I)
        if cap_card:
            info['cap_hit'] = int(cap_card.group(1).replace(',', ''))

        fa_raw = d.get('Free Agent', '').strip()
        fa_m = re.match(r'(20\d\d)(?:\s*/\s*(UFA|RFA|ELC))?', fa_raw)
        if fa_m:
            expiry = int(fa_m.group(1))
            info['expiry']          = expiry
            info['years_remaining'] = expiry - CURRENT_YEAR
            if fa_m.group(2):
                info['fa_type'] = fa_m.group(2)

        terms_raw = d.get('Contract Terms', '')
        yrs_m = re.match(r'(\d+)\s+yr', terms_raw)
        if yrs_m:
            info['total_years'] = int(yrs_m.group(1))

    except Exception:
        pass  # keep cap_hit from phase 1
    time.sleep(SLEEP)

print("Individual page scrape complete")


# ── Step 5b: Clear previously bad-matched records ────────────────────────────
# The previous run (before component-check was added) uploaded wrong contracts
# for players matched on first-name only. Clear those now so we start clean.
# These are identified by being in the unmatched list (Step 1) — meaning they
# had contract_info={} (empty), so clearing them again is safe.
print(f"\n{'='*60}")
print("Step 5b: Clearing any stale bad-match contract data for unmatched players")
print("=" * 60)

newly_matched_pids = {item['player']['player_id'] for item in newly_matched}
cleared = 0
for p in unmatched:
    if p['player_id'] not in newly_matched_pids:
        sb.table('players').update({'contract_info': {}}) \
          .eq('player_id', p['player_id']).execute()
        cleared += 1
print(f"  Cleared/reset {cleared} players who remain unresolved")


# ── Step 6: Upload to Supabase ────────────────────────────────────────────────
print(f"\n{'='*60}")
print("Step 6: Uploading to Supabase")
print("=" * 60)

today = date.today()
uploaded = skipped_no_cap = 0

for item in newly_matched:
    p    = item['player']
    info = item['spotrac']
    cap  = info.get('cap_hit')
    if not cap:
        skipped_no_cap += 1
        continue

    contract = {'cap_hit': cap}
    if 'expiry' in info:
        contract['expiry'] = info['expiry']
    if 'years_remaining' in info:
        contract['years_remaining'] = info['years_remaining']
    if 'fa_type' in info:
        contract['expiry_type'] = info['fa_type']
    if 'total_years' in info:
        contract['total_years'] = info['total_years']

    data = {'contract_info': contract}

    bd = p.get('birth_date')
    if bd:
        birth = date.fromisoformat(str(bd))
        age   = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
        data['age'] = age

    sb.table('players').update(data).eq('player_id', p['player_id']).execute()
    uploaded += 1
    print(f"  ✓  {p['full_name']:<28}  cap=${cap:,}"
          + (f"  expiry={info.get('expiry', '?')} {info.get('fa_type', '')}" if 'expiry' in info else ''))

print(f"\nDone.")
print(f"  Newly uploaded:   {uploaded}")
print(f"  No cap hit found: {skipped_no_cap}")
print(f"  Still missing:    {len(still_missing)}")
if still_missing:
    print("\nStill unresolved (likely AHL callups or Spotrac gaps):")
    for p in still_missing:
        print(f"  {p['full_name']:<30}  {p.get('team', '?')}")
