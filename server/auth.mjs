// Email + password sign-in for InstantDB, which only has email codes built in.
//
// Passwords are hashed with scrypt and kept in a JSON file on a private
// volume (DATA_DIR) — never in InstantDB, which clients can read. When a
// password checks out we ask Instant's admin API for a refresh token for that
// email and the browser signs in with db.auth.signInWithToken(token).
//
// No dependencies; runs next to nginx in the app container (see Dockerfile).
// nginx proxies /contract-whist/api/* here.

import { createServer } from "node:http";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

const PORT = Number(process.env.AUTH_PORT ?? 3001);
const APP_ID = process.env.INSTANT_APP_ID ?? "33fdf866-9fcb-4721-a84d-ca1dba1f0ab0";
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN ?? "";
const INSTANT_API = process.env.INSTANT_API_URI ?? "https://api.instantdb.com";
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const STORE = join(DATA_DIR, "passwords.json");

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MIN_PASSWORD = 8;

// ── Storage ─────────────────────────────────────────────────────────────

/** @type {Record<string, { salt: string; hash: string; updatedAt: string }>} */
let creds = {};
let writing = Promise.resolve();

async function load() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    creds = JSON.parse(await readFile(STORE, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    creds = {};
  }
}

// Serialised, atomic writes (temp file + rename).
function save() {
  writing = writing.then(async () => {
    const tmp = STORE + ".tmp";
    await writeFile(tmp, JSON.stringify(creds), { mode: 0o600 });
    await rename(tmp, STORE);
  });
  return writing;
}

async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

async function checkPassword(password, entry) {
  const { hash } = await hashPassword(password, Buffer.from(entry.salt, "base64"));
  const a = Buffer.from(hash, "base64");
  const b = Buffer.from(entry.hash, "base64");
  return a.length === b.length && timingSafeEqual(a, b);
}

// A real-looking entry so unknown emails take as long as known ones.
const DUMMY = await hashPassword("not-a-real-password");

// ── Instant admin API ───────────────────────────────────────────────────

async function instant(path, init = {}) {
  const res = await fetch(`${INSTANT_API}${path}${path.includes("?") ? "&" : "?"}app_id=${APP_ID}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "app-id": APP_ID,
      authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

// Refresh token for this email (Instant creates the user if needed).
async function tokenFor(email) {
  const r = await instant("/admin/refresh_tokens", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (!r.ok || !r.body?.user?.refresh_token) {
    throw new HttpError(502, "Couldn't sign you in right now. Try again.");
  }
  return r.body.user.refresh_token;
}

async function instantUserExists(email) {
  const r = await instant(`/admin/users?email=${encodeURIComponent(email)}`);
  if (r.ok) return !!r.body?.user;
  if (r.status === 404 || r.status === 400) return false;
  throw new HttpError(502, "Couldn't reach the sign-in service. Try again.");
}

async function userForToken(refreshToken) {
  const res = await fetch(`${INSTANT_API}/runtime/auth/verify_refresh_token?app_id=${APP_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ "app-id": APP_ID, "refresh-token": refreshToken }),
  });
  if (!res.ok) return null;
  return (await res.json()).user ?? null;
}

// ── Rate limiting (in memory) ───────────────────────────────────────────

const hits = new Map();
function limited(key, max, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  h.count += 1;
  return h.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (h.reset < now) hits.delete(k);
}, 60 * 1000).unref();

// ── HTTP ────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const normEmail = (e) => String(e ?? "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
function validPassword(p) {
  if (typeof p !== "string" || p.length < MIN_PASSWORD) {
    throw new HttpError(400, `Use at least ${MIN_PASSWORD} characters.`, "weak_password");
  }
  if (p.length > 200) throw new HttpError(400, "That password is too long.");
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Bad request.");
  }
}

const routes = {
  "GET /health": async () => ({ ok: true, passwords: !!ADMIN_TOKEN }),

  "POST /password/signup": async (req, ip) => {
    const { email: raw, password } = await readJson(req);
    const email = normEmail(raw);
    if (!validEmail(email)) throw new HttpError(400, "Enter a valid email.");
    validPassword(password);
    if (limited(`signup:${ip}`, 10)) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    if (creds[email]) {
      throw new HttpError(409, "That email already has a password. Log in instead.", "has_password");
    }
    // Existing code-sign-in accounts must prove they own the email first
    // (sign in with a code, then set a password from the You page);
    // otherwise anyone could set a password on someone else's account.
    if (await instantUserExists(email)) {
      throw new HttpError(
        409,
        "That email already has an account. Sign in with an email code once, then set a password on the You page.",
        "has_account"
      );
    }
    creds[email] = { ...(await hashPassword(password)), updatedAt: new Date().toISOString() };
    await save();
    try {
      return { token: await tokenFor(email) };
    } catch (e) {
      delete creds[email];
      await save();
      throw e;
    }
  },

  "POST /password/login": async (req, ip) => {
    const { email: raw, password } = await readJson(req);
    const email = normEmail(raw);
    if (limited(`login:${ip}`, 30) || limited(`login:${email}`, 10)) {
      throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    }
    const entry = creds[email];
    const ok = await checkPassword(String(password ?? ""), entry ?? DUMMY);
    if (!entry || !ok) throw new HttpError(401, "Wrong email or password.", "bad_credentials");
    return { token: await tokenFor(email) };
  },

  // Set or change the password for the signed-in (email) account.
  "POST /password/set": async (req, ip) => {
    const auth = req.headers.authorization ?? "";
    const refreshToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (limited(`set:${ip}`, 10)) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
    const user = refreshToken ? await userForToken(refreshToken) : null;
    if (!user) throw new HttpError(401, "Please sign in again.");
    const email = normEmail(user.email);
    if (!email) throw new HttpError(400, "Add an email to your account first.", "no_email");
    const { password } = await readJson(req);
    validPassword(password);
    creds[email] = { ...(await hashPassword(password)), updatedAt: new Date().toISOString() };
    await save();
    return { ok: true };
  },
};

await load();

createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0].replace(/\/+$/, "") || "/";
  const handler = routes[`${req.method} ${path}`];
  // The host's nginx appends the real client IP last; earlier entries could
  // be spoofed by the client.
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",");
  const ip = forwarded[forwarded.length - 1].trim() || req.socket.remoteAddress || "";
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (!handler) return send(404, { error: "Not found." });
  if (path !== "/health" && !ADMIN_TOKEN) {
    return send(503, { error: "Password sign-in isn't set up yet.", code: "not_configured" });
  }
  try {
    send(200, await handler(req, ip));
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message, code: e.code });
    console.error(e);
    send(500, { error: "Something went wrong. Try again." });
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`auth listening on 127.0.0.1:${PORT} (passwords ${ADMIN_TOKEN ? "on" : "off"})`);
});
