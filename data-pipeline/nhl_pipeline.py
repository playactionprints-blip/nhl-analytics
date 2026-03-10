"""
NHL Analytics Data Pipeline
============================
Pulls player data from the free NHL API and merges with manually exported
advanced stats CSVs from Natural Stat Trick and Evolving-Hockey.

SETUP:
    pip install requests pandas supabase

USAGE:
    1. Run `python nhl_pipeline.py --fetch-roster`  to pull all active players
    2. Export CSVs from NST / Evolving-Hockey (see instructions below)
    3. Run `python nhl_pipeline.py --merge` to merge all sources
    4. Run `python nhl_pipeline.py --upload` to push to Supabase

HOW TO EXPORT CSVs:
    Natural Stat Trick (naturalstattrick.com):
        → Report: Individual → All Situations → Full Season
        → Click "Download CSV"  →  save as  nst_skaters.csv

    Evolving-Hockey (evolving-hockey.com):
        → WAR tab → Current Season → Download
        → save as  eh_war.csv
"""

import requests
import pandas as pd
import json
import os
import argparse
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
NHL_API_BASE = "https://api-web.nhle.com/v1"
DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

# Fill these in after creating a Supabase project at supabase.com
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

CURRENT_SEASON = "20252026"

# ── NHL API helpers ───────────────────────────────────────────────────────────

def get_all_teams() -> list[dict]:
    """Fetch all active NHL franchises."""
    url = f"{NHL_API_BASE}/standings/now"
    r = requests.get(url, timeout=10)
    r.raise_for_status()
    standings = r.json()["standings"]
    teams = [
        {
            "id": t["teamAbbrev"]["default"],
            "name": t["teamName"]["default"],
            "conference": t["conferenceName"],
            "division": t["divisionName"],
        }
        for t in standings
    ]
    print(f"✓ Fetched {len(teams)} teams")
    return teams


def get_team_roster(team_abbrev: str) -> list[dict]:
    """Fetch current season roster for a team."""
    url = f"{NHL_API_BASE}/roster/{team_abbrev}/{CURRENT_SEASON}"
    r = requests.get(url, timeout=10)
    r.raise_for_status()
    data = r.json()

    players = []
    for position_group in ["forwards", "defensemen", "goalies"]:
        for p in data.get(position_group, []):
            players.append({
                "player_id":    p["id"],
                "first_name":   p["firstName"]["default"],
                "last_name":    p["lastName"]["default"],
                "full_name":    f"{p['firstName']['default']} {p['lastName']['default']}",
                "position":     p["positionCode"],
                "team":         team_abbrev,
                "jersey":       p.get("sweaterNumber"),
                "headshot_url": p.get("headshot", ""),
            })
    return players


def get_player_stats(player_id: int) -> dict:
    """Fetch career + current season stats for a single player."""
    url = f"{NHL_API_BASE}/player/{player_id}/landing"
    r = requests.get(url, timeout=10)
    r.raise_for_status()
    data = r.json()

    # Pull current season regular-season stats
    current = {}
    for season_block in data.get("seasonTotals", []):
        if (
            season_block.get("season") == int(CURRENT_SEASON)
            and season_block.get("gameTypeId") == 2  # regular season
        ):
            current = season_block
            break

    return {
        "player_id":   player_id,
        "shoots":      data.get("shootsCatches"),
        "birth_date":  data.get("birthDate"),
        "birth_city":  data.get("birthCity", {}).get("default"),
        "nationality": data.get("birthCountry"),
        "height_cm":   data.get("heightInCentimeters"),
        "weight_kg":   data.get("weightInKilograms"),
        # Current season core stats
        "gp":   current.get("gamesPlayed", 0),
        "g":    current.get("goals", 0),
        "a":    current.get("assists", 0),
        "pts":  current.get("points", 0),
        "toi":  current.get("avgToi", "0:00"),
        "plus_minus": current.get("plusMinus", 0),
    }


