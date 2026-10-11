import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChangeSet } from "../../shared/types";
import { openDb } from "../src/db";
import { ipKey } from "../src/http";
import { action, newGame, rawRequest, start, tempDir } from "./helpers";
import type { Api } from "./helpers";

async function openStream(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal, headers });
  return { res, close: () => controller.abort() };
}

async function readEvent(res: Response): Promise<ChangeSet> {
  const reader = res.body!.getReader();
  let text = "";
  while (!text.includes("\n\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stream ended");
    text += new TextDecoder().decode(value);
  }
  reader.releaseLock();
  return JSON.parse(text.slice(6, text.indexOf("\n\n")));
}

describe("HTTP robustness", () => {
  it("answers 400 to a malformed path and keeps running", async () => {
    const api = await start();
    const status = await rawRequest(
      api.url,
      "GET /\\[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"
    );
    expect(status).toMatch(/ 400 /);
    expect((await api.get("/health")).status).toBe(200);
  });

  it("rejects an oversized chunked body (no content-length)", async () => {
    const api = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        api.url + "/auth/login",
        { method: "POST", headers: { "content-type": "application/json" } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        }
      );
      req.on("error", reject);
      req.write('{"email":"');
      for (let i = 0; i < 20; i++) req.write("x".repeat(1024));
      req.end('"}');
    });
    expect(status).toBe(413);
    expect((await api.get("/health")).status).toBe(200);
  });

  it("copes with absurd emails", async () => {
    const api = await start();
    const res = await api.post("/auth/login", {
      email: "a".repeat(5000) + "@example.com",
      password: "x",
    });
    expect(res.status).toBe(401);
  });

  it("buckets IPv6 clients by /64", () => {
    expect(ipKey("203.0.113.9")).toBe("203.0.113.9");
    expect(ipKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
    const a = ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(a).toBe(ipKey("2001:0db8:0001:0002::1"));
    expect(a).not.toBe(ipKey("2001:db8:1:3::1"));
    expect(ipKey("2001:db8::1")).toBe(ipKey("2001:db8:0:0:5::9"));
  });

  it("rate limits across one IPv6 /64", async () => {
    const api = await start();
    const attempt = (n: number) =>
      api.post(
        "/auth/login",
        { email: `v6-${n}@example.com`, password: "x" },
        undefined,
        { "x-forwarded-for": `2001:db8:1:2::${n.toString(16)}` }
      );
    for (let i = 0; i < 30; i++) expect((await attempt(i)).status).toBe(401);
    expect((await attempt(99)).status).toBe(429);
  });
});

describe("storage", () => {
  it("creates the data directory and database private to the server", async () => {
    const dir = path.join(tempDir(), "data");
    await start({ dataDir: dir });
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(dir, "whist.db")).mode & 0o777).toBe(0o600);
  });

  it("refuses null primary keys", () => {
    const db = openDb(tempDir());
    expect(() =>
      db.sql.exec(
        "INSERT INTO players (id, name, version) VALUES (NULL, 'x', 1)"
      )
    ).toThrow(/NOT NULL/);
    db.close();
  });

  it("keeps data and applied action ids across a restart", async () => {
    const first = await start();
    const user = await first.guest();
    const game = newGame();
    const [create, make] = game.actions;
    await first.push(user.token, create, make);
    const before = (await first.get("/sync/pull?since=0")).body;
    await first.close();

    const second = await start({ dataDir: first.dir });
    expect((await second.get("/sync/pull?since=0")).body).toEqual(before);
    // The old session still works, and a replayed action is still a no-op.
    const replay = await second.push(user.token, create);
    expect(replay).toEqual({
      results: [{ id: create.id, ok: true }],
      version: 2,
    });
  });

  it("can be closed more than once", async () => {
    const api = await start();
    await api.close();
    await api.close();
  });
});

