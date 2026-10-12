import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { appleKeys, verifyAppleToken } from "../src/apple";
import { createAuthenticator } from "./authenticator";
import { action, start } from "./helpers";
import type { Api } from "./helpers";

const BUNDLE = "uk.joseffsmith.whist";

// Stands in for Apple: its published keys and the identity tokens it signs.
function fakeApple(now?: () => number) {
  const kid = "test-key";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  let fetches = 0;
  let published: object[] | null = [
    { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256" },
  ];
  const jwks = () => {
    fetches++;
    return Promise.resolve({ keys: published } as never);
  };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return {
    keys: appleKeys(jwks, now),
    get fetches() {
      return fetches;
    },
    // What Apple's key URL answers from now on.
    publish(keys: object[] | null) {
      published = keys;
    },
    token(
      claims: Record<string, unknown>,
      { key = privateKey, header = {} }: { key?: KeyObject; header?: object } = {}
    ) {
      const now = Math.floor(Date.now() / 1000);
      const head = b64({ alg: "RS256", kid, ...header });
      const body = b64({
        iss: "https://appleid.apple.com",
        aud: BUNDLE,
        iat: now,
        exp: now + 600,
        ...claims,
      });
      const sig = sign(
        "RSA-SHA256",
        Buffer.from(`${head}.${body}`),
        key
      ).toString("base64url");
      return `${head}.${body}.${sig}`;
    },
  };
}
type Apple = ReturnType<typeof fakeApple>;

// The app's side: asks for a nonce, "signs in with Apple", sends the token.
async function appleSignIn(
  api: Api,
  apple: Apple,
  sub: string,
  token?: string,
  extra: Record<string, unknown> = {},
  body: Record<string, unknown> = {}
) {
  const opts = await api.post("/auth/apple/options", {}, token);
  expect(opts.status).toBe(200);
  return api.post(
    "/auth/apple/verify",
    {
      challengeId: opts.body.challengeId,
      identityToken: apple.token({ sub, nonce: opts.body.nonce, ...extra }),
      ...body,
    },
    token
  );
}

async function setup(opts = {}) {
  const apple = fakeApple();
  const api = await start({ appleKeys: apple.keys, ...opts });
  return { api, apple };
}

describe("verifyAppleToken", () => {
  const check = (apple: Apple, token: string, nonce = "n") =>
    verifyAppleToken(token, { keys: apple.keys, audiences: [BUNDLE], nonce });

  it("accepts a token Apple signed for us with our nonce", async () => {
    const apple = fakeApple();
    await expect(
      check(apple, apple.token({ sub: "001", nonce: "n", email: "a@b.c" }))
    ).resolves.toEqual({ sub: "001", email: "a@b.c" });
  });

  it("refuses anything else", async () => {
    const apple = fakeApple();
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const past = Math.floor(Date.now() / 1000) - 3600;
    const bad = [
      apple.token({ sub: "001", nonce: "other" }),
      apple.token({ sub: "001" }),
      apple.token({ sub: "001", nonce: "n", aud: "com.someone.else" }),
      apple.token({ sub: "001", nonce: "n", iss: "https://evil.example" }),
      apple.token({ sub: "001", nonce: "n", exp: past }),
      apple.token({ nonce: "n" }),
      apple.token({ sub: "001", nonce: "n" }, { key: other.privateKey }),
      apple.token({ sub: "001", nonce: "n" }, { header: { kid: "nope" } }),
      apple.token({ sub: "001", nonce: "n" }, { header: { alg: "none" } }),
      "not.a.token",
      "",
    ];
    for (const token of bad) {
      await expect(check(apple, token)).rejects.toThrow();
    }
  });

  it("fetches Apple's keys once, and an unknown key id at most once a minute", async () => {
    const apple = fakeApple();
    for (let i = 0; i < 3; i++) {
      await check(apple, apple.token({ sub: "1", nonce: "n" }));
      await check(
        apple,
        apple.token({ sub: "1", nonce: "n" }, { header: { kid: "nope" } })
      ).catch(() => {});
    }
    expect(apple.fetches).toBe(1);
  });

  it("keeps the keys it has when Apple's reply has none", async () => {
    let at = 0;
    const apple = fakeApple(() => at);
    const check = () =>
      verifyAppleToken(apple.token({ sub: "1", nonce: "n" }), {
        keys: apple.keys,
        audiences: [BUNDLE],
        nonce: "n",
      });
    await expect(check()).resolves.toMatchObject({ sub: "1" });
    for (const broken of [[], null, [{ kty: "RSA", kid: "x", n: "!" }]]) {
      apple.publish(broken);
      at += 25 * 60 * 60 * 1000; // a day on: due a refetch
      await expect(check()).resolves.toMatchObject({ sub: "1" });
    }
    expect(apple.fetches).toBe(4);
  });
});

describe("Sign in with Apple", () => {
  it("makes an account, then signs in to it", async () => {
    const { api, apple } = await setup();
    const first = await appleSignIn(api, apple, "001", undefined, {
      email: "Joe@Example.com",
    });
    expect(first.status).toBe(200);
    expect(first.body.user).toMatchObject({
      isGuest: false,
      email: null, // Apple's address never becomes a login
      hasApple: true,
      hasPassword: false,
    });
    const again = await appleSignIn(api, apple, "001");
    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(first.body.user.id);
    expect(again.body.token).not.toBe(first.body.token);
    const me = await api.get("/auth/me", again.body.token);
    expect(me.body.user.hasApple).toBe(true);
  });

  it("upgrades a guest in place", async () => {
    const { api, apple } = await setup();
    const guest = await api.guest();
    const res = await appleSignIn(api, apple, "001", guest.token);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: guest.user.id,
      isGuest: false,
      hasApple: true,
    });
    expect((await api.get("/auth/me", guest.token)).status).toBe(401);
    expect((await api.get("/auth/me", res.body.token)).status).toBe(200);
  });

  it("signs a guest in to the account that has the Apple ID, bringing its player", async () => {
    const { api, apple } = await setup();
    const account = (await appleSignIn(api, apple, "001")).body;
    const guest = await api.guest();
    const playerId = randomUUID();
    await api.push(
      guest.token,
      action("createPlayer", { playerId, name: "Jo", claim: true })
    );
    const res = await appleSignIn(api, apple, "001", guest.token);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(account.user.id);
    expect((await api.get("/auth/me", guest.token)).status).toBe(401);
    const pulled = await api.get("/sync/pull?since=0");
    const player = pulled.body.puts.players.find(
      (p: { id: string }) => p.id === playerId
    );
    expect(player.claimedBy).toBe(account.user.id);
  });

  it("adds an Apple ID to a signed-in account", async () => {
    const { api, apple } = await setup();
    const account = await api.signup("joe@example.com");
    const res = await appleSignIn(api, apple, "001", account.token);
    expect(res.status).toBe(200);
    expect(res.body.token).toBe(account.token);
    expect(res.body.user).toMatchObject({
      id: account.user.id,
      email: "joe@example.com",
      hasApple: true,
    });
    // The same Apple ID again changes nothing.
    const again = await appleSignIn(api, apple, "001", account.token);
    expect([again.status, again.body.user.id]).toEqual([200, account.user.id]);
    // A second Apple ID is refused.
    const second = await appleSignIn(api, apple, "002", account.token);
    expect([second.status, second.body.code]).toEqual([409, "has_apple"]);
  });

  it("won't move an Apple ID from one account to another", async () => {
    const { api, apple } = await setup();
    await appleSignIn(api, apple, "001");
    const other = await api.signup("other@example.com");
    const res = await appleSignIn(api, apple, "001", other.token);
    expect([res.status, res.body.code]).toEqual([409, "apple_taken"]);
  });

  it("refuses a used, foreign or mismatched nonce", async () => {
    const { api, apple } = await setup();
    const opts = (await api.post("/auth/apple/options", {})).body;
    const send = (challengeId: string, nonce: string, token?: string) =>
      api.post(
        "/auth/apple/verify",
        { challengeId, identityToken: apple.token({ sub: "001", nonce }) },
        token
      );
    expect((await send(opts.challengeId, "wrong")).body.code).toBe(
      "apple_failed"
    );
    // Spent by the failed try.
    expect((await send(opts.challengeId, opts.nonce)).body.code).toBe(
      "challenge_expired"
    );
    // Asked for while signed in, used without the session.
    const guest = await api.guest();
    const mine = (await api.post("/auth/apple/options", {}, guest.token)).body;
    expect((await send(mine.challengeId, mine.nonce)).body.code).toBe(
      "challenge_expired"
    );
    const forged = (await api.post("/auth/apple/options", {})).body;
    expect(
      (await send(forged.challengeId + "x", forged.nonce)).body.code
    ).toBe("challenge_expired");
  });

  it("lets a passkey go when Apple is another way in", async () => {
    const { api, apple } = await setup();
    const device = createAuthenticator({
      rpID: "joseffsmith.uk",
      origin: "https://joseffsmith.uk",
    });
    const account = (await appleSignIn(api, apple, "001")).body;
    const options = (
      await api.post("/auth/passkey/register/options", {}, account.token)
    ).body;
    const reg = await api.post(
      "/auth/passkey/register/verify",
      {
        challengeId: options.challengeId,
        response: device.create(options.options),
      },
      account.token
    );
    expect(reg.status).toBe(200);
    const [passkey] = (await api.get("/auth/passkeys", account.token)).body
      .passkeys;
    const res = await api.delete(
      `/auth/passkeys/${passkey.id}`,
      undefined,
      account.token
    );
    expect(res.status).toBe(200);
  });

  it("forgets the Apple ID when the account is deleted", async () => {
    const { api, apple } = await setup();
    const account = (await appleSignIn(api, apple, "001")).body;
    const del = await api.delete(
      "/auth/me",
      { confirm: "DELETE" },
      account.token
    );
    expect(del.status).toBe(200);
    const fresh = await appleSignIn(api, apple, "001");
    expect(fresh.status).toBe(200);
    expect(fresh.body.user.id).not.toBe(account.user.id);
  });
});

