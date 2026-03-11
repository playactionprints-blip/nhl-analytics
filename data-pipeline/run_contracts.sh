#!/bin/bash
set -a
source /Users/cspeedie/Desktop/nhl-analytics/.env.local
set +a
export SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL"
export SUPABASE_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY"
cd /Users/cspeedie/Desktop/nhl-analytics/data-pipeline
PYTHONUNBUFFERED=1 /Users/cspeedie/Desktop/nhl-analytics/venv/bin/python3 fetch_contracts.py
