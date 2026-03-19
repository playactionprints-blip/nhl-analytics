#!/usr/bin/env python3
"""run_migration.py — Verify predictions_log table and run a test insert/read/delete.

The anon key cannot run DDL (CREATE TABLE).  If the table is missing, this
script prints the SQL to paste into the Supabase SQL editor, then exits.
If the table exists it runs a round-trip smoke-test and reports success.

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
exec(open('run_migration.py').read())
"
"""

import os
import sys

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
    pass  # env already set by caller

if 'SUPABASE_KEY' not in os.environ:
    os.environ['SUPABASE_KEY'] = os.environ.get('SUPABASE_ANON_KEY', '')

from supabase import create_client  # noqa: E402

url = os.environ['SUPABASE_URL']
key = os.environ['SUPABASE_KEY']
supabase = create_client(url, key)

SQL_FILE = os.path.join(os.path.dirname(os.path.abspath(globals().get('__file__', 'run_migration.py'))), 'migrations', 'add_predictions_log.sql')
TEST_GAME_ID = '__migration_smoke_test__'

print("=" * 60)
print("NHL Analytics — predictions_log migration checker")
print("=" * 60)

# ── Step 1: Does the table exist? ─────────────────────────────────────────────
print("\n[1] Checking if predictions_log table exists...")
table_exists = False
try:
    res = supabase.from_('predictions_log').select('id').limit(1).execute()
    print(f"  ✓ Table exists  ({len(res.data)} row(s) visible)")
    table_exists = True
except Exception as e:
    err = str(e)
    if 'does not exist' in err or '42P01' in err or 'PGRST' in err:
        print("  ✗ Table does NOT exist yet.")
    else:
        print(f"  ! Unexpected error: {e}")

# ── Step 2: If missing, print the migration SQL ───────────────────────────────
if not table_exists:
    print("\n[2] Run the following SQL in the Supabase SQL editor:")
    print("-" * 60)
    try:
        with open(SQL_FILE) as f:
            print(f.read())
    except FileNotFoundError:
        print(f"  ERROR: {SQL_FILE} not found")
    print("-" * 60)
    print("\nAfter running the SQL above, re-run this script to verify.")
    sys.exit(1)

# ── Step 3: Round-trip smoke test ─────────────────────────────────────────────
print("\n[2] Running insert → read → delete smoke test...")
try:
    # Clean up any stale test row from a previous failed run
    supabase.from_('predictions_log').delete().eq('game_id', TEST_GAME_ID).execute()

    # Insert
    supabase.from_('predictions_log').insert({
        'game_date': '2000-01-01',
        'game_id':   TEST_GAME_ID,
        'home_team': 'TST',
        'away_team': 'TST',
        'home_win_prob': 0.55,
        'away_win_prob': 0.45,
        'predicted_winner': 'TST',
        'model_confidence': 'low',
    }).execute()
    print("  ✓ Insert succeeded")

    # Read back
    res = supabase.from_('predictions_log').select('*').eq('game_id', TEST_GAME_ID).execute()
    if res.data:
        row = res.data[0]
        print(f"  ✓ Read back: game_date={row['game_date']}  home={row['home_team']}  prob={row['home_win_prob']}")
    else:
        print("  ✗ Insert reported success but read returned nothing!")
        sys.exit(1)

    # Delete
    supabase.from_('predictions_log').delete().eq('game_id', TEST_GAME_ID).execute()
    print("  ✓ Cleanup delete succeeded")

except Exception as e:
    print(f"  ✗ Smoke test failed: {e}")
    sys.exit(1)

print("\n✅  predictions_log table is working correctly!")
print("   The write logic is in app/lib/predictionsData.js:")
print("     upsertPredictionsLog()         — called every time buildPredictionsForDate() runs")
print("     updatePredictionResultsForDate() — fills actual_winner/correct for past dates")
