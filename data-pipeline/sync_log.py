"""
Lightweight sync-log writer for data-pipeline scripts.

Depends on Supabase connection environment variables and writes a single
sync_log row on process exit so app routes can detect stale/error states
without custom logging in every script.
"""
import atexit
import os
import sys
import traceback
from datetime import datetime, timezone

from supabase import create_client


def _get_supabase_credentials():
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("SUPABASE_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    return url, key


def install_sync_logger(sync_type: str):
    state = {"status": "ok", "error_msg": None}
    previous_hook = sys.excepthook

    def excepthook(exc_type, exc_value, exc_traceback):
        state["status"] = "error"
        state["error_msg"] = "".join(
            traceback.format_exception_only(exc_type, exc_value)
        ).strip()[:1000]
        previous_hook(exc_type, exc_value, exc_traceback)

    def finalize():
        url, key = _get_supabase_credentials()
        if not url or not key:
            return

        try:
            sb = create_client(url, key)
            sb.table("sync_log").insert({
                "sync_type": sync_type,
                "synced_at": datetime.now(timezone.utc).isoformat(),
                "status": state["status"],
                "error_msg": state["error_msg"],
            }).execute()
        except Exception as exc:
            print(f"Sync log write skipped: {exc}")

    sys.excepthook = excepthook
    atexit.register(finalize)
