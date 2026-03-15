#!/usr/bin/env python3
import os
from pathlib import Path

from supabase import create_client


ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.local"
SEASONS = ["25-26", "24-25", "23-24"]


def load_env_file(path):
    if not path.exists():
        return
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def main():
    load_env_file(ENV_FILE)
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise SystemExit("Missing Supabase env vars. Load .env.local first.")

    sb = create_client(url, key)

    season_rows = []
    for season in SEASONS:
        rows = (
            sb.table("player_seasons")
            .select("player_id,season,toi_5v5,toi_pp,toi_pk,xgf_pp,xga_pk,rapm_off,rapm_def,war_total")
            .eq("season", season)
            .execute()
            .data
        )
        season_rows.extend(rows)

    players = (
        sb.table("players")
        .select("player_id,full_name,position,gp,war_total,rapm_off,percentiles,gsax,expected_goals_against")
        .execute()
        .data
    )

    print("=" * 60)
    print("DATA QUALITY REPORT")
    print("=" * 60)

    print("\nplayer_seasons coverage:")
    for season in SEASONS:
        rows = [r for r in season_rows if r["season"] == season]
        missing_splits = [
            r for r in rows
            if r.get("rapm_off") is not None and r.get("toi_5v5") is None
        ]
        missing_war = [
            r for r in rows
            if r.get("rapm_off") is not None and r.get("war_total") is None
        ]
        print(
            f"  {season}: rows={len(rows):>4} | "
            f"missing_5v5_splits={len(missing_splits):>3} | "
            f"missing_war={len(missing_war):>3}"
        )

    skaters = [p for p in players if p.get("position") != "G"]
    goalies = [p for p in players if p.get("position") == "G"]
    missing_percentiles = [
        p for p in skaters
        if p.get("war_total") is not None and not p.get("percentiles")
    ]
    missing_rapm = [
        p for p in skaters
        if (p.get("gp") or 0) >= 10 and p.get("rapm_off") is None
    ]
    missing_gsax = [
        p for p in goalies
        if (p.get("gp") or 0) >= 5 and p.get("expected_goals_against") is not None and p.get("gsax") is None
    ]

    print("\nplayers coverage:")
    print(f"  skaters with WAR but no percentiles: {len(missing_percentiles)}")
    print(f"  skaters with GP >= 10 but no RAPM:   {len(missing_rapm)}")
    print(f"  goalies with xGA but no GSAx:        {len(missing_gsax)}")

    if missing_percentiles:
        print("  Sample missing percentiles:")
        for row in missing_percentiles[:5]:
            print(f"    - {row['full_name']} ({row['player_id']})")
    if missing_gsax:
        print("  Sample missing GSAx:")
        for row in missing_gsax[:5]:
            print(f"    - {row['full_name']} ({row['player_id']})")

    print("\nlocal files:")
    for rel in [
        "data-pipeline/data/stints_2526.csv",
        "data-pipeline/data/stints_2425.csv",
        "data-pipeline/data/stints_2324.csv",
        "data-pipeline/data/shots_all_seasons.csv",
    ]:
        path = ROOT / rel
        if path.exists():
            size_mb = path.stat().st_size / (1024 * 1024)
            print(f"  {rel}: present ({size_mb:.1f} MB)")
        else:
            print(f"  {rel}: missing")


if __name__ == "__main__":
    main()
