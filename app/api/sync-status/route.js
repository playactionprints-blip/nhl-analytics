/**
 * Exposes backend sync freshness status from the sync_log table.
 * Depends on Supabase sync_log rows written by the data pipeline.
 */
import { createServerClient } from "@/app/lib/supabase";
import { jsonError, jsonWithCache } from "@/app/lib/apiCache";
import { evaluateSyncStatus, getLatestSuccessfulSyncEntry, getLatestSyncEntry } from "@/app/lib/syncStatus";

export const revalidate = 60;

export async function GET() {
  try {
    const supabase = createServerClient();
    const [latestEntry, latestSuccess] = await Promise.all([
      getLatestSyncEntry(supabase),
      getLatestSuccessfulSyncEntry(supabase),
    ]);
    return jsonWithCache(evaluateSyncStatus(latestSuccess, latestEntry), 60);
  } catch (error) {
    return jsonError(error.message || "Failed to fetch sync status");
  }
}
