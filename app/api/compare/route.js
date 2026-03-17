/**
 * Cached multi-player comparison API route built from the shared player API
 * loader so compare payloads stay aligned with individual player responses.
 */
import { fetchPlayersPayload } from "@/app/lib/playerData";
import { jsonError, jsonWithCache } from "@/app/lib/apiCache";

export const revalidate = 300;

function normalizeIds(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const playerIds = normalizeIds(searchParams.get("players"));

    if (playerIds.length < 2 || playerIds.length > 4) {
      return jsonError("players must include between 2 and 4 player IDs", 400);
    }

    const players = await fetchPlayersPayload(playerIds);
    const playersById = Object.fromEntries(players.map((player) => [player.id, player]));
    const payload = playerIds
      .map((id) => playersById[id])
      .filter(Boolean)
      .map((player) => ({
      id: player.id,
      name: player.name,
      team: player.team,
      position: player.position,
      jersey: player.jersey,
      currentSeason: player.currentSeason,
      war: player.war,
      rapm: player.rapm,
      percentiles: player.percentiles,
      meta: player.meta,
      }));

    return jsonWithCache({ players: payload }, 300);
  } catch (error) {
    return jsonError(error.message || "Failed to compare players");
  }
}
