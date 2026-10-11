import { describe, expect, it } from "vitest";
import { importSnapshot, openDb } from "../src/db";
import { action, newGame, start } from "./helpers";

describe("guest, signup, login, logout, me", () => {
  it("creates a guest whose token works on /auth/me", async () => {
    const api = await start();
    const guest = await api.guest();
    expect(guest.user).toMatchObject({ email: null, isGuest: true });
    const me = await api.get("/auth/me", guest.token);
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual(guest.user);
  });

  it("rejects /auth/me without or with a bad token", async () => {
    const api = await start();
    expect((await api.get("/auth/me")).status).toBe(401);
    const bad = await api.get("/auth/me", "nope");
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe("not_signed_in");
  });

  it("signs up, logs in with a lowercased email, and logs out", async () => {
    const api = await start();
    const signup = await api.post("/auth/signup", {
      email: "  Ann@Example.com ",
      password: "password123",
    });
    expect(signup.status).toBe(200);
    expect(signup.body.user).toMatchObject({
      email: "ann@example.com",
      isGuest: false,
    });

    const login = await api.post("/auth/login", {
      email: "ANN@example.com",
      password: "password123",
    });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(signup.body.user.id);
    expect(login.body.token).not.toBe(signup.body.token);

    expect((await api.get("/auth/me", login.body.token)).status).toBe(200);
    expect((await api.post("/auth/logout", {}, login.body.token)).status).toBe(
      200
    );
    expect((await api.get("/auth/me", login.body.token)).status).toBe(401);
    // The other session is untouched.
    expect((await api.get("/auth/me", signup.body.token)).status).toBe(200);
  });

  it("validates email and password on signup", async () => {
    const api = await start();
    const email = await api.post("/auth/signup", {
      email: "nope",
      password: "password123",
    });
    expect([email.status, email.body.code]).toEqual([400, "invalid_email"]);
    const weak = await api.post("/auth/signup", {
      email: "a@b.co",
      password: "short",
    });
    expect([weak.status, weak.body.code]).toEqual([400, "weak_password"]);
  });

  it("upgrades a guest in place, keeping the user id and claimed player", async () => {
    const api = await start();
    const guest = await api.guest();
    const game = newGame();
    await api.push(guest.token, ...game.actions);

    const signup = await api.post(
      "/auth/signup",
      { email: "g@example.com", password: "password123" },
      guest.token
    );
    expect(signup.status).toBe(200);
    expect(signup.body.user).toEqual({
      id: guest.user.id,
      email: "g@example.com",
      isGuest: false,
    });
    expect(signup.body.token).toBe(guest.token);

    const pull = await api.get("/sync/pull?since=0");
    expect(pull.body.puts.players[0]).toMatchObject({
      id: game.playerId,
      claimedBy: guest.user.id,
    });
    // The upgraded user can log in with the new password.
    const login = await api.post("/auth/login", {
      email: "g@example.com",
      password: "password123",
    });
    expect(login.body.user.id).toBe(guest.user.id);
  });

  it("returns has_account for a duplicate email", async () => {
    const api = await start();
    await api.signup("dup@example.com");
    const again = await api.post("/auth/signup", {
      email: "DUP@example.com",
      password: "password123",
    });
    expect([again.status, again.body.code]).toEqual([409, "has_account"]);
    expect(again.body.error).toBe(
      "That email already has an account. Log in instead."
    );
  });

  it("gives the same generic error for wrong password and unknown email", async () => {
    const api = await start();
    await api.signup("who@example.com");
    const wrong = await api.post("/auth/login", {
      email: "who@example.com",
      password: "wrong-password",
    });
    const unknown = await api.post("/auth/login", {
      email: "nobody@example.com",
      password: "wrong-password",
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body).toEqual({
      error: "Wrong email or password.",
      code: "bad_credentials",
    });
  });

  it("rate limits login attempts per email and per client IP", async () => {
    const api = await start();
    const attempt = (email: string, ip: string) =>
      api.post(
        "/auth/login",
        { email, password: "wrong-password" },
        undefined,
        {
          "x-forwarded-for": `1.1.1.1, ${ip}`,
        }
      );
    // 10 attempts per email in the window, from varying IPs.
    for (let i = 0; i < 10; i++) {
      expect((await attempt("t@example.com", `10.0.0.${i}`)).status).toBe(401);
    }
    const blocked = await attempt("t@example.com", "10.0.1.1");
    expect([blocked.status, blocked.body.code]).toEqual([429, "rate_limited"]);

    // 30 per IP (the last X-Forwarded-For entry), across different emails.
    for (let i = 0; i < 30; i++) {
      expect((await attempt(`u${i}@example.com`, "9.9.9.9")).status).toBe(401);
    }
    expect((await attempt("fresh@example.com", "9.9.9.9")).status).toBe(429);
    expect((await attempt("fresh@example.com", "8.8.8.8")).status).toBe(401);
  });

  it("changes the password for a signed-in account only", async () => {
    const api = await start();
    const user = await api.signup("pw@example.com");
    expect(
      (await api.post("/auth/password", { password: "newpassword1" })).status
    ).toBe(401);
    expect(
      (await api.post("/auth/password", { password: "x" }, user.token)).status
    ).toBe(400);
    const guest = await api.guest();
    const asGuest = await api.post(
      "/auth/password",
      { password: "newpassword1" },
      guest.token
    );
    expect(asGuest.status).toBe(403);

    expect(
      (
        await api.post(
          "/auth/password",
          { password: "newpassword1" },
          user.token
        )
      ).status
    ).toBe(200);
    const old = await api.post("/auth/login", {
      email: "pw@example.com",
      password: "password123",
    });
    expect(old.status).toBe(401);
    const fresh = await api.post("/auth/login", {
      email: "pw@example.com",
      password: "newpassword1",
    });
    expect(fresh.status).toBe(200);
  });
});

describe("admin reset links", () => {
  const tokenOf = (url: string) =>
    url.replace("https://example.test/app/reset/", "");
  async function setup() {
    const api = await start({
      adminEmails: ["Admin@example.com"],
      publicUrl: "https://example.test/app/",
    });
    return {
      api,
      admin: await api.signup("admin@example.com"),
      member: await api.signup("member@example.com"),
    };
  }

  it("only lets an admin make a link", async () => {
    const { api, admin, member } = await setup();
    expect(
      (await api.post("/auth/reset-link", { email: "member@example.com" }))
        .status
    ).toBe(401);
    const denied = await api.post(
      "/auth/reset-link",
      { email: "member@example.com" },
      member.token
    );
    expect([denied.status, denied.body.code]).toEqual([403, "forbidden"]);
    const guest = await api.guest();
    expect(
      (
        await api.post(
          "/auth/reset-link",
          { email: "member@example.com" },
          guest.token
        )
      ).status
    ).toBe(403);
    const missing = await api.post(
      "/auth/reset-link",
      { email: "ghost@example.com" },
      admin.token
    );
    expect(missing.status).toBe(404);
  });

  it("sets a new password through the link", async () => {
    const { api, admin, member } = await setup();
    const link = await api.post(
      "/auth/reset-link",
      { email: " MEMBER@example.com" },
      admin.token
    );
    expect(link.status).toBe(200);
    const token = tokenOf(link.body.url);
    expect(token).not.toBe(link.body.url);

    expect(
      (await api.post("/auth/reset", { token, password: "short" })).status
    ).toBe(400);
    const bad = await api.post("/auth/reset", {
      token: "wrong",
      password: "password123",
    });
    expect([bad.status, bad.body.code]).toEqual([400, "invalid_token"]);

    const reset = await api.post("/auth/reset", {
      token,
      password: "brand-new-pw",
    });
    expect(reset.status).toBe(200);
    expect(reset.body.user).toEqual(member.user);
    expect((await api.get("/auth/me", reset.body.token)).status).toBe(200);
    const login = (password: string) =>
      api.post("/auth/login", { email: "member@example.com", password });
    expect((await login("brand-new-pw")).status).toBe(200);
    expect((await login("password123")).status).toBe(401);
  });

  it("makes single-use links that also expire", async () => {
    const { api, admin } = await setup();
    const make = async () =>
      tokenOf(
        (
          await api.post(
            "/auth/reset-link",
            { email: "member@example.com" },
            admin.token
          )
        ).body.url
      );
    const [first, second] = [await make(), await make()];
    expect(first).not.toBe(second);

    expect(
      (
        await api.post("/auth/reset", {
          token: first,
          password: "password-one",
        })
      ).status
    ).toBe(200);
    const again = await api.post("/auth/reset", {
      token: first,
      password: "password-two",
    });
    expect([again.status, again.body.code]).toEqual([400, "invalid_token"]);

    // Expire the other link by editing the database directly.
    const db = openDb(api.dir);
    db.sql.exec("UPDATE reset_tokens SET expires_at = 1");
    db.close();
    const expired = await api.post("/auth/reset", {
      token: second,
      password: "password-two",
    });
    expect([expired.status, expired.body.code]).toEqual([400, "invalid_token"]);
    const login = await api.post("/auth/login", {
      email: "member@example.com",
      password: "password-one",
    });
    expect(login.status).toBe(200);
  });

  it("treats an account without a password like any wrong login", async () => {
    const dir = (await start()).dir + "-nopw";
    const db = openDb(dir);
    importSnapshot(db, {
      players: [],
      games: [],
      seats: [],
      rounds: [],
      turns: [],
      users: [{ id: "u1", email: "No.Pw@Example.com" }],
    });
    db.close();
    const api = await start({ dataDir: dir });
    const login = await api.post("/auth/login", {
      email: "no.pw@example.com",
      password: "password123",
    });
    expect([login.status, login.body]).toEqual([
      401,
      { error: "Wrong email or password.", code: "bad_credentials" },
    ]);
    // Not even the timing-dummy password gets in.
    const dummy = await api.post("/auth/login", {
      email: "no.pw@example.com",
      password: "not-a-real-password",
    });
    expect(dummy.status).toBe(401);
    expect(
      (
        await api.post("/auth/signup", {
          email: "no.pw@example.com",
          password: "password123",
        })
      ).status
    ).toBe(409);
  });
});

describe("login with guestToken handoff", () => {
  it("transfers the claim when the account has no player", async () => {
    const api = await start();
    const account = await api.signup("acct@example.com");
    const guest = await api.guest();
    const game = newGame();
    await api.push(guest.token, ...game.actions);
    const before = (await api.get("/sync/pull?since=0")).body;

    const login = await api.post("/auth/login", {
      email: "acct@example.com",
      password: "password123",
      guestToken: guest.token,
    });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(account.user.id);

    const after = await api.get(`/sync/pull?since=${before.version}`);
    expect(after.body.version).toBe(before.version + 1);
    expect(after.body.puts.players).toEqual([
      {
        id: game.playerId,
        name: "Host",
        claimedBy: account.user.id,
        createdAt: expect.any(String),
      },
    ]);
  });

  it("merges the guest's player into the account's player", async () => {
    const api = await start();
    const account = await api.signup("acct@example.com");
    const mine = newGame();
    await api.push(account.token, ...mine.actions);
    const guest = await api.guest();
    const theirs = newGame();
    await api.push(guest.token, ...theirs.actions);

    const login = await api.post("/auth/login", {
      email: "acct@example.com",
      password: "password123",
      guestToken: guest.token,
    });
    expect(login.status).toBe(200);

    const { puts } = (await api.get("/sync/pull?since=0")).body;
    const players = Object.fromEntries(puts.players.map((p: any) => [p.id, p]));
    expect(players[theirs.playerId]).toMatchObject({
      mergedInto: mine.playerId,
      mergeLog: { into: mine.playerId, seats: [theirs.seatId] },
    });
    expect(players[mine.playerId].mergedInto).toBeUndefined();
    const seats = Object.fromEntries(puts.seats.map((s: any) => [s.id, s]));
    expect(seats[theirs.seatId].playerId).toBe(mine.playerId);
  });

  it("never fails the login because of handoff problems", async () => {
    const api = await start();
    await api.signup("acct@example.com");
    const login = (guestToken: unknown) =>
      api.post("/auth/login", {
        email: "acct@example.com",
        password: "password123",
        guestToken,
      });
    expect((await login("not-a-token")).status).toBe(200);
    expect((await login(12345)).status).toBe(200);
    // A guest token that belongs to a real account is ignored.
    const other = await api.signup("other@example.com");
    expect((await login(other.token)).status).toBe(200);
  });
});
