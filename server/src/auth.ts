// Accounts: guests, email + password, passkeys, Sign in with Apple, sessions,
// admin reset links.
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type {
  Action,
  ActionName,
  AuthResponse,
  PublicUser,
} from "../../shared/types";
import { verifyAppleToken } from "./apple";
import type { AppleKeys } from "./apple";
import { createChallenges } from "./challenges";
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
const RP_NAME = "Whist";
const MAX_PASSKEYS = 20; // per account

type UserRow = {
  id: string;
  email: string | null;
  is_guest: number;
  is_admin: number;
  password_salt: string | null;
  password_hash: string | null;
  guest_secret_hash: string | null;
  webauthn_user_id: string | null;
  deleted_at: string | null;
};
type PasskeyRow = {
  id: string; // credential id, base64url
  user_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string | null; // JSON array
  device_type: string | null;
  backed_up: number | null;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
};
type IdentityRow = {
  provider: string;
  subject: string;
  user_id: string;
  email: string | null;
  created_at: string;
  last_used_at: string | null;
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

const GUESTS_PER_WINDOW = 120; // per IP per 15 minutes
const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
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

// A password only signs anyone in together with an email.
const canUsePassword = (u: UserRow) => !!(u.email && u.password_hash);

export type AuthOptions = {
  adminBootstrapToken?: string; // lets the first admin claim the role
  publicUrl: string;
  // What the browser must say it signed for: the RP ID is the site's domain,
  // origins are the pages (scheme + host + port) allowed to ask.
  passkey: { rpID: string; origins: string[] };
  // Sign in with Apple: the client ids (bundle id, Services ID) its tokens may
  // be made for, and Apple's signing keys.
  apple: { audiences: string[]; keys: AppleKeys };
  now?: () => Date; // tests
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
  // Signs the passkey challenges. Made once and kept, so tokens survive a restart.
  db.stmt(
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('challenge_secret', ?)"
  ).run(randomBytes(32).toString("hex"));
  const challenges = createChallenges(
    Buffer.from(
      (
        db
          .stmt("SELECT value FROM settings WHERE key = 'challenge_secret'")
          .get() as { value: string }
      ).value,
      "hex"
    ),
    opts.now,
    {
      add(signature, expires, now) {
        db.stmt("DELETE FROM used_challenges WHERE expires <= ?").run(now);
        return (
          db
            .stmt(
              "INSERT OR IGNORE INTO used_challenges (sig, expires) VALUES (?, ?)"
            )
            .run(signature, expires).changes === 1
        );
      },
    }
  );

  // ── Storage helpers ───────────────────────────────────────────────────

  // Includes deleted accounts (tombstones): their ids stay reserved.
  const userById = (id: string) =>
    db.stmt("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  // Deleted accounts don't exist as far as signing in goes.
  const liveUserById = (id: string) => {
    const user = userById(id);
    return user?.deleted_at ? undefined : user;
  };
  // Anything that refers to this user id, even without a users row.
  const idInUse = (id: string) =>
    !!(
      userById(id) ||
      db.stmt('SELECT 1 FROM games WHERE "createdBy" = ?').get(id) ||
      db.stmt('SELECT 1 FROM players WHERE "claimedBy" = ?').get(id) ||
      db.stmt("SELECT 1 FROM applied_actions WHERE user_id = ?").get(id)
    );
  const idTaken = () =>
    new HttpError(409, "That id is already in use.", "id_taken");
  const userByEmail = (email: string) =>
    db
      .stmt("SELECT * FROM users WHERE email = ? AND deleted_at IS NULL")
      .get(email) as UserRow | undefined;
  const passkeyById = (id: string) =>
    db.stmt("SELECT * FROM passkeys WHERE id = ?").get(id) as
      | PasskeyRow
      | undefined;
  const passkeysOf = (userId: string) =>
    db
      .stmt("SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at, id")
      .all(userId) as PasskeyRow[];
  const passkeyCount = (userId: string) =>
    (
      db
        .stmt("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?")
        .get(userId) as { n: number }
    ).n;

  const appleIdentity = (subject: string) =>
    db
      .stmt(
        "SELECT * FROM identities WHERE provider = 'apple' AND subject = ?"
      )
      .get(subject) as IdentityRow | undefined;
  const hasApple = (userId: string) =>
    !!db
      .stmt(
        "SELECT 1 FROM identities WHERE provider = 'apple' AND user_id = ?"
      )
      .get(userId);

  const publicUser = (u: UserRow): PublicUser => ({
    id: u.id,
    email: u.email,
    isGuest: !!u.is_guest,
    ...(u.is_admin ? { isAdmin: true } : {}),
    hasPassword: canUsePassword(u),
    passkeyCount: passkeyCount(u.id),
    ...(hasApple(u.id) ? { hasApple: true } : {}),
  });

  function userForToken(token: string): UserRow | undefined {
    if (!token) return undefined;
    return db
      .stmt(
        "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND users.deleted_at IS NULL"
      )
      .get(sha256(token)) as UserRow | undefined;
  }

  // What a session was made by signing in with, so removing it ends the
  // session: a passkey's id, or an identity ("apple:<subject>").
  type MadeWith = { passkeyId?: string; identity?: string };

  function createSession(userId: string, made: MadeWith = {}): string {
    const token = newToken();
    db.stmt(
      "INSERT INTO sessions (token_hash, user_id, created_at, passkey_id, identity) VALUES (?, ?, ?, ?, ?)"
    ).run(
      sha256(token),
      userId,
      new Date().toISOString(),
      made.passkeyId ?? null,
      made.identity ?? null
    );
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

  // A guest leaving, or an account being deleted: their players become
  // claimable again. Throws if that can't be done.
  function releaseClaims(user: UserRow): void {
    const actor = { id: user.id, isGuest: !!user.is_guest };
    const steps = db
      .readState()
      .where("players", "claimedBy", user.id)
      .map((p) => ({
        action: action("unclaimPlayer", { playerId: p.id }),
        actor,
      }));
    if (!steps.length) return;
    const result = sync.apply(newActionId(), steps);
    if (!result.ok) throw new Error(result.error);
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

  // A new session for a user who has just proved who they are. A guest token
  // sent along hands that guest's player and games over to the user.
  async function startSession(
    user: UserRow,
    guestToken: unknown,
    made: MadeWith = {}
  ): Promise<AuthResponse> {
    const token = createSession(user.id, made);
    if (typeof guestToken === "string") await handoff(guestToken, user);
    return respond(user, token);
  }

  // ── Passkeys ──────────────────────────────────────────────────────────

  const challengeGone = () =>
    new HttpError(400, "That took too long. Try again.", "challenge_expired");
  const passkeyFailed = (status: number) =>
    new HttpError(status, "Couldn't verify that passkey.", "passkey_failed");
  const unknownPasskey = () =>
    new HttpError(401, "That passkey isn't recognised.", "unknown_passkey");
  const tooManyPasskeys = () =>
    new HttpError(
      400,
      `You can have up to ${MAX_PASSKEYS} passkeys. Remove one first.`,
      "too_many_passkeys"
    );
  const exists = () =>
    new HttpError(409, "That passkey is already registered.", "passkey_exists");

  const asObject = (v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : undefined;
  const parseTransports = (json: string | null): string[] | undefined => {
    try {
      const list = JSON.parse(json ?? "null");
      return Array.isArray(list) ? list.map(String) : undefined;
    } catch {
      return undefined;
    }
  };

  // The random handle authenticators know this user by, made when first needed.
  function webauthnHandle(user: UserRow): Buffer {
    let handle = user.webauthn_user_id;
    if (!handle) {
      db.stmt(
        "UPDATE users SET webauthn_user_id = ? WHERE id = ? AND webauthn_user_id IS NULL"
      ).run(newToken(), user.id);
      handle = userById(user.id)!.webauthn_user_id!;
    }
    return Buffer.from(handle, "base64url");
  }

  // What the passkey is labelled with in the phone's list.
  function passkeyLabel(user: UserRow): string {
    if (user.email) return user.email;
    const player = db
      .readState()
      .where("players", "claimedBy", user.id)
      .filter((p) => !p.mergedInto)
      .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
    return player?.name || "Whist player";
  }

  // ── Routes ────────────────────────────────────────────────────────────

  return {
    sessionUser,
    requireUser,
    publicUser,

    // A guest with a server-made id, or with the id the client made for its
    // provisional guest while offline (a lowercase v4 uuid). The client sends
    // a random `secret` with it; repeating the request with the same id and
    // secret (a lost reply, a second tab) gets a new session for the same
    // guest. An id that anything already refers to is taken.
    async guest(req: IncomingMessage, ip: string) {
      tooMany(`guest:${ip}`, GUESTS_PER_WINDOW);
      const body = await readJson(req);
      let id: string = randomUUID();
      let secretHash: string | null = null;
      if (body.id !== undefined) {
        if (typeof body.id !== "string" || !UUID_V4.test(body.id)) {
          throw new HttpError(400, "Bad request.", "invalid_id");
        }
        id = body.id;
        if (typeof body.secret === "string" && body.secret.length >= 16) {
          secretHash = sha256(body.secret.slice(0, 200));
        }
        const existing = userById(id);
        if (
          existing?.is_guest &&
          !existing.deleted_at &&
          secretHash &&
          existing.guest_secret_hash &&
          sameHash(existing.guest_secret_hash, secretHash)
        ) {
          return respond(existing, createSession(id));
        }
        if (existing || idInUse(id)) throw idTaken();
      }
      try {
        db.stmt(
          "INSERT INTO users (id, is_guest, guest_secret_hash, created_at) VALUES (?, 1, ?, ?)"
        ).run(id, secretHash, new Date().toISOString());
      } catch (e) {
        if (userById(id)) throw idTaken(); // lost a race for the same id
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
      return startSession(user, body.guestToken);
    },

    async logout(req: IncomingMessage) {
      const token = bearerToken(req);
      if (!token) return { ok: true };
      const user = userForToken(token);
      if (user?.is_guest) {
        try {
          releaseClaims(user);
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
      if (!user.email) {
        throw new HttpError(400, "Add an email first.", "no_email");
      }
      const password = validPassword((await readJson(req)).password);
      setPassword(user.id, await hashPassword(password));
      deleteSessions(user.id, bearerToken(req)); // sign out everywhere else
      return { ok: true };
    },

    // A passkey-only account adds an email and password as a backup way in.
    async addEmail(req: IncomingMessage, ip: string) {
      const user = requireUser(req);
      tooMany(`email:${ip}`, 30);
      if (user.is_guest) {
        throw new HttpError(403, "Create an account first.", "guest");
      }
      if (user.email) {
        throw new HttpError(409, "You already have an email.", "has_email");
      }
      const body = await readJson(req);
      const email = normEmail(body.email);
      if (!validEmail(email))
        throw new HttpError(400, "Enter a valid email.", "invalid_email");
      const password = validPassword(body.password);
      const hasAccount = () =>
        new HttpError(
          409,
          "That email already has an account. Log in instead.",
          "has_account"
        );
      if (userByEmail(email)) throw hasAccount();
      const hashed = await hashPassword(password);
      // Signed out (or revoked) while hashing.
      if (sessionUser(req)?.id !== user.id) {
        throw new HttpError(401, "Please sign in again.", "not_signed_in");
      }
      try {
        const set = db
          .stmt(
            "UPDATE users SET email = ?, password_salt = ?, password_hash = ? WHERE id = ? AND email IS NULL AND deleted_at IS NULL"
          )
          .run(email, hashed.salt, hashed.hash, user.id);
        if (!set.changes)
          throw new HttpError(401, "Please sign in again.", "not_signed_in");
      } catch (e) {
        // Lost a race with another signup for the same email.
        if (String(e).includes("UNIQUE")) throw hasAccount();
        throw e;
      }
      return respond(userById(user.id)!, bearerToken(req));
    },

    // Signs out every other device, keeping this one.
    async revokeOthers(req: IncomingMessage, ip: string) {
      const user = requireUser(req);
      tooMany(`revoke:${ip}`, 10);
      deleteSessions(user.id, bearerToken(req));
      return { ok: true };
    },

    // ── Passkeys ──

    // Options for making a passkey. Signed in (account or guest): for that
    // user, who then gets it added or, for a guest, is upgraded. Not signed
    // in: for a brand-new account (its id and the authenticator's user handle
    // are made now, and signed into the challenge). Discoverable, so signing
    // in later needs no username.
    async passkeyRegisterOptions(req: IncomingMessage, ip: string) {
      // A session that is sent but no longer exists is an error, not "none".
      const user = bearerToken(req) ? requireUser(req) : undefined;
      tooMany(`passkey-options:${ip}`, 300);
      const existing = user ? passkeysOf(user.id) : [];
      if (existing.length >= MAX_PASSKEYS) throw tooManyPasskeys();
      const name = user ? passkeyLabel(user) : "Whist player";
      const newAccount = user
        ? undefined
        : { id: randomUUID(), handle: newToken() };
      const minted = challenges.mint("register", user?.id ?? null, newAccount);
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: opts.passkey.rpID,
        userName: name,
        userDisplayName: name,
        userID: user
          ? webauthnHandle(user)
          : Buffer.from(newAccount!.handle, "base64url"),
        challenge: Buffer.from(minted.challenge, "base64url"),
        excludeCredentials: existing.map((p) => ({
          id: p.id,
          transports: parseTransports(p.transports),
        })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      });
      return { challengeId: minted.token, options };
    },

    // Checks the new passkey and keeps it. A guest becomes a real account
    // (same user id, so the same players), as when signing up by email. With
    // no session it makes a new account and signs it in.
    async passkeyRegisterVerify(req: IncomingMessage, ip: string) {
      const user = bearerToken(req) ? requireUser(req) : undefined;
      tooMany(`passkey-register:${ip}`, 30);
      const body = await readJson(req);
      const challenge = challenges.take(
        body.challengeId,
        "register",
        user?.id ?? null
      );
      // A token made for a session can't make an account, or the reverse.
      if (!challenge || !!challenge.newAccount === !!user)
        throw challengeGone();
      const response = asObject(body.response);
      if (!response) throw new HttpError(400, "Bad request.", "bad_request");
      let verified;
      try {
        verified = await verifyRegistrationResponse({
          response: response as unknown as RegistrationResponseJSON,
          expectedChallenge: challenge.challenge,
          expectedOrigin: opts.passkey.origins,
          expectedRPID: opts.passkey.rpID,
          requireUserVerification: true,
        });
      } catch {
        throw passkeyFailed(400);
      }
      if (!verified.verified) throw passkeyFailed(400);
      const { credential, credentialDeviceType, credentialBackedUp } =
        verified.registrationInfo;
      const name =
        typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
      const keep = (userId: string) =>
        db
          .stmt(
            "INSERT INTO passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
          )
          .run(
            credential.id,
            userId,
            credential.publicKey,
            credential.counter,
            credential.transports
              ? JSON.stringify(credential.transports)
              : null,
            credentialDeviceType,
            credentialBackedUp ? 1 : 0,
            name || null,
            new Date().toISOString()
          );

      const { newAccount } = challenge;
      if (newAccount) {
        const created = db.transaction(() => {
          if (passkeyById(credential.id)) throw exists();
          db.stmt(
            "INSERT INTO users (id, is_guest, webauthn_user_id, created_at) VALUES (?, 0, ?, ?)"
          ).run(newAccount.id, newAccount.handle, new Date().toISOString());
          keep(newAccount.id);
          return createSession(newAccount.id, { passkeyId: credential.id });
        });
        return respond(userById(newAccount.id)!, created);
      }

      const token = db.transaction(() => {
        // Signed out, or deleted, while the browser was asking for the passkey.
        const current = liveUserById(user!.id);
        if (!current) {
          throw new HttpError(401, "Please sign in again.", "not_signed_in");
        }
        // The session this request came with may have ended meanwhile (a sign
        // out, a password change, another tab upgrading this guest).
        const session = db
          .stmt("SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = ?")
          .get(sha256(bearerToken(req)), current.id);
        if (!session) {
          throw new HttpError(401, "Please sign in again.", "not_signed_in");
        }
        if (passkeyById(credential.id)) throw exists();
        if (passkeyCount(current.id) >= MAX_PASSKEYS) throw tooManyPasskeys();
        keep(current.id);
        // Upgraded by another request while this one was waiting: this session
        // was a guest's, so give the account a new one.
        if (!current.is_guest) {
          return user!.is_guest
            ? createSession(current.id, { passkeyId: credential.id })
            : bearerToken(req);
        }
        db.stmt(
          "UPDATE users SET is_guest = 0 WHERE id = ? AND is_guest = 1"
        ).run(current.id);
        // Same user, new session: the guest token is retired.
        deleteSessions(current.id);
        return createSession(current.id, { passkeyId: credential.id });
      });
      return respond(userById(user!.id)!, token);
    },

    // Options for signing in with any passkey the device offers.
    async passkeyLoginOptions(_req: IncomingMessage, ip: string) {
      tooMany(`passkey-options:${ip}`, 300);
      const minted = challenges.mint("login", null);
      const options = await generateAuthenticationOptions({
        rpID: opts.passkey.rpID,
        userVerification: "required",
        challenge: Buffer.from(minted.challenge, "base64url"),
      });
      return { challengeId: minted.token, options };
    },

    async passkeyLoginVerify(req: IncomingMessage, ip: string) {
      const body = await readJson(req);
      tooMany(`passkey-login:${ip}`, 30);
      const challenge = challenges.take(body.challengeId, "login", null);
      if (!challenge) throw challengeGone();
      const response = asObject(body.response);
      if (!response) throw new HttpError(400, "Bad request.", "bad_request");
      const passkey =
        typeof response.id === "string" ? passkeyById(response.id) : undefined;
      const user = passkey && liveUserById(passkey.user_id);
      if (!passkey || !user) throw unknownPasskey();
      // The handle the authenticator holds must be this user's.
      const handle = asObject(response.response)?.userHandle;
      if (
        typeof handle === "string" &&
        user.webauthn_user_id &&
        handle !== user.webauthn_user_id
      ) {
        throw passkeyFailed(401);
      }
      let verified;
      try {
        verified = await verifyAuthenticationResponse({
          response: response as unknown as AuthenticationResponseJSON,
          expectedChallenge: challenge.challenge,
          expectedOrigin: opts.passkey.origins,
          expectedRPID: opts.passkey.rpID,
          requireUserVerification: true,
          credential: {
            id: passkey.id,
            publicKey: new Uint8Array(passkey.public_key),
            counter: passkey.counter,
            transports: parseTransports(passkey.transports),
          },
        });
      } catch {
        throw passkeyFailed(401);
      }
      if (!verified.verified) throw passkeyFailed(401);
      const { newCounter, credentialBackedUp } = verified.authenticationInfo;
      // Deleted while the browser was checking it.
      const used = db
        .stmt(
          "UPDATE passkeys SET counter = MAX(counter, ?), backed_up = ?, last_used_at = ? WHERE id = ?"
        )
        .run(
          newCounter,
          credentialBackedUp ? 1 : 0,
          new Date().toISOString(),
          passkey.id
        );
      const current = liveUserById(user.id);
      if (!used.changes || !current) throw unknownPasskey();
      return startSession(current, body.guestToken, { passkeyId: passkey.id });
    },

    // ── Sign in with Apple ──

    // The nonce the app puts in its Apple request; Apple signs it into the
    // identity token. Tied to the session it was asked with, if any.
    async appleOptions(req: IncomingMessage, ip: string) {
      const user = bearerToken(req) ? requireUser(req) : undefined;
      tooMany(`apple-options:${ip}`, 300);
      const minted = challenges.mint("apple", user?.id ?? null);
      return { challengeId: minted.token, nonce: minted.challenge };
    },

    // Signs in with the Apple ID if it is known (a guest signed in hands its
    // player over, as when logging in). Otherwise the Apple ID is added to
    // whoever is signed in (a guest becomes an account, keeping its id and
    // players, as with a passkey), or makes a new account.
    async appleVerify(req: IncomingMessage, ip: string) {
      const user = bearerToken(req) ? requireUser(req) : undefined;
      tooMany(`apple:${ip}`, 30);
      const body = await readJson(req);
      const challenge = challenges.take(
        body.challengeId,
        "apple",
        user?.id ?? null
      );
      if (!challenge) throw challengeGone();
      let claims;
      try {
        claims = await verifyAppleToken(body.identityToken, {
          keys: opts.apple.keys,
          audiences: opts.apple.audiences,
          nonce: challenge.challenge,
          now: opts.now && (() => opts.now!().getTime()),
        });
      } catch {
        throw new HttpError(
          401,
          "Couldn't verify that Apple sign-in. Try again.",
          "apple_failed"
        );
      }
      const at = new Date().toISOString();
      const email = claims.email ? normEmail(claims.email).slice(0, 254) : null;
      const signedOut = () =>
        new HttpError(401, "Please sign in again.", "not_signed_in");
      const made = { identity: `apple:${claims.sub}` };

      const known = appleIdentity(claims.sub);
      const owner = known && liveUserById(known.user_id);
      if (owner) {
        db.stmt(
          "UPDATE identities SET last_used_at = ?, email = COALESCE(?, email) WHERE provider = 'apple' AND subject = ?"
        ).run(at, email, claims.sub);
        if (!user) return respond(owner, createSession(owner.id, made));
        if (owner.id === user.id) return respond(user, bearerToken(req));
        if (user.is_guest) return startSession(owner, bearerToken(req), made);
        throw new HttpError(
          409,
          "That Apple ID is already used by another account.",
          "apple_taken"
        );
      }

      const link = (userId: string) => {
        // A leftover from a deleted account.
        if (known) {
          db.stmt(
            "DELETE FROM identities WHERE provider = 'apple' AND subject = ?"
          ).run(claims.sub);
        }
        db.stmt(
          "INSERT INTO identities (provider, subject, user_id, email, created_at, last_used_at) VALUES ('apple', ?, ?, ?, ?, ?)"
        ).run(claims.sub, userId, email, at, at);
      };
      const raced = (e: unknown) =>
        String(e).includes("UNIQUE")
          ? new HttpError(
              409,
              "That Apple ID was just used. Try again.",
              "apple_taken"
            )
          : e;

      if (!user) {
        const id = randomUUID();
        try {
          const token = db.transaction(() => {
            db.stmt(
              "INSERT INTO users (id, is_guest, created_at) VALUES (?, 0, ?)"
            ).run(id, at);
            link(id);
            return createSession(id, made);
          });
          return { ...respond(userById(id)!, token), isNew: true };
        } catch (e) {
          throw raced(e);
        }
      }

      try {
        const token = db.transaction(() => {
          // Signed out, deleted or upgraded elsewhere while Apple was asked.
          const current = liveUserById(user.id);
          const session = db
            .stmt("SELECT 1 FROM sessions WHERE token_hash = ? AND user_id = ?")
            .get(sha256(bearerToken(req)), user.id);
          if (!current || !session) throw signedOut();
          if (hasApple(current.id)) {
            throw new HttpError(
              409,
              "This account already has an Apple ID.",
              "has_apple"
            );
          }
          link(current.id);
          if (!current.is_guest) return bearerToken(req);
          db.stmt(
            "UPDATE users SET is_guest = 0 WHERE id = ? AND is_guest = 1"
          ).run(current.id);
          // Same user, new session: the guest token is retired.
          deleteSessions(current.id);
          return createSession(current.id, made);
        });
        return respond(userById(user.id)!, token);
      } catch (e) {
        throw raced(e);
      }
    },

    // Unlinks the account's Apple ID, unless it is the last way in. Whoever
    // else signed in with it is signed out; this session stays.
    async removeApple(req: IncomingMessage, ip: string) {
      const user = requireUser(req);
      tooMany(`apple-remove:${ip}`, 30);
      if (!hasApple(user.id)) {
        throw new HttpError(404, "No Apple ID to remove.", "not_found");
      }
      if (!canUsePassword(user) && passkeyCount(user.id) < 1) {
        throw new HttpError(
          409,
          "It's your only way to sign in. Add a passkey or a password first.",
          "last_sign_in"
        );
      }
      db.transaction(() => {
        const mine = sha256(bearerToken(req));
        db.stmt(
          "DELETE FROM sessions WHERE token_hash != ? AND identity IN (SELECT 'apple:' || subject FROM identities WHERE provider = 'apple' AND user_id = ?)"
        ).run(mine, user.id);
        db.stmt("UPDATE sessions SET identity = NULL WHERE token_hash = ?").run(
          mine
        );
        db.stmt(
          "DELETE FROM identities WHERE provider = 'apple' AND user_id = ?"
        ).run(user.id);
      });
      return { ok: true };
    },

    // The signed-in account's passkeys (never their keys).
    async passkeys(req: IncomingMessage) {
      const user = requireUser(req);
      return {
        passkeys: passkeysOf(user.id).map((p) => ({
          id: p.id,
          name: p.name,
          createdAt: p.created_at,
          lastUsedAt: p.last_used_at,
          deviceType: p.device_type,
          backedUp: !!p.backed_up,
        })),
      };
    },

    // Removing a passkey is refused when it is the last way to sign in.
    async deletePasskey(req: IncomingMessage, ip: string, id: string) {
      const user = requireUser(req);
      tooMany(`passkey-delete:${ip}`, 30);
      const passkey = passkeyById(id);
      if (!passkey || passkey.user_id !== user.id) {
        throw new HttpError(404, "No such passkey.", "not_found");
      }
      if (
        !canUsePassword(user) &&
        !hasApple(user.id) &&
        passkeyCount(user.id) < 2
      ) {
        throw new HttpError(
          409,
          "It's your only way to sign in. Add another passkey or a password first.",
          "last_sign_in"
        );
      }
      db.transaction(() => {
        // Whoever signed in with it is signed out.
        db.stmt("DELETE FROM sessions WHERE passkey_id = ?").run(id);
        db.stmt("DELETE FROM passkeys WHERE id = ?").run(id);
      });
      return { ok: true };
    },

    // Deletes the signed-in account. The users row stays as a tombstone so the
    // id is never handed out again; games, scores and players stay too, as
    // other people played in them.
    async deleteAccount(req: IncomingMessage, ip: string) {
      const user = requireUser(req);
      tooMany(`delete:${ip}`, 10);
      if ((await readJson(req)).confirm !== "DELETE") {
        throw new HttpError(400, "Type DELETE to confirm.", "confirm_required");
      }
      // No awaits from here: nothing can claim a player in between.
      releaseClaims(user);
      db.transaction(() => {
        deleteSessions(user.id);
        db.stmt("DELETE FROM passkeys WHERE user_id = ?").run(user.id);
        db.stmt("DELETE FROM identities WHERE user_id = ?").run(user.id);
        db.stmt("DELETE FROM reset_tokens WHERE user_id = ?").run(user.id);
        db.stmt(
          "UPDATE users SET email = NULL, password_salt = NULL, password_hash = NULL, guest_secret_hash = NULL, webauthn_user_id = NULL, is_admin = 0, deleted_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), user.id);
      });
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
            "SELECT user_id FROM reset_tokens JOIN users ON users.id = reset_tokens.user_id WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND users.deleted_at IS NULL"
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
      db.stmt("DELETE FROM passkeys WHERE user_id = ?").run(found.user_id);
      db.stmt("DELETE FROM identities WHERE user_id = ?").run(found.user_id);
      setPassword(found.user_id, hashed);
      return respond(userById(found.user_id)!, createSession(found.user_id));
    },
  };
}
export type Auth = ReturnType<typeof createAuth>;