def fetch_all_stats():
    """Fetch current-season stats for every player in Supabase and update the players table."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("✗ Set SUPABASE_URL and SUPABASE_KEY env vars first")
        return

    from supabase import create_client
    import time
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Fetch all player IDs
    all_players = sb.table("players").select("player_id,full_name").execute().data
    print(f"Fetching stats for {len(all_players)} players (season {CURRENT_SEASON})...")

    updated = skipped = errors = 0
    for i, p in enumerate(all_players):
        pid = p["player_id"]
        try:
            stats = get_player_stats(pid)
            data = {
                "gp":          stats["gp"],
                "g":           stats["g"],
                "a":           stats["a"],
                "pts":         stats["pts"],
                "toi":         stats["toi"],
                "plus_minus":  stats["plus_minus"],
                "shoots":      stats["shoots"],
                "birth_date":  stats["birth_date"],
                "nationality": stats["nationality"],
                "height_cm":   stats["height_cm"],
                "weight_kg":   stats["weight_kg"],
            }
            sb.table("players").update(data).eq("player_id", pid).execute()
            updated += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"  ✗ {p['full_name']} ({pid}): {e}")

        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(all_players)} processed...")
        time.sleep(0.05)  # gentle rate limit

    print(f"\n✓ Done. Updated: {updated} | Errors: {errors}")


def fetch_full_roster() -> pd.DataFrame:
    """Pull every active player from every team."""
    teams = get_all_teams()
    all_players = []

    for team in teams:
        try:
            roster = get_team_roster(team["id"])
            all_players.extend(roster)
            print(f"  {team['id']}: {len(roster)} players")
        except Exception as e:
            print(f"  ✗ {team['id']}: {e}")

    df = pd.DataFrame(all_players)
    out = DATA_DIR / "players_base.csv"
    df.to_csv(out, index=False)
    print(f"\n✓ Saved {len(df)} players → {out}")
    return df


# ── Advanced stats merging ────────────────────────────────────────────────────

def load_nst_csv(path: str = "data/nst_skaters.csv") -> pd.DataFrame:
    """
    Load Natural Stat Trick skater export.
    Expected columns (NST default export):
        Player, Team, Position, GP, TOI, CF%, xGF%, HDCF%, SCF%
    """
    df = pd.read_csv(path)
    df.columns = df.columns.str.strip().str.lower().str.replace(" ", "_")

    rename = {
        "player":   "full_name",
        "cf%":      "cf_pct",
        "xgf%":     "xgf_pct",
        "hdcf%":    "hdcf_pct",
        "scf%":     "scf_pct",
        "toi":      "nst_toi",
    }
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})

    # Normalize name for joining
    df["full_name"] = df["full_name"].str.strip()
    print(f"✓ Loaded NST: {len(df)} rows")
    return df[["full_name", "cf_pct", "xgf_pct", "hdcf_pct", "scf_pct"]].drop_duplicates("full_name")


def load_eh_war_csv(path: str = "data/eh_war.csv") -> pd.DataFrame:
    """
    Load Evolving-Hockey WAR export.
    Expected columns: Player, Season, WAR, WAR_off, WAR_def, RAPM_off, RAPM_def
    """
    df = pd.read_csv(path)
    df.columns = df.columns.str.strip().str.lower().str.replace(" ", "_").str.replace("-", "_")

    rename = {
        "player":    "full_name",
        "war":       "war",
        "war_off":   "war_off",
        "war_def":   "war_def",
        "rapm_off":  "rapm_off",
        "rapm_def":  "rapm_def",
    }
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns})
    df["full_name"] = df["full_name"].str.strip()
    print(f"✓ Loaded EH WAR: {len(df)} rows")
    return df[["full_name", "war", "war_off", "war_def", "rapm_off", "rapm_def"]].drop_duplicates("full_name")


def merge_all_sources(
    base_csv:  str = "data/players_base.csv",
    nst_csv:   str = "data/nst_skaters.csv",
    eh_csv:    str = "data/eh_war.csv",
) -> pd.DataFrame:
    """Merge NHL API base data with NST and EH advanced stats."""
    base = pd.read_csv(base_csv)

    if Path(nst_csv).exists():
        nst = load_nst_csv(nst_csv)
        base = base.merge(nst, on="full_name", how="left")
    else:
        print(f"⚠ NST file not found at {nst_csv} — skipping")

    if Path(eh_csv).exists():
        eh = load_eh_war_csv(eh_csv)
        base = base.merge(eh, on="full_name", how="left")
    else:
        print(f"⚠ EH WAR file not found at {eh_csv} — skipping")

    out = DATA_DIR / "players_merged.csv"
    base.to_csv(out, index=False)
    print(f"\n✓ Merged dataset: {len(base)} players → {out}")
    return base


# ── Supabase upload ───────────────────────────────────────────────────────────

def upload_to_supabase(csv_path: str = "data/players_merged.csv"):
    """Push merged player data to Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("✗ Set SUPABASE_URL and SUPABASE_KEY env vars first")
        return

    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    df = pd.read_csv(csv_path)
    # Replace NaN with None for JSON serialization
    records = df.where(pd.notnull(df), None).to_dict("records")

    # Upsert in batches of 500
    batch_size = 500
    for i in range(0, len(records), batch_size):
        batch = records[i : i + batch_size]
        sb.table("players").upsert(batch).execute()
        print(f"  Uploaded rows {i}–{i + len(batch)}")

    print(f"\n✓ Uploaded {len(records)} players to Supabase")


# ── Supabase schema (run once) ────────────────────────────────────────────────

SUPABASE_SQL = """
-- Run this once in your Supabase SQL editor

create table if not exists players (
    player_id     bigint primary key,
    full_name     text not null,
    first_name    text,
    last_name     text,
    position      text,
    team          text,
    jersey        int,
    headshot_url  text,
    shoots        text,
    birth_date    date,
    nationality   text,
    height_cm     int,
    weight_kg     int,

    -- NHL API stats
    gp            int,
    g             int,
    a             int,
    pts           int,
    toi           text,
    plus_minus    int,

    -- Natural Stat Trick
    cf_pct        float,
    xgf_pct       float,
    hdcf_pct      float,
    scf_pct       float,

    -- Evolving-Hockey
    war           float,
    war_off       float,
    war_def       float,
    rapm_off      float,
    rapm_def      float,

    updated_at    timestamptz default now()
);

-- Index for fast player search
create index if not exists players_name_idx on players using gin(to_tsvector('english', full_name));
create index if not exists players_team_idx on players(team);
create index if not exists players_position_idx on players(position);
"""


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NHL Analytics Pipeline")
    parser.add_argument("--fetch-roster", action="store_true", help="Pull all active players from NHL API")
    parser.add_argument("--fetch-stats",  action="store_true", help="Pull current-season stats for all players in Supabase")
    parser.add_argument("--merge",        action="store_true", help="Merge NHL data with NST + EH CSVs")
    parser.add_argument("--upload",       action="store_true", help="Upload merged data to Supabase")
    parser.add_argument("--schema",       action="store_true", help="Print Supabase SQL schema")
    parser.add_argument("--all",          action="store_true", help="Run full pipeline end-to-end")
    args = parser.parse_args()

    if args.schema:
        print(SUPABASE_SQL)
    elif args.fetch_stats:
        fetch_all_stats()
    elif args.fetch_roster or args.all:
        fetch_full_roster()
        if args.all:
            merge_all_sources()
            upload_to_supabase()
    elif args.merge:
        merge_all_sources()
    elif args.upload:
        upload_to_supabase()
    else:
        parser.print_help()
