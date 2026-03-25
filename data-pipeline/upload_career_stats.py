#!/usr/bin/env python3
"""upload_career_stats.py — Upload career stats from Evolving Hockey all-seasons CSV.

Reads data/eh_skaters_all_seasons.csv, matches each player to a player_id via
Supabase fuzzy name lookup, and upserts rows to the career_stats table.

Requires: career_stats table to exist (run migrations/add_career_stats.sql first)

Usage (from data-pipeline/):
    python3 -u -c "
import os, sys
with open('../.env.local') as f:
    for line in f:
        line=line.strip()
        if '=' in line and not line.startswith('#'):
            k,v=line.split('=',1)
            os.environ[k]=v
            if k.startswith('NEXT_PUBLIC_'):
                os.environ[k[len('NEXT_PUBLIC_'):]]=v
if 'SUPABASE_KEY' not in os.environ:
    os.environ['SUPABASE_KEY']=os.environ.get('SUPABASE_ANON_KEY','')
exec(open('upload_career_stats.py').read())
"
"""

import os
import sys
import time
import unicodedata

import pandas as pd
import requests as _req

# ── env ───────────────────────────────────────────────────────────────────────
try:
    with open('../.env.local') as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                os.environ.setdefault(k, v)
                if k.startswith('NEXT_PUBLIC_'):
                    os.environ.setdefault(k[len('NEXT_PUBLIC_'):], v)
except FileNotFoundError:
    pass

if 'SUPABASE_KEY' not in os.environ:
    os.environ['SUPABASE_KEY'] = os.environ.get('SUPABASE_ANON_KEY', '')

from supabase import create_client  # noqa: E402

url = os.environ['SUPABASE_URL']
key = os.environ['SUPABASE_KEY']
supabase = create_client(url, key)

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
CSV_FILE = os.path.join(DATA_DIR, 'eh_skaters_all_seasons.csv')

# ── EH full team name → NHL abbreviation ─────────────────────────────────────
# Covers active teams + historical franchises present in 2007–08 through 2025–26.
EH_TEAM_TO_CODE = {
    "Anaheim Ducks":          "ANA",
    "Arizona Coyotes":        "ARI",
    "Atlanta Thrashers":      "ATL",
    "Boston Bruins":          "BOS",
    "Buffalo Sabres":         "BUF",
    "Calgary Flames":         "CGY",
    "Carolina Hurricanes":    "CAR",
    "Chicago Blackhawks":     "CHI",
    "Colorado Avalanche":     "COL",
    "Columbus Blue Jackets":  "CBJ",
    "Dallas Stars":           "DAL",
    "Detroit Red Wings":      "DET",
    "Edmonton Oilers":        "EDM",
    "Florida Panthers":       "FLA",
    "Los Angeles Kings":      "LAK",
    "Minnesota Wild":         "MIN",
    "Montreal Canadiens":     "MTL",
    "Nashville Predators":    "NSH",
    "New Jersey Devils":      "NJD",
    "New York Islanders":     "NYI",
    "New York Rangers":       "NYR",
    "Ottawa Senators":        "OTT",
    "Philadelphia Flyers":    "PHI",
    "Phoenix Coyotes":        "PHX",
    "Pittsburgh Penguins":    "PIT",
    "San Jose Sharks":        "SJS",
    "Seattle Kraken":         "SEA",
    "St. Louis Blues":        "STL",
    "Tampa Bay Lightning":    "TBL",
    "Toronto Maple Leafs":    "TOR",
    "Utah Hockey Club":       "UTA",
    "Vancouver Canucks":      "VAN",
    "Vegas Golden Knights":   "VGK",
    "Washington Capitals":    "WSH",
    "Winnipeg Jets":          "WPG",
}

# EH uses abbreviated codes that differ from NHL standard for 4 teams
EH_ABBREV_FIX = {
    "L.A": "LAK",
    "S.J": "SJS",
    "T.B": "TBL",
    "N.J": "NJD",
}

# First-name aliases: CSV may use "Alex" where NHL API/Supabase stores "Alexander"
FIRST_NAME_ALIASES = {
    "Alex": "Alexander",
    "Mike": "Michael",
    "Manny": "Emmanuel",
    "Zach": "Zachary",
}


def normalize_name(name):
    """Lowercase, strip accents, strip extra whitespace."""
    s = str(name or "").strip()
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.strip().lower()


def parse_toi(val):
    """Parse TOI: decimal minutes float OR H:MM:SS / MM:SS string → float minutes."""
    if val is None:
        return None
    try:
        if isinstance(val, (int, float)) and not pd.isna(val):
            return float(val)
    except (TypeError, ValueError):
        pass
    s = str(val).strip()
    if not s or s.lower() in ('nan', ''):
        return None
    if ':' in s:
        parts = s.split(':')
        try:
            if len(parts) == 3:
                return int(parts[0]) * 60 + int(parts[1]) + int(parts[2]) / 60
            if len(parts) == 2:
                return int(parts[0]) + int(parts[1]) / 60
        except ValueError:
            return None
    try:
        return float(s)
    except ValueError:
        return None


