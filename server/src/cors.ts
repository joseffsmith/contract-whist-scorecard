import type { IncomingMessage, ServerResponse } from "node:http";

// CORS for the native apps (mobile/), whose pages are served from
// capacitor://localhost (iOS) and https://localhost (Android) and so call
// the API cross-origin. The website is same-origin and needs none of this.
// Auth is a Bearer token, not a cookie, so credentials mode isn't needed.
const APP_ORIGINS = ["capacitor://localhost", "https://localhost"];

const PREFLIGHT_MAX_AGE = 600;

// An origin is scheme://host[:port]: no path, no trailing slash.
const ORIGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s?#@]+$/i;

// `origins` (the CORS_ORIGINS variable: comma-separated) adds to the app
// origins. Returns a handler to run first on every request: it labels the
// response and answers a preflight itself (true = done). Throws on an entry
// that isn't a bare origin, so a typo stops the server at startup instead of
// quietly never matching.
export function createCors(origins?: string) {
  const listed = (origins ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  for (const origin of listed) {
    if (!ORIGIN.test(origin)) {
      throw new Error(
        `CORS_ORIGINS: "${origin}" is not an origin like https://example.com (no path, no trailing slash).`
      );
    }
  }
  const allowed = new Set([...APP_ORIGINS, ...listed]);

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
