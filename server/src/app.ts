import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import type { AddressInfo } from "node:net";
import { appleKeys } from "./apple";
import type { AppleKeys } from "./apple";
import { createAuth } from "./auth";
import { createBackups } from "./backup";
import { createCors } from "./cors";
import { NotEmptyError, importSnapshot, openDb } from "./db";
import { HttpError, clientIp, createLimiter, readJson, send } from "./http";
import { ImportFormatError, transformInstant } from "./importInstant";
import { createSync } from "./sync";

export type ServerOptions = {
  port: number;
  dataDir: string;
  publicUrl?: string;
  corsOrigins?: string; // comma-separated, on top of the native apps (cors.ts)
  host?: string;
  adminBootstrapToken?: string; // POST /auth/claim-admin; the first admin only
  passkeyRpId?: string; // default: the host of publicUrl
  passkeyOrigins?: string[]; // default: the origin of publicUrl
  // The native apps. Their ids go in the files that let them open links and
  // use this site's passkeys (/.well-known/...), and an Android app's signing
  // certificates also become passkey origins.
  appleTeamId?: string; // e.g. 45TRYSJM4M; no team, no apple-app-site-association
  appleBundleId?: string; // default uk.joseffsmith.whist
  appleServicesIds?: string[]; // Sign in with Apple on the web (later)
  appleKeys?: AppleKeys; // tests; default: fetched from Apple
  androidPackage?: string; // default uk.joseffsmith.whist
  androidCertSha256?: string[]; // "AB:CD:..." fingerprints; none, no assetlinks.json
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
const DEFAULT_APP_ID = "uk.joseffsmith.whist";
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

// The RP ID must be a bare host name that every origin's host is, or is a
// subdomain of; otherwise browsers refuse every passkey.
function checkPasskeyConfig({
  rpID,
  origins,
}: {
  rpID: string;
  origins: string[];
}) {
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(rpID) || isIP(rpID)) {
    throw new Error(
      `PASSKEY_RP_ID must be a bare host name like example.com, not an address (got "${rpID}").`
    );
  }
  for (const origin of origins) {
    const host = new URL(origin).hostname;
    if (host !== rpID && !host.endsWith(`.${rpID}`)) {
      throw new Error(
        `PASSKEY_ORIGINS has ${origin}, whose host isn't ${rpID} or one of its subdomains, so its passkeys would never work.`
      );
    }
  }
}

// "AB:CD:..." (as keytool and Play Console print it), 32 bytes.
function certFingerprint(given: string): string {
  const hex = given.trim().toUpperCase();
  if (!/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(hex)) {
    throw new Error(
      `ANDROID_CERT_SHA256 must list SHA-256 fingerprints like AB:CD:... (got "${given}").`
    );
  }
  return hex;
}

const notFound = () => {
  throw new HttpError(404, "Not found.", "not_found");
};

// What lets the apps open this site's links and use its passkeys. Links to
// games, joining, stats and the leaderboard open the app; the rest (password
// resets, admin, guest games that live in the browser) stay on the web.
function wellKnownFiles({
  appleAppId,
  androidPackage,
  androidCerts,
  basePath,
}: {
  appleAppId?: string;
  androidPackage: string;
  androidCerts: string[];
  basePath: string; // "/contract-whist"
}) {
  const aasa = appleAppId && {
    applinks: {
      details: [
        {
          appIDs: [appleAppId],
          components: [
            { "/": `${basePath}/games/guest/*`, exclude: true },
            ...["join/*", "games/*", "stats/*", "leaderboard", "players"].map(
              (p) => ({ "/": `${basePath}/${p}` })
            ),
          ],
        },
      ],
    },
    webcredentials: { apps: [appleAppId] },
  };
  const assetlinks = androidCerts.length
    ? [
        {
          relation: [
            "delegate_permission/common.handle_all_urls",
            "delegate_permission/common.get_login_creds",
          ],
          target: {
            namespace: "android_app",
            package_name: androidPackage,
            sha256_cert_fingerprints: androidCerts,
          },
        },
      ]
    : undefined;
  return { aasa: aasa || undefined, assetlinks };
}

export async function startServer(opts: ServerOptions) {
  const cors = createCors(opts.corsOrigins); // throws on a bad entry
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
  const passkey = {
    rpID: (opts.passkeyRpId || site.hostname).toLowerCase(),
    origins: opts.passkeyOrigins?.length ? opts.passkeyOrigins : [site.origin],
  };
  checkPasskeyConfig(passkey);
  // The iOS app's passkeys report the site's origin, so need nothing more.
  // Android's report the app's signing certificate instead.
  const androidCerts = (opts.androidCertSha256 ?? []).map(certFingerprint);
  passkey.origins = [
    ...passkey.origins,
    ...androidCerts.map(
      (hex) =>
        `android:apk-key-hash:${Buffer.from(hex.replace(/:/g, ""), "hex").toString("base64url")}`
    ),
  ];
  const bundleId = opts.appleBundleId || DEFAULT_APP_ID;
  const auth = createAuth(db, sync, limiter, {
    adminBootstrapToken: opts.adminBootstrapToken || undefined,
    publicUrl,
    passkey,
    apple: {
      audiences: [bundleId, ...(opts.appleServicesIds ?? [])],
      keys: opts.appleKeys ?? appleKeys(),
    },
    now: opts.now,
  });
  const wellKnown = wellKnownFiles({
    appleAppId: opts.appleTeamId && `${opts.appleTeamId}.${bundleId}`,
    androidPackage: opts.androidPackage || DEFAULT_APP_ID,
    androidCerts,
    basePath: site.pathname.replace(/\/+$/, ""),
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

    // Served at the site's root by the host's web server (see README).
    "GET /.well-known/apple-app-site-association": () =>
      wellKnown.aasa ?? notFound(),
    "GET /.well-known/assetlinks.json": () => wellKnown.assetlinks ?? notFound(),

    "POST /auth/guest": (c) => auth.guest(c.req, c.ip),
    "POST /auth/signup": (c) => auth.signup(c.req, c.ip),
    "POST /auth/login": (c) => auth.login(c.req, c.ip),
    "POST /auth/logout": (c) => auth.logout(c.req),
    "GET /auth/me": (c) => auth.me(c.req),
    "DELETE /auth/me": (c) => auth.deleteAccount(c.req, c.ip),
    "POST /auth/password": (c) => auth.password(c.req, c.ip),
    "POST /auth/email": (c) => auth.addEmail(c.req, c.ip),
    "POST /auth/sessions/revoke-others": (c) => auth.revokeOthers(c.req, c.ip),
    "POST /auth/apple/options": (c) => auth.appleOptions(c.req, c.ip),
    "POST /auth/apple/verify": (c) => auth.appleVerify(c.req, c.ip),
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
      auth.requireUser(c.req); // before reading a big body
      const body = await readJson(c.req, PUSH_MAX_BYTES);
      // The session may have ended while the body arrived.
      const user = auth.requireUser(c.req);
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
      if (cors(req, res)) return;
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