describe("removing an Apple ID", () => {
  it("is refused when it's the only way in", async () => {
    const { api, apple } = await setup();
    const account = (await appleSignIn(api, apple, "001")).body;
    const res = await api.delete("/auth/apple", undefined, account.token);
    expect([res.status, res.body.code]).toEqual([409, "last_sign_in"]);
  });

  it("unlinks it and signs out whoever signed in with it", async () => {
    const { api, apple } = await setup();
    const account = await api.signup("joe@example.com");
    expect((await appleSignIn(api, apple, "001", account.token)).status).toBe(
      200
    );
    // Someone else signs in with that Apple ID on another phone.
    const viaApple = (await appleSignIn(api, apple, "001")).body;
    expect(viaApple.user.id).toBe(account.user.id);

    const res = await api.delete("/auth/apple", undefined, account.token);
    expect(res.status).toBe(200);
    expect((await api.get("/auth/me", viaApple.token)).status).toBe(401);
    const me = await api.get("/auth/me", account.token);
    expect(me.status).toBe(200);
    expect(me.body.user.hasApple).toBeUndefined();
    // The Apple ID is free again: it makes a new account.
    const fresh = await appleSignIn(api, apple, "001");
    expect(fresh.body.user.id).not.toBe(account.user.id);
    expect(
      (await api.delete("/auth/apple", undefined, account.token)).status
    ).toBe(404);
  });

  it("goes with an admin password reset", async () => {
    const { api, apple } = await setup({ adminBootstrapToken: "boot" });
    const admin = await api.signup("admin@example.com");
    await api.post("/auth/claim-admin", { token: "boot" }, admin.token);
    const account = await api.signup("joe@example.com");
    await appleSignIn(api, apple, "001", account.token);
    const link = await api.post(
      "/auth/reset-link",
      { email: "joe@example.com" },
      admin.token
    );
    const token = new URL(link.body.url).hash.slice(1);
    const reset = await api.post("/auth/reset", {
      token,
      password: "a-new-password",
    });
    expect(reset.status).toBe(200);
    expect(reset.body.user.hasApple).toBeUndefined();
    const fresh = await appleSignIn(api, apple, "001");
    expect(fresh.body.user.id).not.toBe(account.user.id);
  });
});

