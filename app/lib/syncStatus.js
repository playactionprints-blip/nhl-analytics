/**
 * Sync freshness helpers backed by the Supabase sync_log table.
 * Depends on the existing Supabase client and is shared by API routes
 * that expose freshness metadata and last-updated timestamps.
 */
const STALE_WINDOW_HOURS = 4;

const DATA_TYPE_SYNC_TYPES = {
  players: [
    "players",
    "ratings",
    "rapm",
    "percentiles",
    "goalies",
    "splits",
    "trends",
    "contracts",
  ],
  teams: [
    "players",
    "ratings",
    "rapm",
    "percentiles",
    "goalies",
    "splits",
    "trends",
  ],
  predictions: [
    "players",
    "ratings",
    "rapm",
    "percentiles",
    "goalies",
    "splits",
  ],
  lottery: ["lottery"],
};

function safeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getSyncTypesForDataType(dataType) {
  return DATA_TYPE_SYNC_TYPES[dataType] || [];
}

async function fetchLatestRowForQuery(query) {
  const { data, error } = await query.order("synced_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

export async function getLatestSyncEntry(supabase) {
  return fetchLatestRowForQuery(
    supabase.from("sync_log").select("id,sync_type,synced_at,status,error_msg")
  );
}

export async function getLatestSuccessfulSyncEntry(supabase, syncTypes = []) {
  let query = supabase
    .from("sync_log")
    .select("id,sync_type,synced_at,status,error_msg")
    .eq("status", "ok");

  if (syncTypes.length) {
    query = query.in("sync_type", syncTypes);
  }

  return fetchLatestRowForQuery(query);
}

export async function getLastUpdatedForDataType(supabase, dataType) {
  const syncTypes = getSyncTypesForDataType(dataType);
  const latestSuccess = await getLatestSuccessfulSyncEntry(supabase, syncTypes);
  return latestSuccess?.synced_at || null;
}

export function evaluateSyncStatus(latestSuccess, latestEntry) {
  const now = Date.now();
  const latestSuccessDate = safeDate(latestSuccess?.synced_at);
  const latestEntryDate = safeDate(latestEntry?.synced_at);

  if (!latestSuccessDate) {
    return {
      lastSynced: latestEntryDate?.toISOString() || null,
      status: latestEntry?.status === "error" ? "error" : "stale",
    };
  }

  if (latestEntry?.status === "error" && latestEntryDate && latestEntryDate >= latestSuccessDate) {
    return {
      lastSynced: latestSuccessDate.toISOString(),
      status: "error",
    };
  }

  const ageMs = now - latestSuccessDate.getTime();
  const staleThresholdMs = STALE_WINDOW_HOURS * 60 * 60 * 1000;

  return {
    lastSynced: latestSuccessDate.toISOString(),
    status: ageMs > staleThresholdMs ? "stale" : "ok",
  };
}
