import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createAuth } from "./auth";
import { openDb } from "./db";
import { HttpError, clientIp, createLimiter, readJson, send } from "./http";
import { createSync } from "./sync";

export type ServerOptions = {
  port: number;
  dataDir: string;
  adminEmails?: string[];
  publicUrl?: string;
  host?: string;
  pingMs?: number; // SSE heartbeat interval (tests only)
};

const DEFAULT_PUBLIC_URL = "https://whist.joseffsmith.uk/contract-whist";
const PUSH_MAX_BYTES = 256 * 1024;
const STREAMED = Symbol("streamed");

type Ctx = { req: IncomingMessage; res: ServerResponse; url: URL; ip: string };

export async function startServer(opts: ServerOptions) {
  const db = openDb(opts.dataDir);
  const limiter = createLimiter();
  const sync = createSync(db, opts.pingMs);
  const auth = createAuth(db, sync, limiter, {
    adminEmails: (opts.adminEmails ?? [])
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    publicUrl: opts.publicUrl || DEFAULT_PUBLIC_URL,
  });

  const routes: Record<string, (c: Ctx) => unknown> = {
    "GET /health": () => ({ ok: true, version: db.version() }),

    "POST /auth/guest": (c) => auth.guest(c.req, c.ip),
    "POST /auth/signup": (c) => auth.signup(c.req, c.ip),
    "POST /auth/login": (c) => auth.login(c.req, c.ip),
    "POST /auth/logout": (c) => auth.logout(c.req),
    "GET /auth/me": (c) => auth.me(c.req),
    "POST /auth/password": (c) => auth.password(c.req, c.ip),
    "POST /auth/reset-link": (c) => auth.resetLink(c.req),
    "POST /auth/reset": (c) => auth.reset(c.req, c.ip),

    "GET /sync/pull": (c) => sync.pull(c.url),
    "GET /sync/stream": (c) => {
      sync.stream(c.req, c.res, c.url);
      return STREAMED;
    },
    "POST /sync/push": async (c) => {
      const user = auth.requireUser(c.req);
      const body = await readJson(c.req, PUSH_MAX_BYTES);
      return sync.push({ id: user.id, isGuest: !!user.is_guest }, body);
    },
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      const handler = routes[`${req.method} ${path}`];
      if (!handler) throw new HttpError(404, "Not found.", "not_found");
      const result = await handler({ req, res, url, ip: clientIp(req) });
      if (result !== STREAMED) send(res, 200, result);
    } catch (e) {
      if (e instanceof HttpError)
        return send(res, e.status, { error: e.message, code: e.code });
      console.error(e);
      send(res, 500, {
        error: "Something went wrong. Try again.",
        code: "server_error",
      });
    }
  });

  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${
      host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host
    }:${port}`,
    async close(): Promise<void> {
      sync.close();
      limiter.stop();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      db.close();
    },
  };
}
