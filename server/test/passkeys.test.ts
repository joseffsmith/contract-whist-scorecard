import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createChallenges } from "../src/challenges";
import { openDb } from "../src/db";
import { createLimiter } from "../src/http";
import { createSync } from "../src/sync";
import { createAuthenticator } from "./authenticator";
import type { Authenticator, Override } from "./authenticator";
import { action, newGame, start, tempDir } from "./helpers";
import type { Api } from "./helpers";

// The default config: PUBLIC_URL is https://joseffsmith.uk/contract-whist.
const SITE = { rpID: "joseffsmith.uk", origin: "https://joseffsmith.uk" };
const phone = (site = SITE) => createAuthenticator(site);

// Asks for options, lets the authenticator answer, and verifies. Returns the
// verify response.
async function register(
  api: Api,
  token: string,
  device: Authenticator,
  over: Override = {},
  name?: string
) {
  const { body } = await api.post("/auth/passkey/register/options", {}, token);
  return api.post(
    "/auth/passkey/register/verify",
    {
      challengeId: body.challengeId,
      response: device.create(body.options, over),
      name,
    },
    token
  );
}

async function signIn(
  api: Api,
  device: Authenticator,
  guestToken?: string,
  over: Override & { id?: string } = {}
) {
  const { body } = await api.post("/auth/passkey/login/options", {});
  return api.post("/auth/passkey/login/verify", {
    challengeId: body.challengeId,
    response: device.get(body.options, over),
    guestToken,
  });
}

// A passkey-only account on its own device.
async function passkeyAccount(api: Api, device = phone()) {
  const guest = await api.guest();
  const res = await register(api, guest.token, device);
  expect(res.status).toBe(200);
  return res.body as { token: string; user: any };
}

const claims = async (api: Api) =>
  Object.fromEntries(
    (await api.get("/sync/pull?since=0")).body.puts.players.map((p: any) => [
      p.id,
      p,
    ])
  );

describe("passkey options", () => {
  it("asks for a discoverable passkey for this site", async () => {
    const api = await start();
    const guest = await api.guest();
    const res = await api.post(
      "/auth/passkey/register/options",
      {},
      guest.token
    );
    expect(res.status).toBe(200);
    const { options, challengeId } = res.body;
    expect(challengeId).toEqual(expect.any(String));
    expect(options).toMatchObject({
      rp: { id: "joseffsmith.uk", name: "Whist" },
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      excludeCredentials: [],
    });
    expect(options.user.name).toBe("Whist player");
    expect(options.user.displayName).toBe("Whist player");
  });

  it("needs no session to sign in or to make a new account", async () => {
    const api = await start();
    expect((await api.post("/auth/passkey/register/options", {})).status).toBe(
      200
    );
    // A session that no longer exists is an error, not "no session".
    expect(
      (await api.post("/auth/passkey/register/options", {}, "stale")).status
    ).toBe(401);
    const verify = await api.post("/auth/passkey/register/verify", {});
    expect([verify.status, verify.body.code]).toEqual([
      400,
      "challenge_expired",
    ]);
    const res = await api.post("/auth/passkey/login/options", {});
    expect(res.status).toBe(200);
    // No credentials listed: the device offers whatever it holds.
    expect(res.body.options).toMatchObject({
      rpId: "joseffsmith.uk",
      userVerification: "required",
    });
    expect(res.body.options.allowCredentials).toBeUndefined();
  });

  it("names the user by email, else by their player, else generically", async () => {
    const api = await start();
    const account = await api.signup("ann@example.com");
    const named = await api.post(
      "/auth/passkey/register/options",
      {},
      account.token
    );
    expect(named.body.options.user.name).toBe("ann@example.com");

    const guest = await api.guest();
    await api.push(guest.token, ...newGame().actions); // claims "Host"
    const byPlayer = await api.post(
      "/auth/passkey/register/options",
      {},
      guest.token
    );
    expect(byPlayer.body.options.user.name).toBe("Host");
    expect(byPlayer.body.options.user.displayName).toBe("Host");
  });

  it("gives each user a stable random handle that isn't their id", async () => {
    const api = await start();
    const guest = await api.guest();
    const handle = async (token: string) =>
      (await api.post("/auth/passkey/register/options", {}, token)).body.options
        .user.id;
    const first = await handle(guest.token);
    expect(first).not.toBe(guest.user.id);
    expect(Buffer.from(first, "base64url").length).toBe(32);
    expect(await handle(guest.token)).toBe(first);
    const other = await api.guest();
    expect(await handle(other.token)).not.toBe(first);
  });

  it("lists the user's passkeys as excluded", async () => {
    const api = await start();
    const device = phone();
    const { token } = await passkeyAccount(api, device);
    const [id] = [...device.credentials.keys()];
    const res = await api.post("/auth/passkey/register/options", {}, token);
    expect(res.body.options.excludeCredentials).toEqual([
      { id, type: "public-key", transports: ["internal"] },
    ]);
  });
});

describe("passkey challenges", () => {
  it("can be used once", async () => {
    const api = await start();
    const guest = await api.guest();
    const device = phone();
    const { body } = await api.post(
      "/auth/passkey/register/options",
      {},
      guest.token
    );
    const verify = (token: string) =>
      api.post(
        "/auth/passkey/register/verify",
        {
          challengeId: body.challengeId,
          response: device.create(body.options),
        },
        token
      );
    const first = await verify(guest.token);
    expect(first.status).toBe(200);
    // The guest became an account with a new session; ask again with that.
    const again = await verify(first.body.token);
    expect([again.status, again.body.code]).toEqual([400, "challenge_expired"]);
  });

  it("is used up by a failed attempt too", async () => {
    const api = await start();
    const guest = await api.guest();
    const device = phone();
    const { body } = await api.post(
      "/auth/passkey/register/options",
      {},
      guest.token
    );
    const verify = (response: unknown) =>
      api.post(
        "/auth/passkey/register/verify",
        { challengeId: body.challengeId, response },
        guest.token
      );
    const bad = await verify(
      device.create(body.options, { challenge: "nope" })
    );
    expect([bad.status, bad.body.code]).toEqual([400, "passkey_failed"]);
    const retry = await verify(device.create(body.options));
    expect(retry.body.code).toBe("challenge_expired");
  });

  it("expires after five minutes", async () => {
    let now = new Date("2026-01-01T00:00:00Z");
    const api = await start({ now: () => now });
    const device = phone();
    await passkeyAccount(api, device);
    const attempt = async (wait: number) => {
      const { body } = await api.post("/auth/passkey/login/options", {});
      now = new Date(now.getTime() + wait);
      return api.post("/auth/passkey/login/verify", {
        challengeId: body.challengeId,
        response: device.get(body.options),
      });
    };
    const late = await attempt(5 * 60 * 1000 + 1);
    expect([late.status, late.body.code]).toEqual([400, "challenge_expired"]);
    // Just inside the window still works.
    expect((await attempt(5 * 60 * 1000 - 1)).status).toBe(200);

    // Registration challenges expire the same way.
    const guest = await api.guest();
    const opts = await api.post(
      "/auth/passkey/register/options",
      {},
      guest.token
    );
    now = new Date(now.getTime() + 5 * 60 * 1000 + 1);
    const slow = await api.post(
      "/auth/passkey/register/verify",
      {
        challengeId: opts.body.challengeId,
        response: phone().create(opts.body.options),
      },
      guest.token
    );
    expect(slow.body.code).toBe("challenge_expired");
  });

  it("belongs to the user who asked and to one kind of ceremony", async () => {
    const api = await start();
    const a = await api.guest();
    const b = await api.guest();
    const device = phone();
    const opts = await api.post("/auth/passkey/register/options", {}, a.token);
    const stolen = await api.post(
      "/auth/passkey/register/verify",
      {
        challengeId: opts.body.challengeId,
        response: device.create(opts.body.options),
      },
      b.token
    );
    expect(stolen.body.code).toBe("challenge_expired");

    // A sign-in challenge can't register a passkey.
    const login = await api.post("/auth/passkey/login/options", {});
    const wrong = await api.post(
      "/auth/passkey/register/verify",
      {
        challengeId: login.body.challengeId,
        response: device.create(opts.body.options),
      },
      a.token
    );
    expect(wrong.body.code).toBe("challenge_expired");
    // Nor an unknown or malformed id.
    for (const challengeId of ["nope", 5, null, undefined]) {
      const res = await api.post(
        "/auth/passkey/register/verify",
        { challengeId, response: {} },
        a.token
      );
      expect([res.status, res.body.code]).toEqual([400, "challenge_expired"]);
    }
  });
});

