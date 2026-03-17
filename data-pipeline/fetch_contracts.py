#!/usr/bin/env python3
"""
Scrape Spotrac for NHL contract data + compute ages from birth_date.
Phase 1: Scrape 32 team cap pages → Spotrac ID + name + cap_hit
Phase 2: Scrape individual player pages → years, expiry, UFA/RFA type
Phase 3: Name-match to Supabase player IDs, upload contract_info + age
"""
import os, re, time, unicodedata
from datetime import date
import requests
from supabase import create_client
from sync_log import install_sync_logger

install_sync_logger("contracts")

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])
HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'}
SLEEP = 0.4

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

CURRENT_YEAR = 2025  # 2025-26 season


def normalize(name):
    """Lowercase, strip accents, remove non-alpha for fuzzy name match."""
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    name = re.sub(r"[^a-z ]", '', name.lower().strip())
    return re.sub(r'\s+', ' ', name).strip()


# ── Phase 1: Collect Spotrac IDs + cap hits from team pages ──────────────────
print("Phase 1: Scraping 32 team cap pages...")
spotrac_players = {}  # spotrac_id -> {name, cap_hit, ...}

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
            cap = int(cap_m.group(1).replace(',', '')) if cap_m else None
            if sid not in spotrac_players:
                spotrac_players[sid] = {'name': name, 'cap_hit': cap}
                added += 1
        print(f"  {team}: {len(player_trs)} rows, +{added} new (total={len(spotrac_players)})")
    except Exception as e:
        print(f"  {team}: ERROR {e}")
    time.sleep(SLEEP)

print(f"\nPhase 1 done: {len(spotrac_players)} unique Spotrac players\n")


# ── Phase 2: Fetch individual pages for full contract details ─────────────────
print("Phase 2: Fetching individual player pages...")

for i, (sid, info) in enumerate(spotrac_players.items()):
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

        # Use the "Cap Hit" card (correct for ELC contracts where AAV != cap hit).
        # Average Salary is the AAV and may include bonus pools (e.g. Bedard $4.45M AAV vs $950K cap).
        cap_card = re.search(
            r'card-title[^>]*>[^<]*Cap Hit[^<]*</h\d>\s*<p class="card-text[^"]*"[^>]*>\s*\$([0-9,]+)',
            r.text, re.S
        )
        if not cap_card:
            # fallback: prose "carrying a cap hit of $X"
            cap_card = re.search(r'cap hit of \$([0-9,]+)', r.text, re.I)
        if cap_card:
            info['cap_hit'] = int(cap_card.group(1).replace(',', ''))

        fa_raw = d.get('Free Agent', '').strip()
        fa_m = re.match(r'(20\d\d)(?:\s*/\s*(UFA|RFA|ELC))?', fa_raw)
        if fa_m:
            expiry = int(fa_m.group(1))
            info['expiry'] = expiry
            info['years_remaining'] = expiry - CURRENT_YEAR
            if fa_m.group(2):
                info['fa_type'] = fa_m.group(2)

        terms_raw = d.get('Contract Terms', '')
        yrs_m = re.match(r'(\d+)\s+yr', terms_raw)
        if yrs_m:
            info['total_years'] = int(yrs_m.group(1))

    except Exception:
        pass  # keep cap_hit from phase 1, skip detail fields

    if (i + 1) % 50 == 0:
        print(f"  {i+1}/{len(spotrac_players)} done...")
    time.sleep(SLEEP)

print("Phase 2 done\n")


# ── Phase 3: Match to Supabase players + upload ───────────────────────────────
print("Phase 3: Matching to Supabase + uploading...")

all_players = sb.table('players').select('player_id,full_name,birth_date').execute().data
print(f"  {len(all_players)} players in Supabase")

# Build Spotrac normalized name → info lookup (first occurrence wins)
spotrac_lookup = {}
for sid, info in spotrac_players.items():
    key = normalize(info['name'])
    if key not in spotrac_lookup:
        spotrac_lookup[key] = info
    # Also store hyphen-stripped variant
    alt = re.sub(r'\s+', ' ', re.sub(r"[-']", ' ', key)).strip()
    if alt not in spotrac_lookup:
        spotrac_lookup[alt] = info

today = date.today()
updated = skipped_no_match = skipped_no_cap = 0
matched_names = []

for p in all_players:
    key = normalize(p['full_name'])
    info = spotrac_lookup.get(key)
    if not info:
        alt = re.sub(r'\s+', ' ', re.sub(r"[-']", ' ', key)).strip()
        info = spotrac_lookup.get(alt)

    # Compute age regardless of contract match
    age = None
    bd = p.get('birth_date')
    if bd:
        birth = date.fromisoformat(str(bd))
        age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))

    if not info:
        skipped_no_match += 1
        if age is not None:
            sb.table('players').update({'age': age}).eq('player_id', p['player_id']).execute()
        continue

    cap = info.get('cap_hit')
    if not cap:
        skipped_no_cap += 1
        if age is not None:
            sb.table('players').update({'age': age}).eq('player_id', p['player_id']).execute()
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
    if age is not None:
        data['age'] = age

    sb.table('players').update(data).eq('player_id', p['player_id']).execute()
    updated += 1
    matched_names.append(p['full_name'])

print(f"\nDone.")
print(f"  Updated (contract + age): {updated}")
print(f"  No Spotrac match:         {skipped_no_match}")
print(f"  No cap hit:               {skipped_no_cap}")
print(f"\nSample matched: {matched_names[:12]}")