def safe_int(val, default=0):
    try:
        f = float(val)
        return int(f) if not pd.isna(f) else default
    except (TypeError, ValueError):
        return default


def safe_float(val):
    try:
        f = float(val)
        return None if pd.isna(f) else f
    except (TypeError, ValueError):
        return None


# ── Step 1: Load CSV ──────────────────────────────────────────────────────────
print("=" * 60)
print("NHL Analytics — Career Stats Upload")
print("=" * 60)

print(f"\n[1] Loading {CSV_FILE} ...")
df = pd.read_csv(CSV_FILE)
print(f"    {len(df):,} rows  |  columns: {list(df.columns)}")

# ── Step 2: Fetch all players ─────────────────────────────────────────────────
print("\n[2] Fetching players from Supabase ...")
player_rows = []
start = 0
batch = 1000
while True:
    res = supabase.from_('players').select('player_id,full_name').range(start, start + batch - 1).execute()
    chunk = res.data or []
    player_rows.extend(chunk)
    if len(chunk) < batch:
        break
    start += batch
print(f"    {len(player_rows)} players fetched")

name_to_id = {normalize_name(r['full_name']): r['player_id'] for r in player_rows}

# ── Step 2b: Resolve retired players via NHL stats REST API ──────────────────
# The Supabase players table only has active players. Any CSV player not found
# there is retired. Look them up by exact name via the NHL historical stats API.
print("\n[2b] Scanning CSV for players not in Supabase ...")
df_pre = pd.read_csv(CSV_FILE)
csv_names = {str(r.get('Player', '') or '').strip() for _, r in df_pre.iterrows()}
unmatched_names = sorted(n for n in csv_names if n and name_to_id.get(normalize_name(n)) is None)
print(f"    {len(unmatched_names)} players not in Supabase — resolving via NHL API ...")


def nhl_stats_player_id(full_name):
    """Query NHL stats REST API for a player's ID by exact full name.
    Also tries first-name aliases (Alex → Alexander, etc.) on failure.
    """
    def _query(name):
        try:
            r = _req.get(
                "https://api.nhle.com/stats/rest/en/skater/summary",
                params={
                    "limit": 3,
                    "start": 0,
                    "sort": '[{"property":"seasonId","direction":"DESC"}]',
                    "cayenneExp": f'skaterFullName="{name}" and gameTypeId=2',
                },
                timeout=8,
            )
            if r.ok:
                rows = r.json().get("data", [])
                if rows:
                    return int(rows[0]["playerId"])
        except Exception:
            pass
        return None

    pid = _query(full_name)
    if pid:
        return pid

    # Try first-name alias (Alex → Alexander, etc.)
    parts = full_name.split(' ', 1)
    if len(parts) == 2 and parts[0] in FIRST_NAME_ALIASES:
        alt_name = f"{FIRST_NAME_ALIASES[parts[0]]} {parts[1]}"
        pid = _query(alt_name)
        if pid:
            # Also register the canonical name so the CSV lookup hits
            name_to_id[normalize_name(alt_name)] = pid
            return pid
    return None


def supabase_name_lookup(full_name):
    """Look up player_id in name_to_id, also trying first-name aliases."""
    pid = name_to_id.get(normalize_name(full_name))
    if pid:
        return pid
    parts = full_name.split(' ', 1)
    if len(parts) == 2 and parts[0] in FIRST_NAME_ALIASES:
        return name_to_id.get(normalize_name(f"{FIRST_NAME_ALIASES[parts[0]]} {parts[1]}"))
    return None


resolved = 0
failed = []
for i, name in enumerate(unmatched_names):
    # Skip if the alias variant is already in name_to_id (Alexander Holtz etc.)
    if supabase_name_lookup(name):
        resolved += 1
        continue
    pid = nhl_stats_player_id(name)
    if pid:
        name_to_id[normalize_name(name)] = pid
        resolved += 1
    else:
        failed.append(name)
    # Polite pacing — 20 req/s max
    if i % 20 == 19:
        time.sleep(1.0)

print(f"    Resolved {resolved} / {len(unmatched_names)} retired players via NHL API")
if failed:
    print(f"    Still unmatched ({len(failed)}): {sorted(failed)[:20]}")

# ── Step 3: Process CSV rows ──────────────────────────────────────────────────
print("\n[3] Processing CSV rows ...")
records = []
unmatched = set()
unknown_teams = set()

