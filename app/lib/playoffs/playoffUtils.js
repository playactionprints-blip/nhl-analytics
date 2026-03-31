import { PLAYOFF_POINT_BIN_WIDTH } from "@/app/lib/playoffs/playoffConfig";

export function getTorontoDateString(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

export function parseDateString(dateString) {
  const [year, month, day] = String(dateString || "").split("-").map(Number);
  return { year, month, day };
}

export function shiftDateString(dateString, deltaDays) {
  const { year, month, day } = parseDateString(dateString);
  const utc = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
}

export function daysBetween(dateA, dateB) {
  const a = new Date(`${dateA}T00:00:00Z`).getTime();
  const b = new Date(`${dateB}T00:00:00Z`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

export function dateStringFromUtcInToronto(utcString) {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date(utcString));
  } catch {
    return null;
  }
}

export function formatPercent(probability, digits = 1) {
  if (probability == null || !Number.isFinite(probability)) return "—";
  return `${(probability * 100).toFixed(digits)}%`;
}

export function formatSignedPercent(delta, digits = 1) {
  if (delta == null || !Number.isFinite(delta)) return "—";
  const pct = delta * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)} pts`;
}

export function average(numbers) {
  if (!numbers?.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function buildPointDistribution(frequencyMap) {
  const totals = Object.entries(frequencyMap || {}).map(([points, count]) => ({
    points: Number(points),
    count: Number(count),
  }));
  if (!totals.length) return [];

  const simCount = totals.reduce((sum, item) => sum + item.count, 0);
  const minPoints = Math.min(...totals.map((item) => item.points));
  const maxPoints = Math.max(...totals.map((item) => item.points));
  const start = Math.floor(minPoints / PLAYOFF_POINT_BIN_WIDTH) * PLAYOFF_POINT_BIN_WIDTH;
  const end = Math.ceil((maxPoints + 1) / PLAYOFF_POINT_BIN_WIDTH) * PLAYOFF_POINT_BIN_WIDTH;

  const bins = [];
  for (let lower = start; lower < end; lower += PLAYOFF_POINT_BIN_WIDTH) {
    const upper = lower + PLAYOFF_POINT_BIN_WIDTH;
    const count = totals
      .filter((item) => item.points >= lower && item.points < upper)
      .reduce((sum, item) => sum + item.count, 0);
    bins.push({
      label: `${lower}-${upper - 1}`,
      start: lower,
      end: upper - 1,
      probability: simCount > 0 ? count / simCount : 0,
      count,
    });
  }
  return bins;
}

export function sortSelectedSeasons(seasons = []) {
  return [...seasons].sort((a, b) => a.localeCompare(b));
}

export function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
