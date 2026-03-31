import { jsonError } from "@/app/lib/apiCache";
import { getTeamProjectionPayload, playoffJson } from "@/app/lib/playoffs/playoffService";
import { getTorontoDateString } from "@/app/lib/playoffs/playoffUtils";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const asOf = searchParams.get("asOf") || getTorontoDateString();
    const payload = await getTeamProjectionPayload(asOf);
    return playoffJson(payload);
  } catch (error) {
    return jsonError(error?.message || "Could not build team projections", 500);
  }
}
