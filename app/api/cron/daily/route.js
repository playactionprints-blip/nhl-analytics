import { NextResponse } from "next/server";
import {
  buildPredictionsForDate,
  updatePredictionResults,
  formatDateString,
  getTorontoDateParts,
  parseDateString,
  shiftDateParts,
} from "@/app/lib/predictionsData";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  const url = new URL(request.url);
  const manualDate = url.searchParams.get("date");
  const manualSecret = url.searchParams.get("secret");

  const isAuthorized =
    authHeader === `Bearer ${process.env.CRON_SECRET}` ||
    manualSecret === process.env.CRON_SECRET;

  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const todayParts = getTorontoDateParts();
  const todayString = formatDateString(todayParts);
  const yesterdayString = formatDateString(shiftDateParts(todayParts, -1));

  const targetDate = manualDate || todayString;
  const targetYesterday = manualDate
    ? formatDateString(shiftDateParts(parseDateString(manualDate), -1))
    : yesterdayString;

  const results = { today: null, yesterday: null, errors: [] };

  // 1. Log predictions + odds for target date
  try {
    const { predictions } = await buildPredictionsForDate(targetDate);
    results.today = `Logged ${predictions.length} predictions for ${targetDate}`;
  } catch (err) {
    results.errors.push(`Predictions (${targetDate}): ${err.message}`);
  }

  // 2. Write actual results for the day before target
  try {
    await updatePredictionResults(targetYesterday);
    results.yesterday = `Updated results for ${targetYesterday}`;
  } catch (err) {
    results.errors.push(`Results (${targetYesterday}): ${err.message}`);
  }

  return NextResponse.json({
    success: results.errors.length === 0,
    ...results,
    timestamp: new Date().toISOString(),
  });
}
