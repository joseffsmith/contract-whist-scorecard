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
import type { Step, Sync } from "./sync";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
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
  is_admin: number;
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
  ...(u.is_admin ? { isAdmin: true } : {}),
});

export type AuthOptions = {
  adminBootstrapToken?: string; // lets the first admin claim the role
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

  function deleteSessions(userId: string, exceptToken = ""): void {
    db.stmt("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(
      userId,
      exceptToken ? sha256(exceptToken) : ""
    );
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
    return `${opts.publicUrl.replace(/\/+$/, "")}/reset#${token}`;
  }

  const action = (name: ActionName, args: object) =>
    ({ id: newActionId(), name, args } as Action);

  // A guest leaving: their players become claimable again.
  function releaseClaims(guestId: string): void {
    const actor = { id: guestId, isGuest: true };
    const steps = db
      .readState()
      .where("players", "claimedBy", guestId)
      .map((p) => ({
        action: action("unclaimPlayer", { playerId: p.id }),
        actor,
      }));
    if (steps.length) sync.apply(newActionId(), steps);
  }

  // ── Guest → account handoff ───────────────────────────────────────────

  // The guest's claimed player moves to the account: transferred if the
  // account has none, otherwise merged into the account's player. Goes through
  // the normal action pipeline. Only one player is handed over (the one with
  // the most seats); any others the guest claimed are released. A guest player
  // that can't move is released too, so it stays claimable. Never throws.
  async function handoff(guestToken: string, account: UserRow): Promise<void> {
    try {
      const guest = userForToken(guestToken);
      if (!guest || !guest.is_guest || guest.id === account.id) return;
      const guestActor = { id: guest.id, isGuest: true };
      const accountActor = {
        id: account.id,
        isGuest: false,
        isAdmin: !!account.is_admin,
      };
      const state = db.readState();
      // Most seats first, then smallest id.
      const claimed = (userId: string) =>
        state
          .where("players", "claimedBy", userId)
          .filter((p) => !p.mergedInto)
          .map((p) => ({
            p,
            seats: state.where("seats", "playerId", p.id).length,
          }))
          .sort((a, b) => b.seats - a.seats || (a.p.id < b.p.id ? -1 : 1))
          .map(({ p }) => p);
      const release = (playerId: string) =>
        sync.apply(newActionId(), [
          { action: action("unclaimPlayer", { playerId }), actor: guestActor },
        ]);

      // Games the guest hosted become the account's, so it can keep editing
      // them. Part of the same version as the player move.
      const moveGames: Step = {
        rows: (st) =>
          st.where("games", "createdBy", guest.id).map((game) => ({
            op: "put",
            table: "games",
            row: { ...game, createdBy: account.id },
          })),
      };

      const [theirs, ...others] = claimed(guest.id);
      const mine = claimed(account.id)[0];
      const move: Step[] = !theirs
        ? []
        : mine
        ? [
            {
              action: action("mergePlayers", {
                fromId: theirs.id,
                intoId: mine.id,
              }),
              actor: accountActor,
              internal: { allowClaimedFrom: guest.id },
            },
          ]
        : [
            {
              action: action("unclaimPlayer", { playerId: theirs.id }),
              actor: guestActor,
            },
            {
              action: action("claimPlayer", { playerId: theirs.id }),
              actor: accountActor,
            },
          ];
      let result = sync.apply(newActionId(), [...move, moveGames]);
      if (!result.ok && theirs) {
        // The player can't move: release it so it can be claimed again.
        console.error("Guest handoff rejected:", result.error);
        result = sync.apply(newActionId(), [
          {
            action: action("unclaimPlayer", { playerId: theirs.id }),
            actor: guestActor,
          },
          moveGames,
        ]);
      }
      if (!result.ok) console.error("Guest handoff failed:", result.error);
      for (const p of others) release(p.id);
    } catch (e) {
      console.error("Guest handoff failed:", e);
    } finally {
      // The phone now uses the account's session.
      const guest = userForToken(guestToken);
      if (guest?.is_guest && guest.id !== account.id) {
        deleteSessions(guest.id);
      }
    }
  }

  // ── Routes ────────────────────────────────────────────────────────────

  return {
    sessionUser,
    requireUser,
    publicUser,

    // A guest with a server-made id, or with the id the client made for its
    // provisional guest while offline (a lowercase v4 uuid nobody uses yet).
    async guest(req: IncomingMessage, ip: string) {
      tooMany(`guest:${ip}`, 30);
      const body = await readJson(req);
      let id: string = randomUUID();
      if (body.id !== undefined) {
        if (typeof body.id !== "string" || !UUID_V4.test(body.id)) {
          throw new HttpError(400, "Bad request.", "invalid_id");
        }
        id = body.id;
      }
      const taken = () =>
        new HttpError(409, "That id is already in use.", "id_taken");
      if (userById(id)) throw taken();
      try {
        db.stmt(
          "INSERT INTO users (id, is_guest, created_at) VALUES (?, 1, ?)"
        ).run(id, new Date().toISOString());
      } catch (e) {
        if (userById(id)) throw taken(); // lost a race for the same id
        throw e;
      }
      return respond(userById(id)!, createSession(id));
    },

    async signup(req: IncomingMessage, ip: string) {
      const body = await readJson(req);
      const email = normEmail(body.email);
      if (!validEmail(email))
        throw new HttpError(400, "Enter a valid email.", "invalid_email");
      const password = validPassword(body.password);
      tooMany(`signup:${ip}`, 30);
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
          const upgraded = db
            .stmt(
              "UPDATE users SET email = ?, is_guest = 0, password_salt = ?, password_hash = ? WHERE id = ? AND is_guest = 1"
            )
            .run(email, hashed.salt, hashed.hash, current.id);
          if (!upgraded.changes) throw hasAccount();
          // Same user, new session: the guest token is retired.
          deleteSessions(current.id);
          return respond(userById(current.id)!, createSession(current.id));
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
      tooMany(`login:${email.slice(0, 254)}`, 10);
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
      if (!token) return { ok: true };
      const user = userForToken(token);
      if (user?.is_guest) {
        try {
          releaseClaims(user.id);
        } catch (e) {
          console.error("Releasing a guest's players failed:", e);
        }
      }
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
      deleteSessions(user.id, bearerToken(req)); // sign out everywhere else
      return { ok: true };
    },

    // The first admin proves they run the server by knowing the bootstrap
    // token. Works once: after that, admins are only made by hand in the DB.
    async claimAdmin(req: IncomingMessage, ip: string) {
      const user = requireUser(req);
      tooMany(`claim-admin:${ip}`, 10);
      const secret = opts.adminBootstrapToken;
      if (!secret) throw new HttpError(404, "Not found.", "not_found");
      if (user.is_guest) {
        throw new HttpError(403, "Create an account first.", "guest");
      }
      const given = String((await readJson(req)).token ?? "");
      const matches = timingSafeEqual(
        createHash("sha256").update(given).digest(),
        createHash("sha256").update(secret).digest()
      );
      const taken = db.stmt("SELECT 1 FROM users WHERE is_admin = 1").get();
      if (taken) {
        throw new HttpError(403, "An admin already exists.", "admin_exists");
      }
      if (!matches) throw new HttpError(403, "Wrong token.", "forbidden");
      db.stmt("UPDATE users SET is_admin = 1 WHERE id = ?").run(user.id);
      return { ok: true };
    },

    // Admin: one-time link (7 days) for setting a password.
    async resetLink(req: IncomingMessage) {
      const admin = requireUser(req);
      if (!admin.is_admin) {
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
      // Retire every link and session: whoever had access before is out.
      db.stmt(
        "UPDATE reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL"
      ).run(new Date().toISOString(), found.user_id);
      deleteSessions(found.user_id);
      setPassword(found.user_id, hashed);
      return respond(userById(found.user_id)!, createSession(found.user_id));
    },
  };
}
export type Auth = ReturnType<typeof createAuth>;