describe("admin bootstrap", () => {
  const claim = (api: Api, token: string, session?: string) =>
    api.post("/auth/claim-admin", { token }, session);

  it("is off unless a bootstrap token is configured", async () => {
    const api = await start();
    const user = await api.signup("a@example.com");
    expect((await claim(api, "anything", user.token)).status).toBe(404);
  });

  it("needs a signed-in, non-guest user with the right token", async () => {
    const api = await start({ adminBootstrapToken: "s3cret" });
    expect((await claim(api, "s3cret")).status).toBe(401);
    const guest = await api.guest();
    expect((await claim(api, "s3cret", guest.token)).status).toBe(403);
    const user = await api.signup("a@example.com");
    const wrong = await claim(api, "nope", user.token);
    expect([wrong.status, wrong.body.code]).toEqual([403, "forbidden"]);
    expect((await claim(api, "", user.token)).status).toBe(403);
    // Still not an admin after failures.
    const link = await api.post(
      "/auth/reset-link",
      { email: "a@example.com" },
      user.token
    );
    expect(link.status).toBe(403);
  });

  it("makes exactly one admin", async () => {
    const api = await start({
      adminBootstrapToken: "s3cret",
      publicUrl: "https://example.test/app",
    });
    const first = await api.signup("first@example.com");
    const second = await api.signup("second@example.com");
    expect((await claim(api, "s3cret", first.token)).status).toBe(200);

    const taken = await claim(api, "s3cret", second.token);
    expect([taken.status, taken.body.code]).toEqual([403, "admin_exists"]);
    // Even the admin can't claim twice, and the loser is no admin.
    expect((await claim(api, "s3cret", first.token)).status).toBe(403);
    const link = (token: string) =>
      api.post("/auth/reset-link", { email: "second@example.com" }, token);
    expect((await link(second.token)).status).toBe(403);
    const ok = await link(first.token);
    expect(ok.status).toBe(200);
    expect(ok.body.url).toMatch(
      /^https:\/\/example\.test\/app\/reset#[\w-]{43}$/
    );
  });

  it("is not granted by registering an admin's email address", async () => {
    const api = await start({ adminBootstrapToken: "s3cret" });
    const squatter = await api.signup("boss@example.com");
    const res = await api.post(
      "/auth/reset-link",
      { email: "boss@example.com" },
      squatter.token
    );
    expect(res.status).toBe(403);
  });
});

describe("sessions after password changes", () => {
  it("a reset signs the user out everywhere and retires other links", async () => {
    const api = await start({ adminBootstrapToken: "s3cret" });
    const admin = await api.signup("admin@example.com");
    await api.post("/auth/claim-admin", { token: "s3cret" }, admin.token);
    const member = await api.signup("member@example.com");
    const second = (
      await api.post("/auth/login", {
        email: "member@example.com",
        password: "password123",
      })
    ).body;

    const make = async () =>
      (
        await api.post(
          "/auth/reset-link",
          { email: "member@example.com" },
          admin.token
        )
      ).body.url.split("#")[1];
    const [a, b] = [await make(), await make()];
    const reset = await api.post("/auth/reset", {
      token: a,
      password: "brand-new-pw",
    });
    expect(reset.status).toBe(200);

    expect((await api.get("/auth/me", member.token)).status).toBe(401);
    expect((await api.get("/auth/me", second.token)).status).toBe(401);
    expect((await api.get("/auth/me", reset.body.token)).status).toBe(200);
    const other = await api.post("/auth/reset", {
      token: b,
      password: "another-pw-1",
    });
    expect([other.status, other.body.code]).toEqual([400, "invalid_token"]);
    // The admin is unaffected.
    expect((await api.get("/auth/me", admin.token)).status).toBe(200);
  });

  it("changing the password signs out other sessions but not this one", async () => {
    const api = await start();
    const first = await api.signup("pw@example.com");
    const second = (
      await api.post("/auth/login", {
        email: "pw@example.com",
        password: "password123",
      })
    ).body;
    const res = await api.post(
      "/auth/password",
      { password: "newpassword1" },
      second.token
    );
    expect(res.status).toBe(200);
    expect((await api.get("/auth/me", first.token)).status).toBe(401);
    expect((await api.get("/auth/me", second.token)).status).toBe(200);
  });
});

// Players claimed by `token`'s user, from the public snapshot.
async function claims(api: Api): Promise<Record<string, any>> {
  const { puts } = (await api.get("/sync/pull?since=0")).body;
  return Object.fromEntries(puts.players.map((p: any) => [p.id, p]));
}

