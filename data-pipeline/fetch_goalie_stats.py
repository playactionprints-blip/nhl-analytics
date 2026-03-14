#!/usr/bin/env python3
"""
Fetch current-season (25-26) goalie stats from NHL API and update Supabase.

Filters seasonTotals to:
  - season == 20252026
  - gameTypeId == 2  (regular season)
  - leagueAbbrev == "NHL"  (exclude Olympics, World Champs, etc.)

Fields updated: gp, toi, wins, losses, shutouts, gaa, save_pct, goals_against, shots_against
"""
import os, time, requests
from supabase import create_client

CURRENT_SEASON  = 20252026
SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_KEY"]
HEADERS         = {"User-Agent": "Mozilla/5.0"}

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Fetch all goalies from DB ─────────────────────────────────────────────────
goalies = sb.table("players").select("player_id,full_name").eq("position", "G").execute().data
print(f"Fetching 25-26 NHL stats for {len(goalies)} goalies...\n")

updated = skipped = errors = 0

for p in goalies:
    pid  = p["player_id"]
    name = p["full_name"]
    try:
        r    = requests.get(f"https://api-web.nhle.com/v1/player/{pid}/landing",
                            headers=HEADERS, timeout=15)
        r.raise_for_status()
        data = r.json()

        # Find current NHL regular-season block
        nhl_block = None
        for s in data.get("seasonTotals", []):
            if (s.get("season")       == CURRENT_SEASON
                    and s.get("gameTypeId") == 2
                    and s.get("leagueAbbrev") == "NHL"):
                nhl_block = s
                break       # seasonTotals is ordered oldest→newest; first NHL match is correct

        if nhl_block is None:
            print(f"  {name}: no 25-26 NHL stats found — skipping")
            skipped += 1
            continue

        gp            = nhl_block.get("gamesPlayed", 0)
        wins          = nhl_block.get("wins", 0)
        losses        = nhl_block.get("losses", 0)
        shutouts      = nhl_block.get("shutouts", 0)
        gaa           = nhl_block.get("goalsAgainstAvg")
        save_pct      = nhl_block.get("savePctg")
        goals_against = nhl_block.get("goalsAgainst")
        shots_against = nhl_block.get("shotsAgainst")
        toi_raw       = nhl_block.get("timeOnIce", "0:00")   # "MMMM:SS"

        # Convert "MMMM:SS" total TOI to "M:SS" avg-per-game
        avg_toi = None
        if toi_raw and gp > 0:
            parts   = str(toi_raw).split(":")
            total_s = int(parts[0]) * 60 + int(parts[1]) if len(parts) == 2 else 0
            avg_s   = total_s / gp
            avg_toi = f"{int(avg_s // 60)}:{int(avg_s % 60):02d}"

        row = {
            "gp":            gp,
            "wins":          wins,
            "losses":        losses,
            "shutouts":      shutouts,
            "goals_against": goals_against,
            "shots_against": shots_against,
        }
        if gaa      is not None: row["gaa"]      = round(gaa,      6)
        if save_pct is not None: row["save_pct"] = round(save_pct, 6)
        if avg_toi  is not None: row["toi"]      = avg_toi

        sb.table("players").update(row).eq("player_id", pid).execute()
        print(f"  {name}: {gp} GP  {wins}W-{losses}L  .{str(round(save_pct*1000)) if save_pct else '---'}  "
              f"{gaa:.3f} GAA  {shutouts} SO")
        updated += 1

    except Exception as e:
        errors += 1
        print(f"  ERROR {name} ({pid}): {e}")

    time.sleep(0.07)   # gentle rate limit

print(f"\nDone. Updated: {updated} | Skipped: {skipped} | Errors: {errors}")
