/**
 * Server response cache helpers for app router API routes.
 * Depends on Next.js route handlers and is used to keep cache headers
 * consistent across JSON endpoints without changing route logic.
 */
import { NextResponse } from "next/server";

export function buildCacheHeaders(seconds) {
  return {
    "Cache-Control": `public, s-maxage=${seconds}, stale-while-revalidate=60`,
  };
}

export function jsonWithCache(payload, seconds, init = {}) {
  return NextResponse.json(payload, {
    ...init,
    headers: {
      ...buildCacheHeaders(seconds),
      ...(init.headers || {}),
    },
  });
}

export function jsonError(message, status = 500, headers = {}) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers,
    }
  );
}
