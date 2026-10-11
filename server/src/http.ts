import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    // We stop reading oversized bodies, so don't reuse the connection.
    ...(status === 413 ? { connection: "close" } : {}),
  });
  res.end(JSON.stringify(body));
}

export async function readJson(
  req: IncomingMessage,
  maxBytes = 16 * 1024
): Promise<Record<string, unknown>> {
  const tooBig = () => new HttpError(413, "Request too large.", "too_large");
  if (Number(req.headers["content-length"] ?? 0) > maxBytes) throw tooBig();
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw tooBig();
    chunks.push(chunk);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Bad request.", "bad_request");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Bad request.", "bad_request");
  }
  return body as Record<string, unknown>;
}

// The host's nginx appends the real client IP last; earlier entries could be
// spoofed by the client.
export function clientIp(req: IncomingMessage): string {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",");
  return (
    forwarded[forwarded.length - 1].trim() || req.socket.remoteAddress || ""
  );
}

export function bearerToken(req: IncomingMessage): string {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// In-memory fixed-window rate limiter.
export function createLimiter() {
  const hits = new Map<string, { count: number; reset: number }>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, h] of hits) if (h.reset < now) hits.delete(key);
  }, 60 * 1000);
  sweep.unref();

  return {
    // True once `key` has been used more than `max` times in the window.
    limited(key: string, max: number, windowMs = 15 * 60 * 1000): boolean {
      const now = Date.now();
      const h = hits.get(key);
      if (!h || h.reset < now) {
        hits.set(key, { count: 1, reset: now + windowMs });
        return false;
      }
      h.count += 1;
      return h.count > max;
    },
    stop: () => clearInterval(sweep),
  };
}
export type Limiter = ReturnType<typeof createLimiter>;
