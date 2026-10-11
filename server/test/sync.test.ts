import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ChangeSet } from "../../shared/types";
import { action, newGame, start } from "./helpers";

describe("push", () => {
  it("requires a session", async () => {
    const api = await start();
    const res = await api.post("/sync/push", { actions: [] });
    expect([res.status, res.body.code]).toEqual([401, "not_signed_in"]);
    const bad = await api.post("/sync/push", { actions: [] }, "bogus");
    expect(bad.status).toBe(401);
  });

  it("applies actions in order and bumps the version once per action", async () => {
    const api = await start();
    const user = await api.guest();
    const game = newGame();
    const res = await api.push(user.token, ...game.actions);
    expect(res.results.map((r) => r.ok)).toEqual([true, true]);
    expect(res.version).toBe(2);
    expect((await api.get("/health")).body).toEqual({ ok: true, version: 2 });

    const { puts } = (await api.get("/sync/pull")).body;
    expect(puts.players).toHaveLength(1);
    expect(puts.games).toEqual([
      expect.objectContaining({ id: game.gameId, createdBy: user.user.id }),
    ]);
    expect(puts.rounds).toHaveLength(13);
    expect(puts.seats).toEqual([
      {
        id: game.seatId,
        gameId: game.gameId,
        playerId: game.playerId,
        orderNumber: 0,
      },
    ]);
  });

  it("is idempotent: the same action id twice is applied once", async () => {
    const api = await start();
    const user = await api.guest();
    const id = randomUUID();
    const make = () =>
      action("createPlayer", { playerId: randomUUID(), name: "Once" }, id);
    const first = await api.push(user.token, make());
    const second = await api.push(user.token, make());
    expect(first.results).toEqual([{ id, ok: true }]);
    expect(second.results).toEqual([{ id, ok: true }]);
    expect(second.version).toBe(first.version);
    const players = (await api.get("/sync/pull")).body.puts.players;
    expect(players).toHaveLength(1);
  });

  it("returns the ActionError code and rolls back a rejected action", async () => {
    const api = await start();
    const alice = await api.guest();
    const bob = await api.guest();
    const game = newGame();
    await api.push(alice.token, ...game.actions);
    const before = (await api.get("/sync/pull")).body;

    // Bob isn't the creator: rejected, and the batch continues.
    const turnId = randomUUID();
    const res = await api.push(
      bob.token,
      action("placeBid", {
        turnId,
        roundId: game.roundIds[0],
        playerId: game.playerId,
        bid: 1,
      }),
      action("createPlayer", { playerId: randomUUID(), name: "Bob's" })
    );
    expect(res.results[0]).toMatchObject({ ok: false, code: "forbidden" });
    expect(res.results[1].ok).toBe(true);

    const after = (await api.get(`/sync/pull?since=${before.version}`)).body;
    expect(after.puts.turns).toBeUndefined();
    expect(after.puts.players).toHaveLength(1);
    expect(after.version).toBe(before.version + 1);
  });

  it("rolls back a rejected action's partial writes and lets it be retried", async () => {
    const api = await start();
    const user = await api.guest();
    const id = randomUUID();
    const bad = action(
      "placeBid",
      { turnId: "t", roundId: "missing", playerId: "p", bid: 1 },
      id
    );
    const res = await api.push(user.token, bad);
    expect(res.results[0]).toMatchObject({ id, ok: false, code: "not_found" });
    expect(res.version).toBe(0);
    // Rejected ids aren't remembered, so the same id can succeed later.
    const retry = await api.push(
      user.token,
      action("createPlayer", { playerId: "p1", name: "Ok" }, id)
    );
    expect(retry.results[0].ok).toBe(true);
  });

  it("reports malformed actions without failing the batch", async () => {
    const api = await start();
    const user = await api.guest();
    const res = await api.post(
      "/sync/push",
      {
        actions: [
          { nope: true },
          null,
          { id: "x", name: "createPlayer", args: null },
        ],
      },
      user.token
    );
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: any) => r.code)).toEqual([
      "invalid",
      "invalid",
      "invalid",
    ]);
    expect(
      (await api.post("/sync/push", { actions: "no" }, user.token)).status
    ).toBe(400);
  });

  it("does not let a client set server-only context", async () => {
    const api = await start();
    const alice = await api.guest();
    const bob = await api.guest();
    const mine = newGame();
    await api.push(alice.token, ...mine.actions);
    const theirs = newGame();
    await api.push(bob.token, ...theirs.actions);
    const forged = {
      ...action("mergePlayers", {
        fromId: theirs.playerId,
        intoId: mine.playerId,
      }),
      internal: { allowClaimedFrom: bob.user.id },
    };
    const res = await api.push(alice.token, forged);
    expect(res.results[0].ok).toBe(false);
  });

  it("limits body sizes", async () => {
    const api = await start();
    const user = await api.guest();
    const big = await api.post("/auth/login", {
      email: "a@b.co",
      password: "x".repeat(20_000),
    });
    expect(big.status).toBe(413);
    const pad = "x".repeat(100 * 1024);
    const ok = await api.post("/sync/push", { actions: [], pad }, user.token);
    expect(ok.status).toBe(200);
    const huge = await api.post(
      "/sync/push",
      { actions: [], pad: pad.repeat(3) },
      user.token
    );
    expect(huge.status).toBe(413);
  });

  it("returns 404 JSON for unknown routes", async () => {
    const api = await start();
    const res = await api.get("/nope");
    expect([res.status, res.body.code]).toEqual([404, "not_found"]);
    expect((await api.get("/sync/push")).status).toBe(404);
  });
});