describe("passkey config", () => {
  it("takes the RP ID and origin from PUBLIC_URL by default", async () => {
    const api = await start({
      publicUrl: "http://localhost:5173/contract-whist",
    });
    const local = { rpID: "localhost", origin: "http://localhost:5173" };
    const guest = await api.guest();
    const { body } = await api.post(
      "/auth/passkey/register/options",
      {},
      guest.token
    );
    expect(body.options.rp.id).toBe("localhost");
    const device = phone(local);
    const ok = await api.post(
      "/auth/passkey/register/verify",
      {
        challengeId: body.challengeId,
        response: device.create(body.options),
      },
      guest.token
    );
    expect(ok.status).toBe(200);
    // The production origin isn't this server's.
    const other = await api.guest();
    const o = await api.post("/auth/passkey/register/options", {}, other.token);
    const wrong = await api.post(
      "/auth/passkey/register/verify",
      {
        challengeId: o.body.challengeId,
        response: phone().create(o.body.options, { origin: SITE.origin }),
      },
      other.token
    );
    expect([wrong.status, wrong.body.code]).toEqual([400, "passkey_failed"]);
  });

  it("accepts every configured origin, and only those", async () => {
    const api = await start({
      publicUrl: "https://whist.example.com/contract-whist",
      passkeyRpId: "example.com",
      passkeyOrigins: ["https://example.com", "https://whist.example.com"],
    });
    const asked = async (over: Override) => {
      const guest = await api.guest();
      return register(api, guest.token, phone(), over);
    };
    expect(
      (await api.post("/auth/passkey/login/options", {})).body.options.rpId
    ).toBe("example.com");
    expect((await asked({ origin: "https://example.com" })).status).toBe(200);
    expect((await asked({ origin: "https://whist.example.com" })).status).toBe(
      200
    );
    for (const origin of [
      "https://evil.example.com",
      "http://example.com",
      "https://example.com:8443",
    ]) {
      const res = await asked({ origin });
      expect([origin, res.status]).toEqual([origin, 400]);
    }
    // A credential made for another RP ID is refused too.
    expect((await asked({ rpID: "joseffsmith.uk" })).status).toBe(400);
  });
});

describe("registering a passkey", () => {
  it("upgrades a guest in place, like signup", async () => {
    const api = await start();
    const id = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
    const secret = "s".repeat(43);
    const made = await api.post("/auth/guest", { id, secret });
    const guest = made.body;
    const game = newGame();
    await api.push(guest.token, ...game.actions);

    const device = phone();
    const res = await register(api, guest.token, device, {}, "  My iPhone ");
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: guest.user.id,
      email: null,
      isGuest: false,
      hasPassword: false,
      passkeyCount: 1,
    });
    // A new session replaces the guest's.
    expect(res.body.token).not.toBe(guest.token);
    expect((await api.get("/auth/me", guest.token)).status).toBe(401);
    const me = await api.get("/auth/me", res.body.token);
    expect(me.body.user).toEqual(res.body.user);
    // The claimed player is still theirs.
    expect((await claims(api))[game.playerId].claimedBy).toBe(guest.user.id);
    // Not a guest any more, so the id can't be had back by its secret.
    const again = await api.post("/auth/guest", { id, secret });
    expect(again.body.code).toBe("id_taken");

    const list = await api.get("/auth/passkeys", res.body.token);
    expect(list.body.passkeys).toHaveLength(1);
    expect(list.body.passkeys[0].name).toBe("My iPhone");
  });

  it("adds a passkey to an account without ending its session", async () => {
    const api = await start();
    const account = await api.signup("ann@example.com");
    const res = await register(api, account.token, phone());
    expect(res.status).toBe(200);
    expect(res.body.token).toBe(account.token);
    expect(res.body.user).toEqual({
      id: account.user.id,
      email: "ann@example.com",
      isGuest: false,
      hasPassword: true,
      passkeyCount: 1,
    });
    // Email and password still work.
    const login = await api.post("/auth/login", {
      email: "ann@example.com",
      password: "password123",
    });
    expect(login.status).toBe(200);
  });

  it("refuses a credential id that already exists", async () => {
    const api = await start();
    const device = phone();
    await passkeyAccount(api, device);
    const [id] = [...device.credentials.keys()];

    // Another user presenting the same credential id with a key of their own.
    const other = await api.guest();
    const res = await register(api, other.token, phone(), {
      credentialId: Buffer.from(id, "base64url"),
    });
    expect([res.status, res.body.code]).toEqual([409, "passkey_exists"]);
    expect((await api.get("/auth/me", other.token)).body.user).toMatchObject({
      isGuest: true,
      passkeyCount: 0,
    });
    // And the original still signs in as its owner.
    expect((await signIn(api, device)).status).toBe(200);
  });

  it("rejects bad attestations and malformed bodies", async () => {
    const api = await start();
    const guest = await api.guest();
    const device = phone();
    const opts = async () =>
      (await api.post("/auth/passkey/register/options", {}, guest.token)).body;
    const send = (body: unknown) =>
      api.post("/auth/passkey/register/verify", body, guest.token);

    let o = await opts();
    expect((await send({ challengeId: o.challengeId })).body.code).toBe(
      "bad_request"
    );
    o = await opts();
    expect(
      (await send({ challengeId: o.challengeId, response: { id: "x" } })).body
        .code
    ).toBe("passkey_failed");
    // The browser says it signed for another challenge.
    o = await opts();
    const forged = device.create(o.options, { challenge: "AAAA" });
    expect(
      (await send({ challengeId: o.challengeId, response: forged })).body.code
    ).toBe("passkey_failed");
    expect((await api.get("/auth/me", guest.token)).body.user.isGuest).toBe(
      true
    );
  });

  it("allows up to 20 passkeys", async () => {
    const api = await start();
    const { token } = await passkeyAccount(api);
    for (let i = 1; i < 20; i++) {
      expect((await register(api, token, phone())).status).toBe(200);
    }
    const options = await api.post("/auth/passkey/register/options", {}, token);
    expect([options.status, options.body.code]).toEqual([
      400,
      "too_many_passkeys",
    ]);
  });
});

