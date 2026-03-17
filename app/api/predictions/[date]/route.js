/**
 * Cached date-scoped predictions API route used for backend consumers.
 * Depends on the existing predictions builder and surfaces the same
 * prediction payloads without changing frontend presentation.
 */
import { buildPredictionsForDate, isValidDateString } from "@/app/lib/predictionsData";
import { jsonError, jsonWithCache } from "@/app/lib/apiCache";

export const revalidate = 120;

export async function GET(_request, { params }) {
  try {
    const { date } = await params;
    if (!isValidDateString(date)) {
      return jsonError("date must be formatted as YYYY-MM-DD", 400);
    }
    const payload = await buildPredictionsForDate(date);
    return jsonWithCache(payload, 120);
  } catch (error) {
    return jsonError(error.message || "Failed to fetch predictions");
  }
}
