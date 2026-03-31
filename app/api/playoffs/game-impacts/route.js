import { jsonError } from "@/app/lib/apiCache";
import { getPlayoffGameImpactsPayload, playoffJson } from "@/app/lib/playoffs/playoffService";
import { getTorontoDateString } from "@/app/lib/playoffs/playoffUtils";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const asOf = searchParams.get("asOf") || getTorontoDateString();
    const date = searchParams.get("date") || asOf;
    const payload = await getPlayoffGameImpactsPayload(date, asOf);
    return playoffJson(payload);
  } catch (error) {
    return jsonError(error?.message || "Could not build playoff game implications", 500);
  }
}