describe("signing in with a passkey", () => {
  it("signs in with no username, on a new session", async () => {
    const api = await start();
    const device = phone();
    const account = await passkeyAccount(api, device);
    await api.post("/auth/logout", {}, account.token);

    const res = await signIn(api, device);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual(account.user);
    expect(res.body.token).not.toBe(account.token);
    expect((await api.get("/auth/me", res.body.token)).status).toBe(200);
  });

  it("hands a guest's player and games to the account", async () => {
    const api = await start();
    const device = phone();
    const account = await passkeyAccount(api, device);
    const guest = await api.guest();
    const game = newGame();
    await api.push(guest.token, ...game.actions);
    const before = (await api.get("/sync/pull?since=0")).body;

    const res = await signIn(api, device, guest.token);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(account.user.id);

    const after = await api.get(`/sync/pull?since=${before.version}`);
    expect(after.body.puts.players).toEqual([
      {
        id: game.playerId,
        name: "Host",
        claimedBy: account.user.id,
        createdAt: expect.any(String),
      },
    ]);
    expect(after.body.puts.games[0].createdBy).toBe(account.user.id);
    // The guest's session is over.
    expect((await api.get("/auth/me", guest.token)).status).toBe(401);
  });

  it("merges into the account's own player, as password login does", async () => {
    const api = await start();
    const device = phone();
    const account = await passkeyAccount(api, device);
    const mine = newGame();
    await api.push(account.token, ...mine.actions);
    const guest = await api.guest();
    const theirs = newGame();
    await api.push(guest.token, ...theirs.actions);

    expect((await signIn(api, device, guest.token)).status).toBe(200);
    const players = await claims(api);
    expect(players[theirs.playerId]).toMatchObject({
      mergedInto: mine.playerId,
    });
  });

  it("signs in even when the guest token is junk", async () => {
    const api = await start();
    const device = phone();
    await passkeyAccount(api, device);
    for (const guestToken of ["nope", 5, {}]) {
      const { body } = await api.post("/auth/passkey/login/options", {});
      const res = await api.post("/auth/passkey/login/verify", {
        challengeId: body.challengeId,
        response: device.get(body.options),
        guestToken,
      });
      expect([guestToken, res.status]).toEqual([guestToken, 200]);
    }
  });

  it("keeps the counter and last use up to date", async () => {
    const api = await start();
    const device = phone();
    const account = await passkeyAccount(api, device);
    const [id] = [...device.credentials.keys()];
    const listed = () => api.get("/auth/passkeys", account.token);
    expect((await listed()).body.passkeys[0].lastUsedAt).toBeNull();

    await signIn(api, device);
    await signIn(api, device);
    const list = (await listed()).body.passkeys;
    expect(list[0].lastUsedAt).toEqual(expect.any(String));
    await api.close();

    const db = openDb(api.dir);
    expect(
      db.stmt("SELECT counter FROM passkeys WHERE id = ?").get(id)
    ).toEqual({ counter: 2 });
    db.close();
    expect(device.credentials.get(id)!.counter).toBe(2);
  });

  it("refuses an authenticator whose counter went backwards", async () => {
    const api = await start();
    const device = phone();
    await passkeyAccount(api, device);
    const [id] = [...device.credentials.keys()];
    expect((await signIn(api, device)).status).toBe(200); // counter 1
    expect((await signIn(api, device)).status).toBe(200); // counter 2
    device.setCounter(id, 0); // a clone, or a restored backup
    const res = await signIn(api, device);
    expect([res.status, res.body.code]).toEqual([401, "passkey_failed"]);
  });

  it("doesn't know passkeys it never saw", async () => {
    const api = await start();
    const stranger = phone();
    // A key pair of the stranger's own, never registered here.
    const guest = await api.guest();
    const opts = await api.post(
      "/auth/passkey/register/options",
      {},
      guest.token
    );
    stranger.create(opts.body.options);
    const res = await signIn(api, stranger);
    expect([res.status, res.body]).toEqual([
      401,
      { error: "That passkey isn't recognised.", code: "unknown_passkey" },
    ]);
  });

  it("checks the origin, the RP ID and the signature", async () => {
    const api = await start();
    const device = phone();
    await passkeyAccount(api, device);
    const attempt = async (over: Override) => {
      const { body } = await api.post("/auth/passkey/login/options", {});
      return api.post("/auth/passkey/login/verify", {
        challengeId: body.challengeId,
        response: device.get(body.options, over),
      });
    };
    for (const over of [
      { origin: "https://evil.example" },
      { rpID: "evil.example", id: [...device.credentials.keys()][0] },
      { challenge: "AAAA" },
    ]) {
      const res = await attempt(over);
      expect([JSON.stringify(over), res.status]).toEqual([
        JSON.stringify(over),
        401,
      ]);
    }
    expect((await attempt({})).status).toBe(200);

    // Someone else's key signing as this credential id.
    const [id] = [...device.credentials.keys()];
    const forger = phone();
    const guest = await api.guest();
    const opts = await api.post(
      "/auth/passkey/register/options",
      {},
      guest.token
    );
    forger.create(opts.body.options, {
      credentialId: Buffer.from(id, "base64url"),
    });
    const { body } = await api.post("/auth/passkey/login/options", {});
    const res = await api.post("/auth/passkey/login/verify", {
      challengeId: body.challengeId,
      response: forger.get(body.options),
    });
    expect([res.status, res.body.code]).toEqual([401, "passkey_failed"]);
  });

  it("requires user verification", async () => {
    const api = await start();
    const guest = await api.guest();
    const device = phone();
    const unverified = await register(api, guest.token, device, {
      userVerified: false,
    });
    expect([unverified.status, unverified.body.code]).toEqual([
      400,
      "passkey_failed",
    ]);
    const second = phone();
    expect((await register(api, guest.token, second)).status).toBe(200);
    const res = await signIn(api, second, undefined, { userVerified: false });
    expect([res.status, res.body.code]).toEqual([401, "passkey_failed"]);
    expect((await signIn(api, second)).status).toBe(200);
  });

  it("refuses a handle that isn't the account's", async () => {
    const api = await start();
    const device = phone();
    await passkeyAccount(api, device);
    const { body } = await api.post("/auth/passkey/login/options", {});
    const response = device.get(body.options);
    response.response.userHandle =
      Buffer.from("someone else").toString("base64url");
    const res = await api.post("/auth/passkey/login/verify", {
      challengeId: body.challengeId,
      response,
    });
    expect([res.status, res.body.code]).toEqual([401, "passkey_failed"]);
  });
});

