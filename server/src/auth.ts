// Accounts: guests, email + password, sessions, admin reset links.
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import type {
  Action,
  ActionName,
  AuthResponse,
  PublicUser,
} from "../../shared/types";
import type { Db } from "./db";
import { HttpError, bearerToken, readJson } from "./http";
import type { Limiter } from "./http";
import { newActionId } from "./sync";
import type { Sync } from "./sync";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: object
) => Promise<Buffer>;

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MIN_PASSWORD = 8;
const RESET_LINK_MS = 7 * 24 * 60 * 60 * 1000;
const TOO_MANY = "Too many attempts. Try again in a few minutes.";

type UserRow = {
  id: string;
  email: string | null;
  is_guest: number;
  password_salt: string | null;
  password_hash: string | null;
};
type Hashed = { salt: string; hash: string };

async function hashPassword(
  password: string,
  salt = randomBytes(16)
): Promise<Hashed> {
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

async function checkPassword(
  password: string,
  entry: Hashed
): Promise<boolean> {
  const { hash } = await hashPassword(
    password,
    Buffer.from(entry.salt, "base64")
  );
  const a = Buffer.from(hash, "base64");
  const b = Buffer.from(entry.hash, "base64");
  return a.length === b.length && timingSafeEqual(a, b);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const normEmail = (e: unknown) =>
  String(e ?? "")
    .trim()
    .toLowerCase();
const validEmail = (e: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;

function validPassword(p: unknown): string {
  if (typeof p !== "string" || p.length < MIN_PASSWORD) {
    throw new HttpError(
      400,
      `Use at least ${MIN_PASSWORD} characters.`,
      "weak_password"
    );
  }
  if (p.length > 200)
    throw new HttpError(400, "That password is too long.", "weak_password");
  return p;
}

const publicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  email: u.email,
  isGuest: !!u.is_guest,
});

export type AuthOptions = {
  adminEmails: string[];
  publicUrl: string;
};

export function createAuth(
  db: Db,
  sync: Sync,
  limiter: Limiter,
  opts: AuthOptions
) {
  // A real-looking hash so unknown emails take as long as known ones.
  const dummy = hashPassword("not-a-real-password");
  const tooMany = (key: string, max: number) => {
    if (limiter.limited(key, max))
      throw new HttpError(429, TOO_MANY, "rate_limited");
  };

  // ── Storage helpers ───────────────────────────────────────────────────

  const userById = (id: string) =>
    db.stmt("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  const userByEmail = (email: string) =>
    db.stmt("SELECT * FROM users WHERE email = ?").get(email) as
      | UserRow
      | undefined;

  function userForToken(token: string): UserRow | undefined {
    if (!token) return undefined;
    return db
      .stmt(
        "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ?"
      )
      .get(sha256(token)) as UserRow | undefined;
  }

  function createSession(userId: string): string {
    const token = newToken();
    db.stmt(
      "INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)"
    ).run(sha256(token), userId, new Date().toISOString());
    return token;
  }

  const respond = (user: UserRow, token: string): AuthResponse => ({
    token,
    user: publicUser(user),
  });

  function setPassword(userId: string, h: Hashed): void {
    db.stmt(
      "UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?"
    ).run(h.salt, h.hash, userId);
  }

  /** The signed-in user for this request, or undefined. */
  const sessionUser = (req: IncomingMessage) => userForToken(bearerToken(req));

  function requireUser(req: IncomingMessage): UserRow {
    const user = sessionUser(req);
    if (!user)
      throw new HttpError(401, "Please sign in again.", "not_signed_in");
    return user;
  }

  // One-time link (7 days) for setting a password.
  function createResetLink(userId: string): string {
    const token = newToken();
    db.stmt(
      "INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
    ).run(sha256(token), userId, Date.now() + RESET_LINK_MS);
    return `${opts.publicUrl.replace(/\/+$/, "")}/reset/${token}`;
  }

  // ── Guest → account handoff ───────────────────────────────────────────

  // The guest's claimed player moves to the account: transferred if the
  // account has none, otherwise merged into the account's player. Goes through
  // the normal action pipeline. Never throws.
  async function handoff(guestToken: string, account: UserRow): Promise<void> {
    try {
      const guest = userForToken(guestToken);
      if (!guest || !guest.is_guest || guest.id === account.id) return;
      const guestActor = { id: guest.id, isGuest: true };
      const accountActor = { id: account.id, isGuest: false };
      const claimed = (userId: string) =>
        db
          .readState()
          .where("players", "claimedBy", userId)
          .filter((p) => !p.mergedInto);

      for (const theirs of claimed(guest.id)) {
        const mine = claimed(account.id)[0];
        const action = (name: ActionName, args: object) =>
          ({ id: newActionId(), name, args } as Action);
        const result = mine
          ? sync.apply(newActionId(), [
              {
                action: action("mergePlayers", {
                  fromId: theirs.id,
                  intoId: mine.id,
                }),
                actor: accountActor,
                internal: { allowClaimedFrom: guest.id },
              },
            ])
          : sync.apply(newActionId(), [
              {
                action: action("unclaimPlayer", { playerId: theirs.id }),
                actor: guestActor,
              },
              {
                action: action("claimPlayer", { playerId: theirs.id }),
                actor: accountActor,
              },
            ]);
        if (!result.ok) console.error("Guest handoff failed:", result.error);
      }
    } catch (e) {
      console.error("Guest handoff failed:", e);
    }
  }

  // ── Routes ────────────────────────────────────────────────────────────

  return {
    sessionUser,
    requireUser,
    publicUser,

    async guest(_req: IncomingMessage, ip: string) {
      tooMany(`guest:${ip}`, 30);
      const id = randomUUID();
      db.stmt(
        "INSERT INTO users (id, is_guest, created_at) VALUES (?, 1, ?)"
      ).run(id, new Date().toISOString());
      return respond(userById(id)!, createSession(id));
    },

    async signup(req: IncomingMessage, ip: string) {
      const body = await readJson(req);
      const email = normEmail(body.email);
      if (!validEmail(email))
        throw new HttpError(400, "Enter a valid email.", "invalid_email");
      const password = validPassword(body.password);
      tooMany(`signup:${ip}`, 10);
      const hasAccount = () =>
        new HttpError(
          409,
          "That email already has an account. Log in instead.",
          "has_account"
        );
      if (userByEmail(email)) throw hasAccount();

      const hashed = await hashPassword(password);
      // A guest session is upgraded in place, keeping its user id (and so
      // the players it claimed).
      const current = sessionUser(req);
      try {
        if (current?.is_guest) {
          db.stmt("UPDATE users SET email = ?, is_guest = 0 WHERE id = ?").run(
            email,
            current.id
          );
          setPassword(current.id, hashed);
          return respond(userById(current.id)!, bearerToken(req));
        }
        const id = randomUUID();
        db.stmt(
          "INSERT INTO users (id, email, is_guest, password_salt, password_hash, created_at) VALUES (?, ?, 0, ?, ?, ?)"
        ).run(id, email, hashed.salt, hashed.hash, new Date().toISOString());
        return respond(userById(id)!, createSession(id));
      } catch (e) {
        // Lost a race with another signup for the same email.
        if (String(e).includes("UNIQUE")) throw hasAccount();
        throw e;
      }
    },

    async login(req: IncomingMessage, ip: string) {
      const body = await readJson(req);
      const email = normEmail(body.email);
      tooMany(`login:${ip}`, 30);
      tooMany(`login:${email}`, 10);
      const user = userByEmail(email);
      const stored =
        user?.password_salt && user.password_hash
          ? { salt: user.password_salt, hash: user.password_hash }
          : null;
      const ok = await checkPassword(
        String(body.password ?? ""),
        stored ?? (await dummy)
      );
      if (!user || !stored || !ok)
        throw new HttpError(401, "Wrong email or password.", "bad_credentials");
      const token = createSession(user.id);
      if (typeof body.guestToken === "string")
        await handoff(body.guestToken, user);
      return respond(user, token);
    },

    async logout(req: IncomingMessage) {
      const token = bearerToken(req);
      if (token)
        db.stmt("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
      return { ok: true };
    },

    async me(req: IncomingMessage) {
      return { user: publicUser(requireUser(req)) };
    },

    // Set or change the password of the signed-in (non-guest) account.
    async password(req: IncomingMessage, ip: string) {
      const user = requireUser(req);
      tooMany(`set:${ip}`, 10);
      if (user.is_guest) {
        throw new HttpError(403, "Create an account first.", "guest");
      }
      const password = validPassword((await readJson(req)).password);
      setPassword(user.id, await hashPassword(password));
      return { ok: true };
    },

    // Admin: one-time link (7 days) for setting a password.
    async resetLink(req: IncomingMessage) {
      const admin = requireUser(req);
      if (!admin.email || !opts.adminEmails.includes(admin.email)) {
        throw new HttpError(
          403,
          "Only the app admin can do that.",
          "forbidden"
        );
      }
      const target = userByEmail(normEmail((await readJson(req)).email));
      if (!target)
        throw new HttpError(404, "No account with that email.", "not_found");
      return { url: createResetLink(target.id) };
    },

    async reset(req: IncomingMessage, ip: string) {
      const body = await readJson(req);
      tooMany(`reset:${ip}`, 10);
      const password = validPassword(body.password);
      const find = () =>
        db
          .stmt(
            "SELECT user_id FROM reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?"
          )
          .get(sha256(String(body.token ?? "")), Date.now()) as
          | { user_id: string }
          | undefined;
      const invalid = () =>
        new HttpError(
          400,
          "That link has expired or was already used.",
          "invalid_token"
        );
      if (!find()) throw invalid();

      const hashed = await hashPassword(password);
      // Re-check: the token may have been used while we were hashing.
      const found = find();
      if (!found) throw invalid();
      db.stmt("UPDATE reset_tokens SET used_at = ? WHERE token_hash = ?").run(
        new Date().toISOString(),
        sha256(String(body.token))
      );
      setPassword(found.user_id, hashed);
      return respond(userById(found.user_id)!, createSession(found.user_id));
    },
  };
}
export type Auth = ReturnType<typeof createAuth>;