for _, row in df.iterrows():
    player_name = str(row.get('Player', '') or '').strip()
    season      = str(row.get('Season', '') or '').strip()
    team_full   = str(row.get('Team',   '') or '').strip()

    player_id = supabase_name_lookup(player_name)
    if player_id is None:
        unmatched.add(player_name)
        continue

    if team_full in EH_TEAM_TO_CODE:
        team_abbr = EH_TEAM_TO_CODE[team_full]
    elif team_full in EH_ABBREV_FIX:
        team_abbr = EH_ABBREV_FIX[team_full]
    elif len(team_full) <= 4 and team_full.replace('.', '').isalpha():
        # Already an abbreviation (ANA, BOS, PHX, ATL, etc.) — use as-is
        team_abbr = team_full
    else:
        # Unknown full name — flag for review
        team_abbr = team_full[:3].upper() if team_full else 'UNK'
        unknown_teams.add(team_full)

    gp   = safe_int(row.get('GP'))
    g    = safe_int(row.get('G'))
    # EH provides A1 (primary) + A2 (secondary); sum them for total assists
    a1   = safe_int(row.get('A1', 0))
    a2   = safe_int(row.get('A2', 0))
    a    = a1 + a2
    pts  = safe_int(row.get('Points', 0))
    toi  = parse_toi(row.get('TOI'))
    ixg  = safe_float(row.get('ixG'))

    # EH penalty columns: iPENT2/iPEND2 = 2-min minor counts, iPENT5/iPEND5 = major counts
    # Convert counts → penalty minutes (2-min minors × 2, majors × 5)
    pent2 = safe_float(row.get('iPENT2')) or 0.0
    pend2 = safe_float(row.get('iPEND2')) or 0.0
    pent5 = safe_float(row.get('iPENT5')) or 0.0
    pend5 = safe_float(row.get('iPEND5')) or 0.0
    penalty_minutes_taken = round(pent2 * 2.0 + pent5 * 5.0, 1) if (pent2 or pent5) else None
    penalty_minutes_drawn = round(pend2 * 2.0 + pend5 * 5.0, 1) if (pend2 or pend5) else None

    pts_per_82 = round((pts / gp) * 82, 1) if gp > 0 else 0.0

    records.append({
        'player_id':              player_id,
        'season':                 season,
        'team':                   team_abbr,
        'gp':                     gp,
        'g':                      g,
        'a':                      a,
        'pts':                    pts,
        'toi_total':              round(toi, 2) if toi is not None else None,
        'ixg':                    round(ixg, 3) if ixg is not None else None,
        'pts_per_82':             pts_per_82,
        'penalty_minutes_taken':  penalty_minutes_taken,
        'penalty_minutes_drawn':  penalty_minutes_drawn,
    })

match_rate = len(records) / max(1, len(df)) * 100
print(f"    {len(records):,} matched  |  {len(unmatched)} unmatched players  |  match rate {match_rate:.1f}%")

if unknown_teams:
    print(f"    Unknown team names (used 3-char fallback): {sorted(unknown_teams)}")

if unmatched:
    sample = sorted(unmatched)[:15]
    print(f"    Sample unmatched players (first 15): {sample}")

if match_rate < 75:
    print(f"\n  WARNING: match rate {match_rate:.1f}% is below the 75% target.")
    print("  Add missing names to name_to_id or check the CSV Player column format.")

# ── Step 4: Upsert in batches ─────────────────────────────────────────────────
print(f"\n[4] Upserting {len(records):,} rows to career_stats ...")
BATCH = 500
upserted = 0
errors = 0
for i in range(0, len(records), BATCH):
    chunk = records[i:i + BATCH]
    try:
        supabase.from_('career_stats').upsert(
            chunk, on_conflict='player_id,season,team'
        ).execute()
        upserted += len(chunk)
        print(f"    {upserted:,} / {len(records):,}", flush=True)
    except Exception as e:
        errors += len(chunk)
        print(f"    ERROR on batch {i}–{i+BATCH}: {e}")

print(f"\n✅  Upload complete: {upserted:,} rows upserted, {errors} errors.")

# ── Step 5: Spot-checks ───────────────────────────────────────────────────────
print("\n[5] Spot-checks ...")

checks = [
    ("Connor McDavid",  "EDM only, career-long"),
    ("Corey Perry",     "ANA → multiple teams"),
    ("Jake Guentzel",   "PIT → CAR → TOR"),
]
for full_name, note in checks:
    pid = name_to_id.get(normalize_name(full_name))
    if not pid:
        print(f"  {full_name}: not found in player lookup")
        continue
    res = supabase.from_('career_stats') \
        .select('season,team,gp,pts,pts_per_82') \
        .eq('player_id', pid) \
        .order('season') \
        .execute()
    rows = res.data or []
    teams = sorted({r['team'] for r in rows})
    print(f"  {full_name} ({note}): {len(rows)} seasons, teams={teams}")
    for r in rows[-4:]:  # last 4 seasons
        print(f"    {r['season']} {r['team']}: {r['gp']} GP  {r['pts']} Pts  {r['pts_per_82']} Pts/82")