describe("listing and removing passkeys", () => {
  it("lists passkeys without their keys", async () => {
    const api = await start();
    const device = phone();
    const account = await passkeyAccount(api, device);
    const [id] = [...device.credentials.keys()];
    await register(api, account.token, phone(), {}, "Work laptop");
    const res = await api.get("/auth/passkeys", account.token);
    expect(res.status).toBe(200);
    expect(res.body.passkeys).toHaveLength(2);
    expect(res.body.passkeys[0]).toEqual({
      id,
      name: null,
      createdAt: expect.any(String),
      lastUsedAt: null,
      deviceType: expect.stringMatching(/Device$/),
      backedUp: false,
    });
    expect(res.body.passkeys[1].name).toBe("Work laptop");
    expect((await api.get("/auth/passkeys")).status).toBe(401);
    const guest = await api.guest();
    expect((await api.get("/auth/passkeys", guest.token)).body).toEqual({
      passkeys: [],
    });
  });

  it("won't remove the last way to sign in", async () => {
    const api = await start();
    const first = phone();
    const account = await passkeyAccount(api, first);
    const [id] = [...first.credentials.keys()];
    const guard = await api.delete(
      `/auth/passkeys/${id}`,
      undefined,
      account.token
    );
    expect([guard.status, guard.body.code]).toEqual([409, "last_sign_in"]);
    expect(
      (await api.get("/auth/me", account.token)).body.user.passkeyCount
    ).toBe(1);

    // With a second passkey the first can go.
    const second = phone();
    await register(api, account.token, second);
    const gone = await api.delete(
      `/auth/passkeys/${id}`,
      undefined,
      account.token
    );
    expect(gone.status).toBe(200);
    // (The session that registering the first one made went with it.)
    expect((await signIn(api, first)).status).toBe(401);
    const viaSecond = await signIn(api, second);
    expect(viaSecond.status).toBe(200);
    expect(viaSecond.body.user.passkeyCount).toBe(1);
    // ...but not the one that's left.
    const [last] = [...second.credentials.keys()];
    const stuck = await api.delete(
      `/auth/passkeys/${last}`,
      undefined,
      viaSecond.body.token
    );
    expect(stuck.body.code).toBe("last_sign_in");
  });

  it("lets an account with a password remove its only passkey", async () => {
    const api = await start();
    const device = phone();
    const account = await api.signup("ann@example.com");
    await register(api, account.token, device);
    const [id] = [...device.credentials.keys()];
    const res = await api.delete(
      `/auth/passkeys/${id}`,
      undefined,
      account.token
    );
    expect(res.status).toBe(200);
    expect((await api.get("/auth/me", account.token)).body.user).toMatchObject({
      passkeyCount: 0,
      hasPassword: true,
    });
  });

  it("only removes your own passkeys", async () => {
    const api = await start();
    const device = phone();
    await passkeyAccount(api, device);
    const [id] = [...device.credentials.keys()];
    const other = await api.signup("bob@example.com");
    const res = await api.delete(
      `/auth/passkeys/${id}`,
      undefined,
      other.token
    );
    expect([res.status, res.body.code]).toEqual([404, "not_found"]);
    expect((await api.delete(`/auth/passkeys/${id}`)).status).toBe(401);
    expect((await signIn(api, device)).status).toBe(200);
  });
});

