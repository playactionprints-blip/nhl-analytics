/**
 * Central site URL helper for canonical metadata and OG image URLs.
 * Depends only on environment variables so pages and API routes can
 * generate stable absolute URLs without duplicating fallback logic.
 */
export function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "https://nhl-analytics-hazel.vercel.app"
  ).replace(/\/+$/, "");
}
