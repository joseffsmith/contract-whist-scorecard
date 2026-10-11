import type { IncomingMessage, ServerResponse } from "node:http";

// CORS for the native apps (mobile/), whose pages are served from
// capacitor://localhost (iOS) and https://localhost (Android) and so call
// the API cross-origin. The website is same-origin and needs none of this.
// Auth is a Bearer token, not a cookie, so credentials mode isn't needed.
const APP_ORIGINS = ["capacitor://localhost", "https://localhost"];

const PREFLIGHT_MAX_AGE = 600;

// `origins` (the CORS_ORIGINS variable: comma-separated) replaces the app
// origins when set. Returns a handler to run first on every request: it
// labels the response and answers a preflight itself (true = done).
export function createCors(origins?: string) {
  const listed = (origins ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const allowed = new Set(listed.length ? listed : APP_ORIGINS);

  return (req: IncomingMessage, res: ServerResponse): boolean => {
    // The answer depends on who asks, so caches must not share it.
    res.setHeader("vary", "Origin");
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) return false;
    res.setHeader("access-control-allow-origin", origin);

    if (
      req.method !== "OPTIONS" ||
      !req.headers["access-control-request-method"]
    ) {
      return false;
    }
    res.writeHead(204, {
      "access-control-allow-methods": "GET, POST, DELETE",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-max-age": String(PREFLIGHT_MAX_AGE),
      "cache-control": "no-store",
    });
    res.end();
    return true;
  };
}