describe("deleting an account", () => {
  it("leaves a tombstone and takes everything else", async () => {
    const dir = tempDir();
    const api = await start({
      dataDir: dir,
      adminBootstrapToken: "boot-secret",
    });
    const account = await api.signup("ann@example.com");
    await register(api, account.token, phone());
    // An admin can delete themselves; the role goes with the account.
    await api.post(
      "/auth/claim-admin",
      { token: "boot-secret" },
      account.token
    );
    const link = await api.post(
      "/auth/reset-link",
      { email: "ann@example.com" },
      account.token
    );
    expect(link.status).toBe(200);

    const res = await api.delete(
      "/auth/me",
      { confirm: "DELETE" },
      account.token
    );
    expect(res).toMatchObject({ status: 200, body: { ok: true } });
    expect((await api.get("/auth/me", account.token)).status).toBe(401);
    await api.close();

    const db = openDb(dir);
    expect(
      db.stmt("SELECT * FROM users WHERE id = ?").get(account.user.id)
    ).toEqual({
      id: account.user.id,
      email: null,
      is_guest: 0,
      is_admin: 0,
      password_salt: null,
      password_hash: null,
      guest_secret_hash: null,
      webauthn_user_id: null,
      deleted_at: expect.any(String),
      created_at: expect.any(String),
    });
    for (const table of ["sessions", "passkeys", "reset_tokens"]) {
      expect(
        db
          .stmt(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`)
          .get(account.user.id)
      ).toEqual({ n: 0 });
    }
    db.close();
  });

  it("needs the word DELETE and a session", async () => {
    const api = await start();
    const account = await api.signup("ann@example.com");
    for (const confirm of [undefined, "delete", "yes", true]) {
      const res = await api.delete("/auth/me", { confirm }, account.token);
      expect([res.status, res.body.code]).toEqual([400, "confirm_required"]);
    }
    expect((await api.delete("/auth/me", { confirm: "DELETE" })).status).toBe(
      401
    );
    expect((await api.get("/auth/me", account.token)).status).toBe(200);
  });

  it("releases claimed players, and the change syncs", async () => {
    const api = await start();
    const account = await api.signup("ann@example.com");
    const mine = newGame();
    await api.push(account.token, ...mine.actions);
    const other = await api.guest();
    const claim = action("claimPlayer", { playerId: mine.playerId });
    expect((await api.push(other.token, claim)).results[0]).toMatchObject({
      ok: false,
      code: "claimed",
    });

    // A phone watching the stream sees the player released.
    const version = (await api.get("/sync/pull")).body.version;
    const controller = new AbortController();
    const stream = await fetch(`${api.url}/sync/stream?since=${version}`, {
      signal: controller.signal,
    });
    const reader = stream.body!.getReader();
    const events = async () => {
      let text = "";
      while (!text.includes("\n\n")) {
        text += new TextDecoder().decode((await reader.read()).value);
      }
      return JSON.parse(text.slice(6, text.indexOf("\n\n")));
    };
    expect((await events()).puts).toEqual({});

    const res = await api.delete(
      "/auth/me",
      { confirm: "DELETE" },
      account.token
    );
    expect(res.status).toBe(200);
    const change = await events();
    controller.abort();
    expect(change.version).toBe(version + 1);
    expect(change.puts.players).toEqual([
      { id: mine.playerId, name: "Host", createdAt: expect.any(String) },
    ]);

    expect((await claims(api))[mine.playerId].claimedBy).toBeUndefined();
    // Free to claim again; the game and the player stay.
    expect((await api.push(other.token, claim)).results[0].ok).toBe(true);
    const pulled = (await api.get("/sync/pull?since=0")).body;
    expect(pulled.puts.games[0]).toMatchObject({
      id: mine.gameId,
      createdBy: account.user.id,
    });
    expect(pulled.puts.seats).toHaveLength(1);
  });

  it("ends every session, passkey and way of signing in", async () => {
    const api = await start();
    const bystander = phone();
    const other = await passkeyAccount(api, bystander);

    const account = await api.signup("ann@example.com");
    const device = phone();
    await register(api, account.token, device);
    const second = await api.post("/auth/login", {
      email: "ann@example.com",
      password: "password123",
    });
    const third = await signIn(api, device);

    const res = await api.delete(
      "/auth/me",
      { confirm: "DELETE" },
      account.token
    );
    expect(res.status).toBe(200);
    for (const token of [account.token, second.body.token, third.body.token]) {
      expect((await api.get("/auth/me", token)).status).toBe(401);
      expect(
        (await api.post("/sync/push", { actions: [] }, token)).status
      ).toBe(401);
    }
    // Email and password: the usual failure.
    const login = await api.post("/auth/login", {
      email: "ann@example.com",
      password: "password123",
    });
    expect([login.status, login.body.code]).toEqual([401, "bad_credentials"]);
    // The passkey: not recognised.
    const gone = await signIn(api, device);
    expect([gone.status, gone.body]).toEqual([
      401,
      { error: "That passkey isn't recognised.", code: "unknown_passkey" },
    ]);
    // Other accounts are untouched.
    expect((await api.get("/auth/me", other.token)).status).toBe(200);
    expect((await signIn(api, bystander)).status).toBe(200);
    // The email can start a new, empty account.
    const again = await api.signup("ann@example.com");
    expect(again.user.id).not.toBe(account.user.id);
  }, 30_000);

  it("treats the user as gone even if a session or passkey were left behind", async () => {
    const dir = tempDir();
    let api = await start({ dataDir: dir });
    const device = phone();
    const account = await passkeyAccount(api, device);
    await api.close();

    // Put the account in the deleted state by hand, leaving its rows.
    const db = openDb(dir);
    db.stmt("UPDATE users SET deleted_at = ? WHERE id = ?").run(
      "2026-01-01T00:00:00.000Z",
      account.user.id
    );
    db.stmt(
      "INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)"
    ).run(
      createHash("sha256").update("left-over").digest("hex"),
      account.user.id,
      "x"
    );
    db.close();

    api = await start({ dataDir: dir });
    expect((await api.get("/auth/me", "left-over")).status).toBe(401);
    expect((await api.get("/auth/me", account.token)).status).toBe(401);
    expect((await signIn(api, device)).body.code).toBe("unknown_passkey");
    const guest = await api.post("/auth/guest", { id: account.user.id });
    expect(guest.body.code).toBe("id_taken");
  });

  it("keeps the id reserved, whoever tries to take it", async () => {
    const api = await start();
    const id = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
    const secret = "s".repeat(43);
    const guest = await api.post("/auth/guest", { id, secret });
    expect(guest.status).toBe(200);
    const res = await api.delete(
      "/auth/me",
      { confirm: "DELETE" },
      guest.body.token
    );
    expect(res.status).toBe(200);
    for (const body of [{ id }, { id, secret }]) {
      const again = await api.post("/auth/guest", body);
      expect([again.status, again.body.code]).toEqual([409, "id_taken"]);
    }
    // Same for an account's id.
    const account = await api.signup("ann@example.com");
    await api.delete("/auth/me", { confirm: "DELETE" }, account.token);
    const taken = await api.post("/auth/guest", { id: account.user.id });
    expect(taken.body.code).toBe("id_taken");
  });

  it("kills the account's reset links", async () => {
    const api = await start({
      adminBootstrapToken: "boot-secret",
      publicUrl: "https://example.test/app",
    });
    const admin = await api.signup("admin@example.com");
    await api.post("/auth/claim-admin", { token: "boot-secret" }, admin.token);
    const member = await api.signup("member@example.com");
    const link = await api.post(
      "/auth/reset-link",
      { email: "member@example.com" },
      admin.token
    );
    const token = link.body.url.split("#")[1];
    await api.delete("/auth/me", { confirm: "DELETE" }, member.token);
    const reset = await api.post("/auth/reset", {
      token,
      password: "newpassword1",
    });
    expect([reset.status, reset.body.code]).toEqual([400, "invalid_token"]);
    const none = await api.post(
      "/auth/reset-link",
      { email: "member@example.com" },
      admin.token
    );
    expect(none.status).toBe(404);
  }, 30_000);

  it("is rate limited", async () => {
    const api = await start();
    const guest = await api.guest();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await api.delete("/auth/me", { confirm: "no" }, guest.token))
        .status;
    }
    expect(last).toBe(429);
  });
});

describe("account details", () => {
  it("reports hasPassword and passkeyCount", async () => {
    const api = await start();
    const guest = await api.guest();
    expect(guest.user).toMatchObject({ hasPassword: false, passkeyCount: 0 });
    const account = await api.signup("ann@example.com");
    expect(account.user).toMatchObject({ hasPassword: true, passkeyCount: 0 });
    const login = await api.post("/auth/login", {
      email: "ann@example.com",
      password: "password123",
    });
    expect(login.body.user).toMatchObject({
      hasPassword: true,
      passkeyCount: 0,
    });
    await register(api, account.token, phone());
    expect((await api.get("/auth/me", account.token)).body.user).toMatchObject({
      hasPassword: true,
      passkeyCount: 1,
    });
  }, 30_000);

  it("rate limits the passkey endpoints", async () => {
    const api = await start();
    let last = 0;
    for (let i = 0; i < 301; i++) {
      last = (await api.post("/auth/passkey/login/options", {})).status;
    }
    expect(last).toBe(429);
    let verify = 0;
    for (let i = 0; i < 31; i++) {
      verify = (await api.post("/auth/passkey/login/verify", {})).status;
    }
    expect(verify).toBe(429);
  });
});

describe("stateless challenges", () => {
  const fresh = async (api: Api) =>
    (await api.post("/auth/passkey/login/options", {})).body;
  const signInWith = (api: Api, c: any, device: Authenticator) =>
    api.post("/auth/passkey/login/verify", {
      challengeId: c.challengeId,
      response: device.get(c.options),
    });
  const [payloadOf, withPayload] = [
    (token: string) =>
      JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()),
    (token: string, change: object) =>
      Buffer.from(
        JSON.stringify({
          ...JSON.parse(
            Buffer.from(token.split(".")[0], "base64url").toString()
          ),
          ...change,
        })
      ).toString("base64url") +
      "." +
      token.split(".")[1],
  ];

  it("refuses a token that was altered or isn't ours", async () => {
    const api = await start();
    const device = phone();
    await passkeyAccount(api, device);
    const c = await fresh(api);
    const [body, signature] = c.challengeId.split(".");
    expect(payloadOf(c.challengeId)).toMatchObject({
      kind: "login",
      userId: null,
    });
    const tampered = [
      withPayload(c.challengeId, { kind: "register" }),
      withPayload(c.challengeId, { expires: Date.now() + 3_600_000 }),
      withPayload(c.challengeId, { userId: "someone" }),
      `${body}.${signature.slice(0, -2)}AA`,
      `${body}.`,
      `.${signature}`,
      `${body}.${signature}.x`,
      body,
      "",
    ];
    for (const challengeId of tampered) {
      const res = await api.post("/auth/passkey/login/verify", {
        challengeId,
        response: device.get(c.options),
      });
      expect([challengeId.slice(-6), res.body.code]).toEqual([
        challengeId.slice(-6),
        "challenge_expired",
      ]);
    }
    // A token another server made (another secret) isn't ours either.
    const other = await start();
    const foreign = await fresh(other);
    expect((await signInWith(api, foreign, device)).body.code).toBe(
      "challenge_expired"
    );
    // The genuine one still works: nothing above spent it.
    expect((await signInWith(api, c, device)).status).toBe(200);
  });

  it("refuses a token that is used again, even after success", async () => {
    const api = await start();
    const device = phone();
    await passkeyAccount(api, device);
    const c = await fresh(api);
    const response = device.get(c.options);
    const send = () =>
      api.post("/auth/passkey/login/verify", {
        challengeId: c.challengeId,
        response,
      });
    expect((await send()).status).toBe(200);
    expect((await send()).body.code).toBe("challenge_expired");
  });

  it("is for one kind of ceremony", async () => {
    const api = await start();
    const device = phone();
    const account = await passkeyAccount(api, device);
    const asked = (
      await api.post("/auth/passkey/register/options", {}, account.token)
    ).body;
    const res = await api.post("/auth/passkey/login/verify", {
      challengeId: asked.challengeId,
      response: device.get((await fresh(api)).options),
    });
    expect(res.body.code).toBe("challenge_expired");
  });

  it("survives a restart", async () => {
    const dir = tempDir();
    let api = await start({ dataDir: dir });
    const device = phone();
    const account = await passkeyAccount(api, device);
    const login = await fresh(api);
    const register = (
      await api.post("/auth/passkey/register/options", {}, account.token)
    ).body;
    await api.close();

    api = await start({ dataDir: dir });
    expect((await signInWith(api, login, device)).status).toBe(200);
    const added = await api.post(
      "/auth/passkey/register/verify",
      {
        challengeId: register.challengeId,
        response: phone().create(register.options),
      },
      account.token
    );
    expect(added.status).toBe(200);
  });

  it("keeps working for a crowd on one address", async () => {
    // Nothing is held per challenge, so many outstanding ones lose none.
    const api = await start();
    const device = phone();
    await passkeyAccount(api, device);
    const all = [];
    for (let n = 0; n < 60; n++) all.push(await fresh(api));
    expect((await signInWith(api, all[0], device)).status).toBe(200);
    expect((await signInWith(api, all[59], device)).status).toBe(200);
  });

  it("only remembers tokens that were used", () => {
    const store = createChallenges(Buffer.from("k".repeat(32)));
    const a = store.mint("login", null);
    expect(store.take(a.token, "login", null)?.challenge).toBe(a.challenge);
    expect(store.take(a.token, "login", null)).toBeUndefined();
    for (const junk of [undefined, null, 5, {}, "a.b.c.d"]) {
      expect(store.take(junk, "login", null)).toBeUndefined();
    }
  });
});

describe("passkey config checks", () => {
  const boot = (opts: object) => start(opts);

  it("needs a bare host name that every origin's host is or sits under", async () => {
    await expect(boot({ passkeyRpId: "https://example.com" })).rejects.toThrow(
      /bare host name/
    );
    await expect(boot({ passkeyRpId: "example.com:443" })).rejects.toThrow(
      /bare host name/
    );
    await expect(
      boot({
        passkeyRpId: "whist.example.com",
        passkeyOrigins: ["https://example.com"],
      })
    ).rejects.toThrow(/never work/);
    await expect(
      boot({
        passkeyRpId: "example.com",
        passkeyOrigins: ["https://notexample.com"],
      })
    ).rejects.toThrow(/never work/);
    // Not an address, and any case is fine.
    await expect(boot({ passkeyRpId: "127.0.0.1" })).rejects.toThrow(
      /not an address/
    );
    await expect(
      boot({
        passkeyRpId: "Example.COM",
        passkeyOrigins: ["https://Whist.Example.com"],
      })
    ).resolves.toBeDefined();
    // The default RP ID doesn't fit an origin of another site either.
    await expect(
      boot({ passkeyOrigins: ["https://example.com"] })
    ).rejects.toThrow(/joseffsmith\.uk/);
    expect(
      (
        await boot({
          passkeyRpId: "example.com",
          passkeyOrigins: [
            "https://a.b.example.com",
            "http://example.com:8080",
          ],
        })
      ).url
    ).toMatch(/^http/);
  });
});

describe("requests overtaken by a sign-out or a delete", () => {
  it("doesn't let a push in flight claim a player for a deleted account", async () => {
    const api = await start();
    const account = await api.signup("ann@example.com");
    const game = newGame();
    const push = api.slow(
      "POST",
      "/sync/push",
      { actions: game.actions },
      account.token
    );
    await new Promise((r) => setTimeout(r, 50));
    const del = await api.delete(
      "/auth/me",
      { confirm: "DELETE" },
      account.token
    );
    expect(del.status).toBe(200);
    const res = await push.finish();
    expect([res.status, res.body.code]).toEqual([401, "not_signed_in"]);
    const pulled = (await api.get("/sync/pull?since=0")).body;
    expect(pulled.puts?.players ?? []).toEqual([]);
    expect(pulled.puts?.games ?? []).toEqual([]);
  });

  it("makes the action pipeline itself refuse a deleted actor", () => {
    const db = openDb(tempDir());
    const limiter = createLimiter();
    const sync = createSync(db, limiter);
    db.stmt(
      "INSERT INTO users (id, is_guest, created_at, deleted_at) VALUES ('gone', 0, 'x', 'y')"
    ).run();
    db.stmt(
      "INSERT INTO users (id, is_guest, created_at) VALUES ('here', 0, 'x')"
    ).run();
    const make = (id: string, actor: string) =>
      sync.apply(id, [
        {
          action: action("createPlayer", {
            playerId: randomUUID(),
            name: "Zed",
            claim: true,
          }),
          actor: { id: actor, isGuest: false },
        },
      ]);
    expect(() => make("a1", "gone")).toThrow(
      expect.objectContaining({ status: 401, code: "not_signed_in" })
    );
    expect(make("a2", "here").ok).toBe(true);
    expect(db.version()).toBe(1);
    sync.close();
    limiter.stop();
    db.close();
  });

  it("refuses to register a passkey for a guest who logged out meanwhile", async () => {
    const api = await start();
    const guest = await api.guest();
    const { body } = await api.post(
      "/auth/passkey/register/options",
      {},
      guest.token
    );
    const verify = api.slow(
      "POST",
      "/auth/passkey/register/verify",
      {
        challengeId: body.challengeId,
        response: phone().create(body.options),
      },
      guest.token
    );
    await new Promise((r) => setTimeout(r, 50));
    expect((await api.post("/auth/logout", {}, guest.token)).status).toBe(200);
    const res = await verify.finish();
    expect([res.status, res.body.code]).toEqual([401, "not_signed_in"]);
    // Nothing was kept, and the guest is still a guest.
    const other = await api.signup("ann@example.com");
    expect(
      (await api.get("/auth/passkeys", other.token)).body.passkeys
    ).toEqual([]);
    const again = await api.post("/auth/guest", { id: guest.user.id });
    expect(again.body.code).toBe("id_taken");
  });

  it("refuses a revoked session of an account too", async () => {
    const api = await start();
    const account = await api.signup("ann@example.com");
    const other = await api.post("/auth/login", {
      email: "ann@example.com",
      password: "password123",
    });
    const { body } = await api.post(
      "/auth/passkey/register/options",
      {},
      account.token
    );
    const verify = api.slow(
      "POST",
      "/auth/passkey/register/verify",
      {
        challengeId: body.challengeId,
        response: phone().create(body.options),
      },
      account.token
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(
      (await api.post("/auth/sessions/revoke-others", {}, other.body.token))
        .status
    ).toBe(200);
    const res = await verify.finish();
    expect([res.status, res.body.code]).toEqual([401, "not_signed_in"]);
    expect(
      (await api.get("/auth/me", other.body.token)).body.user.passkeyCount
    ).toBe(0);
  }, 30_000);

  it("lets only one of two tabs upgrade the same guest", async () => {
    const api = await start();
    const guest = await api.guest();
    const ask = async () =>
      (await api.post("/auth/passkey/register/options", {}, guest.token)).body;
    const [o1, o2] = [await ask(), await ask()];
    const tab = (o: any) =>
      api.slow(
        "POST",
        "/auth/passkey/register/verify",
        { challengeId: o.challengeId, response: phone().create(o.options) },
        guest.token
      );
    const [v1, v2] = [tab(o1), tab(o2)];
    await new Promise((r) => setTimeout(r, 50));
    const first = await v1.finish();
    const second = await v2.finish();
    expect(first.status).toBe(200);
    // The loser is told to sign in again, not handed the guest token that
    // the winner retired.
    expect([second.status, second.body.code]).toEqual([401, "not_signed_in"]);
    expect(second.body.token).toBeUndefined();
    const me = await api.get("/auth/me", first.body.token);
    expect(me.body.user).toMatchObject({ isGuest: false, passkeyCount: 1 });
  });
});

describe("revoking access", () => {
  it("signs out the sessions a passkey made when it is removed", async () => {
    const api = await start();
    const first = phone();
    const account = await passkeyAccount(api, first);
    const second = phone();
    await register(api, account.token, second);
    const viaFirst = (await signIn(api, first)).body.token;
    const viaSecond = (await signIn(api, second)).body.token;
    const [firstId] = [...first.credentials.keys()];

    const res = await api.delete(
      `/auth/passkeys/${firstId}`,
      undefined,
      viaSecond
    );
    expect(res.status).toBe(200);
    expect((await api.get("/auth/me", viaFirst)).status).toBe(401);
    // So is the session that registering it made; the other passkey's stays.
    expect((await api.get("/auth/me", account.token)).status).toBe(401);
    expect((await api.get("/auth/me", viaSecond)).status).toBe(200);
  });

  it("removes the passkeys when an admin resets the password", async () => {
    const api = await start({
      adminBootstrapToken: "boot-secret",
      publicUrl: "https://example.test/app",
    });
    const admin = await api.signup("admin@example.com");
    await api.post("/auth/claim-admin", { token: "boot-secret" }, admin.token);
    const member = await api.signup("member@example.com");
    const thief = phone();
    await register(api, member.token, thief);
    const viaThief = (await signIn(api, thief)).body.token;
    const link = await api.post(
      "/auth/reset-link",
      { email: "member@example.com" },
      admin.token
    );
    const reset = await api.post("/auth/reset", {
      token: link.body.url.split("#")[1],
      password: "newpassword1",
    });
    expect(reset.status).toBe(200);
    expect(reset.body.user.passkeyCount).toBe(0);
    expect((await api.get("/auth/me", viaThief)).status).toBe(401);
    expect((await signIn(api, thief)).body.code).toBe("unknown_passkey");
  }, 30_000);

  it("signs out every other device, keeping this one", async () => {
    const api = await start();
    const device = phone();
    const account = await passkeyAccount(api, device);
    const second = (await signIn(api, device)).body.token;
    const third = (await signIn(api, device)).body.token;
    expect(
      (await api.post("/auth/sessions/revoke-others", {}, account.token)).body
    ).toEqual({ ok: true });
    expect((await api.get("/auth/me", account.token)).status).toBe(200);
    expect((await api.get("/auth/me", second)).status).toBe(401);
    expect((await api.get("/auth/me", third)).status).toBe(401);
    // The passkey still signs in, and others' sessions are untouched.
    const other = await api.signup("bob@example.com");
    expect((await signIn(api, device)).status).toBe(200);
    await api.post("/auth/sessions/revoke-others", {}, account.token);
    expect((await api.get("/auth/me", other.token)).status).toBe(200);
    expect((await api.post("/auth/sessions/revoke-others", {})).status).toBe(
      401
    );
  }, 30_000);
});

describe("a backup email and password for a passkey-only account", () => {
  it("sets both and keeps the session", async () => {
    const api = await start();
    const device = phone();
    const account = await passkeyAccount(api, device);
    const res = await api.post(
      "/auth/email",
      { email: " Ann@Example.com ", password: "password123" },
      account.token
    );
    expect(res.status).toBe(200);
    expect(res.body.token).toBe(account.token);
    expect(res.body.user).toEqual({
      id: account.user.id,
      email: "ann@example.com",
      isGuest: false,
      hasPassword: true,
      passkeyCount: 1,
    });
    const login = await api.post("/auth/login", {
      email: "ann@example.com",
      password: "password123",
    });
    expect(login.body.user.id).toBe(account.user.id);
    // Now the only passkey can go, and the password can be changed.
    const [id] = [...device.credentials.keys()];
    expect(
      (await api.delete(`/auth/passkeys/${id}`, undefined, login.body.token))
        .status
    ).toBe(200);
    expect(
      (
        await api.post(
          "/auth/password",
          { password: "newpassword1" },
          login.body.token
        )
      ).status
    ).toBe(200);
  }, 30_000);

  it("checks the email and password like signup does", async () => {
    const api = await start();
    await api.signup("taken@example.com");
    const account = await passkeyAccount(api);
    const send = (body: object) => api.post("/auth/email", body, account.token);
    expect(
      (await send({ email: "nope", password: "password123" })).body.code
    ).toBe("invalid_email");
    expect((await send({ email: "a@b.co", password: "short" })).body.code).toBe(
      "weak_password"
    );
    const dup = await send({
      email: "TAKEN@example.com",
      password: "password123",
    });
    expect([dup.status, dup.body.code]).toEqual([409, "has_account"]);
    // Still nothing set.
    expect((await api.get("/auth/me", account.token)).body.user).toMatchObject({
      email: null,
      hasPassword: false,
    });
  }, 30_000);

  it("is only for signed-in accounts that have no email yet", async () => {
    const api = await start();
    const body = { email: "a@b.co", password: "password123" };
    expect((await api.post("/auth/email", body)).status).toBe(401);
    const guest = await api.guest();
    const asGuest = await api.post("/auth/email", body, guest.token);
    expect([asGuest.status, asGuest.body.code]).toEqual([403, "guest"]);
    const withEmail = await api.signup("ann@example.com");
    const again = await api.post("/auth/email", body, withEmail.token);
    expect([again.status, again.body.code]).toEqual([409, "has_email"]);
  }, 30_000);

  it("has its own rate limit", async () => {
    const api = await start();
    const guest = await api.guest();
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await api.post("/auth/email", {}, guest.token)).status;
    }
    expect(last).toBe(429);
  });

  it("stops accounts without an email setting a password", async () => {
    const api = await start();
    const account = await passkeyAccount(api);
    const res = await api.post(
      "/auth/password",
      { password: "password123" },
      account.token
    );
    expect([res.status, res.body.code]).toEqual([400, "no_email"]);
  });
});

describe("making an account with a passkey, signed out", () => {
  const create = async (
    api: Api,
    device: Authenticator,
    over: Override = {}
  ) => {
    const { body } = await api.post("/auth/passkey/register/options", {});
    return {
      options: body,
      res: await api.post("/auth/passkey/register/verify", {
        challengeId: body.challengeId,
        response: device.create(body.options, over),
        name: "New phone",
      }),
    };
  };

  it("asks for a brand-new user with a handle made by the server", async () => {
    const api = await start();
    const first = (await api.post("/auth/passkey/register/options", {})).body;
    const second = (await api.post("/auth/passkey/register/options", {})).body;
    expect(first.options).toMatchObject({
      rp: { id: "joseffsmith.uk", name: "Whist" },
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      excludeCredentials: [],
      user: { name: "Whist player", displayName: "Whist player" },
    });
    expect(Buffer.from(first.options.user.id, "base64url").length).toBe(32);
    expect(second.options.user.id).not.toBe(first.options.user.id);
    expect(second.options.challenge).not.toBe(first.options.challenge);
  });

  it("makes the account and signs it in, only once the passkey checks out", async () => {
    const dir = tempDir();
    const api = await start({ dataDir: dir });
    const device = phone();
    // Asking makes no user.
    await api.post("/auth/passkey/register/options", {});
    const { options, res } = await create(api, device);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      email: null,
      isGuest: false,
      hasPassword: false,
      passkeyCount: 1,
    });
    const me = await api.get("/auth/me", res.body.token);
    expect(me.body.user).toEqual(res.body.user);
    expect(
      (await api.get("/auth/passkeys", res.body.token)).body.passkeys
    ).toEqual([expect.objectContaining({ name: "New phone" })]);
    // It signs in again as the same user (the handle the server chose).
    const back = await signIn(api, device);
    expect(back.body.user).toEqual(res.body.user);
    expect(options.options.user.id).toBeTruthy();
    await api.close();
    const db = openDb(dir);
    expect(db.stmt("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 });
    expect(db.stmt("SELECT webauthn_user_id AS h FROM users").get()).toEqual({
      h: options.options.user.id,
    });
    db.close();
  });

  it("makes no user when the passkey doesn't check out", async () => {
    const dir = tempDir();
    const api = await start({ dataDir: dir });
    const bad = await create(api, phone(), { origin: "https://evil.example" });
    expect([bad.res.status, bad.res.body.code]).toEqual([
      400,
      "passkey_failed",
    ]);
    // A credential id that exists already.
    const device = phone();
    await passkeyAccount(api, device);
    const [id] = [...device.credentials.keys()];
    const dup = await create(api, phone(), {
      credentialId: Buffer.from(id, "base64url"),
    });
    expect([dup.res.status, dup.res.body.code]).toEqual([
      409,
      "passkey_exists",
    ]);
    await api.close();
    const db = openDb(dir);
    expect(db.stmt("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 });
    db.close();
  });

  it("keeps the two kinds of registration token apart", async () => {
    const api = await start();
    const guest = await api.guest();
    const device = phone();
    const forAccount = (await api.post("/auth/passkey/register/options", {}))
      .body;
    const forGuest = (
      await api.post("/auth/passkey/register/options", {}, guest.token)
    ).body;
    // A new-account token can't be used with a session...
    const withSession = await api.post(
      "/auth/passkey/register/verify",
      {
        challengeId: forAccount.challengeId,
        response: device.create(forAccount.options),
      },
      guest.token
    );
    expect(withSession.body.code).toBe("challenge_expired");
    // ...and a session's token can't make an account.
    const without = await api.post("/auth/passkey/register/verify", {
      challengeId: forGuest.challengeId,
      response: device.create(forGuest.options),
    });
    expect(without.body.code).toBe("challenge_expired");
    // Each is spent now, whichever way it failed.
    const retry = await api.post("/auth/passkey/register/verify", {
      challengeId: forAccount.challengeId,
      response: device.create(forAccount.options),
    });
    expect(retry.body.code).toBe("challenge_expired");
  });

  it("makes sessions that end with the passkey that made them", async () => {
    const api = await start();
    const first = phone();
    const { res } = await create(api, first);
    const second = phone();
    expect((await register(api, res.body.token, second)).status).toBe(200);
    const viaSecond = (await signIn(api, second)).body.token;
    const [firstId] = [...first.credentials.keys()];
    expect(
      (await api.delete(`/auth/passkeys/${firstId}`, undefined, viaSecond))
        .status
    ).toBe(200);
    expect((await api.get("/auth/me", res.body.token)).status).toBe(401);
    expect((await api.get("/auth/me", viaSecond)).status).toBe(200);
  });

  it("is limited like the other verify calls", async () => {
    const api = await start();
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await api.post("/auth/passkey/register/verify", {})).status;
    }
    expect(last).toBe(429);
  });
});