describe("app association files", () => {
  it("aren't there until the apps are configured", async () => {
    const { api } = await setup();
    expect(
      (await api.get("/.well-known/apple-app-site-association")).status
    ).toBe(404);
    expect((await api.get("/.well-known/assetlinks.json")).status).toBe(404);
  });

  it("name the apps, and Android's certificate becomes a passkey origin", async () => {
    const cert = Array.from({ length: 32 }, (_, i) =>
      i.toString(16).padStart(2, "0").toUpperCase()
    ).join(":");
    const { api } = await setup({
      appleTeamId: "45TRYSJM4M",
      androidCertSha256: [cert.toLowerCase()],
    });
    const aasa = await api.get("/.well-known/apple-app-site-association");
    expect(aasa.headers.get("content-type")).toBe("application/json");
    expect(aasa.body.webcredentials.apps).toEqual([
      "45TRYSJM4M.uk.joseffsmith.whist",
    ]);
    const components = aasa.body.applinks.details[0].components;
    expect(components[0]).toEqual({
      "/": "/contract-whist/games/guest/*",
      exclude: true,
    });
    for (const path of ["join/*", "games", "games/*", "leaderboard"]) {
      expect(components).toContainEqual({ "/": `/contract-whist/${path}` });
    }
    const links = await api.get("/.well-known/assetlinks.json");
    expect(links.body[0].target).toEqual({
      namespace: "android_app",
      package_name: "uk.joseffsmith.whist",
      sha256_cert_fingerprints: [cert],
    });

    // A passkey made in the Android app reports the certificate as its origin.
    const origin = `android:apk-key-hash:${Buffer.from(
      cert.replace(/:/g, ""),
      "hex"
    ).toString("base64url")}`;
    const device = createAuthenticator({ rpID: "joseffsmith.uk", origin });
    const guest = await api.guest();
    const options = (
      await api.post("/auth/passkey/register/options", {}, guest.token)
    ).body;
    const reg = await api.post(
      "/auth/passkey/register/verify",
      {
        challengeId: options.challengeId,
        response: device.create(options.options),
      },
      guest.token
    );
    expect(reg.status).toBe(200);
  });

  it("refuses a malformed certificate fingerprint", async () => {
    await expect(start({ androidCertSha256: ["AB:CD"] })).rejects.toThrow(
      /ANDROID_CERT_SHA256/
    );
  });
});
