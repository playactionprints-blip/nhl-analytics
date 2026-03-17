/**
 * Cached team API route mirroring the current team-detail data contract and
 * appending last_updated freshness metadata from sync_log.
 */
import { fetchTeamPayload } from "@/app/lib/teamData";
import { jsonError, jsonWithCache } from "@/app/lib/apiCache";

export const revalidate = 300;

export async function GET(_request, { params }) {
  try {
    const { team } = await params;
    const payload = await fetchTeamPayload(team);
    if (!payload) {
      return jsonError("Team not found", 404);
    }
    return jsonWithCache(payload, 300);
  } catch (error) {
    return jsonError(error.message || "Failed to fetch team");
  }
}
