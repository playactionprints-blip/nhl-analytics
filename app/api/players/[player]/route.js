/**
 * Cached player API route that returns the same core player payload used by
 * comparison and OG metadata, including sync freshness metadata.
 */
import { fetchPlayerPayload } from "@/app/lib/playerData";
import { jsonError, jsonWithCache } from "@/app/lib/apiCache";

export const revalidate = 300;

export async function GET(_request, { params }) {
  try {
    const { player } = await params;
    const payload = await fetchPlayerPayload(player);
    if (!payload) {
      return jsonError("Player not found", 404);
    }
    return jsonWithCache(payload, 300);
  } catch (error) {
    return jsonError(error.message || "Failed to fetch player");
  }
}
