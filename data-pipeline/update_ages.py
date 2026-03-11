#!/usr/bin/env python3
"""
Compute and store age for all players from birth_date.
Run ONCE after adding the age column:
    alter table players add column if not exists age int;
    alter table players add column if not exists contract_info jsonb default '{}';
"""
import os
from datetime import date
from supabase import create_client

sb = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_KEY'])

print("Fetching players with birth_date...")
players = sb.table('players').select('player_id,full_name,birth_date').execute().data
print(f"  {len(players)} players fetched")

today = date.today()
updated = skipped = 0

for p in players:
    bd = p.get('birth_date')
    if not bd:
        skipped += 1
        continue
    try:
        birth = date.fromisoformat(str(bd))
        age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
        sb.table('players').update({'age': age}).eq('player_id', p['player_id']).execute()
        updated += 1
    except Exception as e:
        print(f"  Error for {p['full_name']}: {e}")
        skipped += 1

print(f"\nDone. Updated: {updated} | Skipped: {skipped}")