describe("guest handoff on login", () => {
  const credentials = { email: "acct@example.com", password: "password123" };

  it("hands over only the guest's player with the most seats", async () => {
    const api = await start();
    const account = await api.signup(credentials.email);
    const guest = await api.guest();
    const busy = newGame();
    await api.push(guest.token, ...busy.actions);
    await api.push(guest.token, ...newGame(busy.playerId).actions); // 2nd seat
    const quiet = newGame();
    await api.push(guest.token, ...quiet.actions);
    const tie = newGame();
    await api.push(guest.token, ...tie.actions);

    const login = await api.post("/auth/login", {
      ...credentials,
      guestToken: guest.token,
    });
    expect(login.status).toBe(200);
    const players = await claims(api);
    expect(players[busy.playerId].claimedBy).toBe(account.user.id);
    // The others are released rather than left claimed by a dead guest.
    expect(players[quiet.playerId].claimedBy).toBeUndefined();
    expect(players[tie.playerId].claimedBy).toBeUndefined();
  });

  it("breaks ties by smallest player id", async () => {
    const api = await start();
    const account = await api.signup(credentials.email);
    const guest = await api.guest();
    const ids = ["b-player", "a-player", "c-player"];
    for (const id of ids) await api.push(guest.token, ...newGame(id).actions);
    await api.post("/auth/login", { ...credentials, guestToken: guest.token });
    const players = await claims(api);
    expect(players["a-player"].claimedBy).toBe(account.user.id);
    expect(players["b-player"].claimedBy).toBeUndefined();
  });

  it("merges into the account's player with the most seats", async () => {
    const api = await start();
    const account = await api.signup(credentials.email);
    const small = newGame();
    const big = newGame();
    await api.push(account.token, ...small.actions, ...big.actions);
    await api.push(account.token, ...newGame(big.playerId).actions);
    const guest = await api.guest();
    const theirs = newGame();
    await api.push(guest.token, ...theirs.actions);

    await api.post("/auth/login", { ...credentials, guestToken: guest.token });
    const players = await claims(api);
    expect(players[theirs.playerId].mergedInto).toBe(big.playerId);
    expect(players[small.playerId].mergedInto).toBeUndefined();
  });

  it("releases the guest's player when the merge is rejected", async () => {
    const api = await start();
    const account = await api.signup(credentials.email);
    const shared = newGame();
    await api.push(account.token, ...shared.actions);
    const guest = await api.guest();
    // The guest's player sits in the same game as the account's, so they can't merge.
    const pg = "guest-player";
    await api.push(
      guest.token,
      action("createPlayer", { playerId: pg, name: "Guest", claim: true }),
      action("addSeat", {
        seatId: "guest-seat",
        gameId: shared.gameId,
        playerId: pg,
        orderNumber: 1,
      })
    );

    const login = await api.post("/auth/login", {
      ...credentials,
      guestToken: guest.token,
    });
    expect(login.status).toBe(200);
    const players = await claims(api);
    expect(players[pg].mergedInto).toBeUndefined();
    expect(players[pg].claimedBy).toBeUndefined(); // claimable again
    expect(players[shared.playerId].claimedBy).toBe(account.user.id);
  });

  it("retires the guest's sessions, and ignores a guest with nothing claimed", async () => {
    const api = await start();
    await api.signup(credentials.email);
    const guest = await api.guest();
    await api.post("/auth/login", { ...credentials, guestToken: guest.token });
    expect((await api.get("/auth/me", guest.token)).status).toBe(401);
  });

  it("does not touch a guest session when the password is wrong", async () => {
    const api = await start();
    await api.signup(credentials.email);
    const guest = await api.guest();
    const bad = await api.post("/auth/login", {
      ...credentials,
      password: "wrong-password",
      guestToken: guest.token,
    });
    expect(bad.status).toBe(401);
    expect((await api.get("/auth/me", guest.token)).status).toBe(200);
  });
});