describe("pull", () => {
  it("returns a full snapshot with reset for since=0 and a missing since", async () => {
    const api = await start();
    const empty = (await api.get("/sync/pull?since=0")).body;
    expect(empty).toEqual({ version: 0, puts: {}, deletes: {}, reset: true });

    const user = await api.guest();
    const game = newGame();
    await api.push(user.token, ...game.actions);
    const snap = (await api.get("/sync/pull?since=0")).body;
    expect(snap.reset).toBe(true);
    expect(snap.version).toBe(2);
    expect(snap.deletes).toEqual({});
    expect(Object.keys(snap.puts).sort()).toEqual([
      "games",
      "players",
      "rounds",
      "seats",
    ]);
    expect((await api.get("/sync/pull")).body).toEqual(snap);
    expect(JSON.stringify(snap)).not.toMatch(/password|token|email/);
  });

  it("returns only newer rows, with deletes, for incremental pulls", async () => {
    const api = await start();
    const user = await api.guest();
    const game = newGame();
    const turnId = randomUUID();
    const bid = action("placeBid", {
      turnId,
      roundId: game.roundIds[0],
      playerId: game.playerId,
      bid: 3,
    });
    const res = await api.push(user.token, ...game.actions, bid);
    expect(res.version).toBe(3);

    const incremental = (await api.get("/sync/pull?since=2")).body;
    expect(incremental).toEqual({
      version: 3,
      puts: {
        turns: [
          {
            id: turnId,
            roundId: game.roundIds[0],
            playerId: game.playerId,
            bid: 3,
          },
        ],
      },
      deletes: {},
    });

    await api.push(user.token, action("deleteTurn", { turnId }));
    const afterDelete = (await api.get("/sync/pull?since=3")).body;
    expect(afterDelete).toEqual({
      version: 4,
      puts: {},
      deletes: { turns: [turnId] },
    });

    // The tombstone is invisible to a fresh snapshot and to later actions.
    const snap = (await api.get("/sync/pull?since=0")).body;
    expect(snap.puts.turns).toBeUndefined();
    expect(snap.deletes).toEqual({});
    const again = await api.push(
      user.token,
      action("setScore", { turnId, score: 1 })
    );
    expect(again.results[0]).toMatchObject({ ok: false, code: "not_found" });

    // Re-creating a row with the same id brings it back.
    await api.push(
      user.token,
      action("placeBid", {
        turnId,
        roundId: game.roundIds[0],
        playerId: game.playerId,
        bid: 2,
      })
    );
    const back = (await api.get("/sync/pull?since=4")).body;
    expect(back.puts.turns).toEqual([
      expect.objectContaining({ id: turnId, bid: 2 }),
    ]);
    expect(back.deletes).toEqual({});
  });

  it("returns a snapshot when since is ahead of the server", async () => {
    const api = await start();
    const res = (await api.get("/sync/pull?since=99")).body;
    expect(res.reset).toBe(true);
  });
});

