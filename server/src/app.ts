import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createAuth } from "./auth";
import { createBackups } from "./backup";
import { NotEmptyError, importSnapshot, openDb } from "./db";
import { HttpError, clientIp, createLimiter, readJson, send } from "./http";
import { ImportFormatError, transformInstant } from "./importInstant";
import { createSync } from "./sync";

export type ServerOptions = {
  port: number;
  dataDir: string;
  publicUrl?: string;
  host?: string;
  adminBootstrapToken?: string; // POST /auth/claim-admin; the first admin only
  passkeyRpId?: string; // default: the host of publicUrl
  passkeyOrigins?: string[]; // default: the origin of publicUrl
  importToken?: string; // enables POST /admin/import (one-off migration)
  trustProxyHops?: number; // proxies in front (default 1); see README
  backupDays?: number; // copies of the database to keep (default 14, 0 = off)
  backupIntervalMs?: number; // tests
  now?: () => Date; // tests
  pingMs?: number; // SSE heartbeat interval (tests only)
  maxStreams?: number;
  maxStreamsPerIp?: number;
};

const DEFAULT_PUBLIC_URL = "https://joseffsmith.uk/contract-whist";
const PUSH_MAX_BYTES = 256 * 1024;
const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const STREAMED = Symbol("streamed");

type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  ip: string;
  id: string; // the last path segment of a ".../:id" route
};

const sameSecret = (a: string, b: string) =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest()
  );

export async function startServer(opts: ServerOptions) {
  const db = openDb(opts.dataDir);
  const limiter = createLimiter();
  const sync = createSync(db, limiter, opts);
  const publicUrl = opts.publicUrl || DEFAULT_PUBLIC_URL;
  // Passkeys default to this site's host and origin.
  let site: URL;
  try {
    site = new URL(publicUrl);
  } catch {
    throw new Error(
      "PUBLIC_URL must be a full URL, like https://example.com/contract-whist."
    );
  }
  const auth = createAuth(db, sync, limiter, {
    adminBootstrapToken: opts.adminBootstrapToken || undefined,
    publicUrl,
    passkey: {
      rpID: opts.passkeyRpId || site.hostname,
      origins: opts.passkeyOrigins?.length
        ? opts.passkeyOrigins
        : [site.origin],
    },
    now: opts.now,
  });

  const backups = createBackups(db, {
    dataDir: opts.dataDir,
    keep: opts.backupDays ?? 14,
    intervalMs: opts.backupIntervalMs,
    now: opts.now,
  });

  // One-off migration from InstantDB, into an empty database only.
  async function adminImport(c: Ctx) {
    const secret = opts.importToken;
    if (!secret) throw new HttpError(404, "Not found.", "not_found");
    if (limiter.limited(`import:${c.ip}`, 10)) {
      throw new HttpError(429, "Too many attempts.", "rate_limited");
    }
    const given = String(c.req.headers["x-import-token"] ?? "");
    if (!sameSecret(given, secret)) {
      throw new HttpError(403, "Wrong token.", "forbidden");
    }
    const body = await readJson(c.req, IMPORT_MAX_BYTES);
    try {
      const { snapshot, counts } = transformInstant(body);
      importSnapshot(db, snapshot);
      sync.broadcast(db.changesSince(0)); // streams already open get the data
      return counts;
    } catch (e) {
      if (e instanceof NotEmptyError) {
        throw new HttpError(409, "The database already has data.", "not_empty");
      }
      if (e instanceof ImportFormatError) {
        throw new HttpError(400, e.message, "bad_request");
      }
      throw e;
    }
  }

  const routes: Record<string, (c: Ctx) => unknown> = {
    "GET /health": () => ({ ok: true, version: db.version() }),

    "POST /auth/guest": (c) => auth.guest(c.req, c.ip),
    "POST /auth/signup": (c) => auth.signup(c.req, c.ip),
    "POST /auth/login": (c) => auth.login(c.req, c.ip),
    "POST /auth/logout": (c) => auth.logout(c.req),
    "GET /auth/me": (c) => auth.me(c.req),
    "DELETE /auth/me": (c) => auth.deleteAccount(c.req, c.ip),
    "POST /auth/password": (c) => auth.password(c.req, c.ip),
    "POST /auth/passkey/register/options": (c) =>
      auth.passkeyRegisterOptions(c.req, c.ip),
    "POST /auth/passkey/register/verify": (c) =>
      auth.passkeyRegisterVerify(c.req, c.ip),
    "POST /auth/passkey/login/options": (c) =>
      auth.passkeyLoginOptions(c.req, c.ip),
    "POST /auth/passkey/login/verify": (c) =>
      auth.passkeyLoginVerify(c.req, c.ip),
    "GET /auth/passkeys": (c) => auth.passkeys(c.req),
    "DELETE /auth/passkeys/:id": (c) => auth.deletePasskey(c.req, c.ip, c.id),
    "POST /auth/claim-admin": (c) => auth.claimAdmin(c.req, c.ip),
    "POST /auth/reset-link": (c) => auth.resetLink(c.req),
    "POST /auth/reset": (c) => auth.reset(c.req, c.ip),

    "GET /sync/pull": (c) => sync.pull(c.url, c.ip),
    "GET /sync/stream": (c) => {
      sync.stream(c.res, c.url, c.ip);
      return STREAMED;
    },
    "POST /sync/push": async (c) => {
      const user = auth.requireUser(c.req);
      const body = await readJson(c.req, PUSH_MAX_BYTES);
      return sync.push(
        {
          id: user.id,
          isGuest: !!user.is_guest,
          isAdmin: !!user.is_admin,
        },
        body
      );
    },

    "POST /admin/import": adminImport,
  };

  const server = createServer(async (req, res) => {
    try {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", "http://localhost");
      } catch {
        throw new HttpError(400, "Bad request.", "bad_request");
      }
      const path = url.pathname.replace(/\/+$/, "") || "/";
      let handler: ((c: Ctx) => unknown) | undefined =
        routes[`${req.method} ${path}`];
      let id = "";
      if (!handler) {
        // Routes with an id in the last segment: "/auth/passkeys/<id>".
        const m = /^(\/auth\/passkeys)\/([^/]+)$/.exec(path);
        handler = m ? routes[`${req.method} ${m[1]}/:id`] : undefined;
        try {
          id = m ? decodeURIComponent(m[2]) : "";
        } catch {
          handler = undefined;
        }
      }
      if (!handler) throw new HttpError(404, "Not found.", "not_found");
      const result = await handler({
        req,
        res,
        url,
        ip: clientIp(req, opts.trustProxyHops ?? 1),
        id,
      });
      if (result !== STREAMED) send(res, 200, result);
    } catch (e) {
      // Too late for a JSON error once an event stream has started.
      if (res.headersSent) return res.destroy();
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
  backups.start();

  let closing: Promise<void> | undefined;
  return {
    url: `http://${
      host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host
    }:${port}`,
    // Safe to call more than once.
    close(): Promise<void> {
      closing ??= (async () => {
        backups.stop();
        sync.close();
        limiter.stop();
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
        db.close();
      })();
      return closing;
    },
  };
}