describe("push failures and idempotency", () => {
  it("applies a duplicate pushed concurrently exactly once", async () => {
    const api = await start();
    const user = await api.guest();
    const id = "same-id";
    const push = () =>
      api.push(
        user.token,
        action("createPlayer", { playerId: "p1", name: "Once" }, id)
      );
    const all = await Promise.all([push(), push(), push(), push(), push()]);
    expect(all.every((r) => r.results[0].ok)).toBe(true);
    expect((await api.get("/health")).body.version).toBe(1);
    expect(
      (await api.get("/sync/pull?since=0")).body.puts.players
    ).toHaveLength(1);
  });

  it("rejects an action id that another user already used", async () => {
    const api = await start();
    const alice = await api.guest();
    const bob = await api.guest();
    const id = "shared-id";
    await api.push(
      alice.token,
      action("createPlayer", { playerId: "pa", name: "A" }, id)
    );
    const res = await api.push(
      bob.token,
      action("createPlayer", { playerId: "pb", name: "B" }, id)
    );
    expect(res.results[0]).toMatchObject({ ok: false, code: "conflict" });
    const players = (await api.get("/sync/pull?since=0")).body.puts.players;
    expect(players.map((p: any) => p.id)).toEqual(["pa"]);
  });

  it("answers 503 (not ok:false) when the database fails, and can be retried", async () => {
    const api = await start();
    const user = await api.guest();
    const game = newGame();
    // Make inserting a seat fail, like a disk error would.
    const db = openDb(api.dir);
    db.sql.exec(
      "CREATE TRIGGER boom BEFORE INSERT ON seats BEGIN SELECT RAISE(ABORT, 'boom'); END"
    );

    const fail = await api.post(
      "/sync/push",
      { actions: game.actions },
      user.token
    );
    expect(fail.status).toBe(503);
    expect(fail.body).toEqual({
      error: "Something went wrong. Try again.",
      code: "server_error",
    });
    // The first action was committed; the failed one left nothing behind.
    const mid = (await api.get("/sync/pull?since=0")).body;
    expect(mid.puts.players).toHaveLength(1);
    expect(mid.puts.games).toBeUndefined();

    db.sql.exec("DROP TRIGGER boom");
    db.close();
    const retry = await api.push(user.token, ...game.actions);
    expect(retry.results.map((r) => r.ok)).toEqual([true, true]);
    expect((await api.get("/sync/pull?since=0")).body.puts.games).toHaveLength(
      1
    );
  });
});

describe("pull and stream limits", () => {
  it("includes deletes when streaming from a version", async () => {
    const api = await start();
    const user = await api.guest();
    const game = newGame();
    const bid = action("placeBid", {
      turnId: "t1",
      roundId: game.roundIds[0],
      playerId: game.playerId,
      bid: 1,
    });
    await api.push(user.token, ...game.actions, bid);
    const { version } = await api.push(
      user.token,
      action("deleteTurn", { turnId: "t1" })
    );
    const stream = await openStream(
      `${api.url}/sync/stream?since=${version - 1}`
    );
    const first = await readEvent(stream.res);
    expect(first).toEqual({ version, puts: {}, deletes: { turns: ["t1"] } });
    stream.close();
  });

  it("limits open streams per IP and in total", async () => {
    const api = await start({ maxStreamsPerIp: 2, maxStreams: 3 });
    const open = (ip: string) =>
      openStream(`${api.url}/sync/stream?since=1`, { "x-forwarded-for": ip });
    const a1 = await open("1.1.1.1");
    const a2 = await open("1.1.1.1");
    expect(a1.res.status).toBe(200);
    expect(a2.res.status).toBe(200);
    const a3 = await open("1.1.1.1");
    expect(a3.res.status).toBe(429);
    expect(((await a3.res.json()) as any).code).toBe("too_many_streams");

    const b1 = await open("2.2.2.2");
    expect(b1.res.status).toBe(200);
    expect((await open("3.3.3.3")).res.status).toBe(429); // 3 open in total

    // Closing one frees a slot.
    a1.close();
    await new Promise((r) => setTimeout(r, 100));
    const again = await open("1.1.1.1");
    expect(again.res.status).toBe(200);
    for (const s of [a2, b1, again]) s.close();
  });

  it("rate limits full snapshots but not incremental pulls", async () => {
    const api = await start();
    const ip = { "x-forwarded-for": "5.5.5.5" };
    const pull = (since: number) =>
      fetch(`${api.url}/sync/pull?since=${since}`, { headers: ip });
    for (let i = 0; i < 20; i++) expect((await pull(0)).status).toBe(200);
    const limited = await pull(0);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as any).code).toBe("rate_limited");
    expect((await pull(0)).status).toBe(429);
    // Streams that need a snapshot count too; incremental ones don't.
    expect(
      (await fetch(`${api.url}/sync/stream`, { headers: ip })).status
    ).toBe(429);
    expect((await pull(0)).status).toBe(429);
    const user = await api.guest();
    await api.push(
      user.token,
      action("createPlayer", { playerId: "p", name: "P" })
    );
    expect((await pull(1)).status).toBe(200);
    // Another client is unaffected.
    expect((await api.get("/sync/pull?since=0")).status).toBe(200);
  });
});