// Reads SSE events from a stream, one parsed ChangeSet at a time.
async function openStream(
  url: string,
  since = 0,
  headers: Record<string, string> = {}
) {
  const controller = new AbortController();
  const res = await fetch(`${url}/sync/stream?since=${since}`, {
    signal: controller.signal,
    headers,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const next = async (): Promise<{ changes?: ChangeSet; comment?: string }> => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const chunk = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (chunk.startsWith("data: "))
          return { changes: JSON.parse(chunk.slice(6)) };
        return { comment: chunk };
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { res, next, close: () => controller.abort() };
}

describe("stream", () => {
  it("sends the current state, then a ChangeSet per applied version", async () => {
    const api = await start();
    const alice = await api.guest();
    const game = newGame();
    await api.push(alice.token, ...game.actions);

    // No auth needed to watch.
    const stream = await openStream(api.url);
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get("content-type")).toBe("text/event-stream");
    expect(stream.res.headers.get("cache-control")).toBe("no-store");
    expect(stream.res.headers.get("x-accel-buffering")).toBe("no");
    const first = (await stream.next()).changes!;
    expect(first.reset).toBe(true);
    expect(first.version).toBe(2);

    // Another client pushes; the stream sees exactly that version's rows.
    const bob = await api.guest();
    const playerId = randomUUID();
    await api.push(
      bob.token,
      action("createPlayer", { playerId, name: "Bob" })
    );
    const update = (await stream.next()).changes!;
    expect(update.version).toBe(3);
    expect(update.reset).toBeUndefined();
    expect(update.puts.players).toEqual([
      expect.objectContaining({ id: playerId, name: "Bob" }),
    ]);

    // A delete is broadcast as a delete.
    const turnId = randomUUID();
    await api.push(
      alice.token,
      action("placeBid", {
        turnId,
        roundId: game.roundIds[0],
        playerId: game.playerId,
        bid: 1,
      }),
      action("deleteTurn", { turnId })
    );
    const bidSet = (await stream.next()).changes!;
    expect(bidSet.version).toBe(4);
    expect((await stream.next()).changes!.deletes.turns).toEqual([turnId]);
    stream.close();
  });

  it("starts from the given since and skips no-op and rejected actions", async () => {
    const api = await start();
    const user = await api.guest();
    const playerId = randomUUID();
    await api.push(user.token, action("createPlayer", { playerId, name: "A" }));
    const stream = await openStream(api.url, 1);
    expect(await stream.next()).toEqual({
      changes: { version: 1, puts: {}, deletes: {} },
    });

    await api.push(
      user.token,
      action("createPlayer", { playerId, name: "A" }), // no-op, same player
      action("deleteGame", { gameId: "missing" }) // rejected
    );
    await api.push(
      user.token,
      action("createPlayer", { playerId: randomUUID(), name: "B" })
    );
    const update = (await stream.next()).changes!;
    expect(update.version).toBe(2);
    stream.close();
  });

  it("sends heartbeat comments and cleans up closed streams", async () => {
    const api = await start({ pingMs: 30 });
    const stream = await openStream(api.url);
    await stream.next();
    expect(await stream.next()).toEqual({ comment: ": ping" });
    stream.close();
    // The server keeps working (and doesn't write to the dead stream).
    await new Promise((r) => setTimeout(r, 100));
    expect((await api.get("/health")).status).toBe(200);
  });

  it("shuts down with streams still open", async () => {
    const api = await start();
    const stream = await openStream(api.url);
    await stream.next();
    // afterEach closes the server; it must not hang on the open stream.
  });
});
