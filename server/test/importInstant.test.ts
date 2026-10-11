import { describe, expect, it } from "vitest";
import { LEGACY_CREATOR, transformInstant } from "../src/importInstant";
import { newGame, start } from "./helpers";

// A small InstantDB export: links come back as arrays of one (or objects).
const fixture = {
  players: [
    { id: "p1", name: "Ann", claimedBy: "instant-user-1" },
    { id: "p2", name: "Bob", claimedBy: "instant-user-2" },
    {
      id: "p3",
      name: "Cy",
      mergedInto: "p1",
      mergedAt: "2024-05-01T00:00:00.000Z",
      mergeLog: {
        into: "p1",
        playersOrders: ["s3"],
        turns: ["t3"],
        dealerGames: [],
      },
    },
    { id: "p4", name: "Lost", mergedInto: "gone", mergeLog: { into: "gone" } },
    { name: "No id" },
    { id: "p1", name: "Duplicate" },
  ],
  games: [
    {
      id: "g1",
      createdAt: "2024-01-01T00:00:00.000Z",
      createdBy: "instant-user-1",
      initialDealerId: "p2",
      playersOrders: [
        { id: "s1", orderNumber: 0, player: [{ id: "p1" }] },
        { id: "s2", orderNumber: 1, player: { id: "p2" } },
        { id: "s3", orderNumber: 2, player: [{ id: "p3" }] },
        { id: "s-orphan", orderNumber: 3, player: [] },
        { id: "s-ghost", orderNumber: 4, player: [{ id: "nobody" }] },
      ],
      rounds: [
        {
          id: "r0",
          roundNumber: 0,
          turns: [
            { id: "t1", bid: 2, score: 12, player: [{ id: "p1" }] },
            { id: "t2", bid: 0, player: [{ id: "p2" }] },
            { id: "t3", player: { id: "p3" } },
            { id: "t-orphan", bid: 1 },
          ],
        },
        { id: "r1", roundNumber: 1, turns: [] },
        {
          id: "r-bad",
          roundNumber: 13,
          turns: [{ id: "t-bad", player: [{ id: "p1" }] }],
        },
      ],
    },
    {
      id: "g2",
      createdAt: "2024-02-01T00:00:00.000Z",
      createdBy: "instant-user-2",
      deletedAt: "2024-02-02T00:00:00.000Z",
      initialDealerId: "nobody",
      playersOrders: [{ id: "s4", orderNumber: 0, player: [{ id: "p2" }] }],
      rounds: [],
    },
    {
      id: "g-bad",
      playersOrders: [{ id: "s5", orderNumber: 0, player: [{ id: "p1" }] }],
      rounds: [],
    },
  ],
};

describe("transformInstant", () => {
  const { snapshot, counts } = transformInstant(fixture);

  it("clears claims, imports no users and keeps ids", () => {
    expect(snapshot.users).toBeUndefined();
    expect(snapshot.players.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(snapshot.players.every((p) => !("claimedBy" in p))).toBe(true);
  });

  it("converts merges, dropping those pointing at missing players", () => {
    expect(snapshot.players[2]).toEqual({
      id: "p3",
      name: "Cy",
      mergedInto: "p1",
      mergedAt: "2024-05-01T00:00:00.000Z",
      mergeLog: { into: "p1", seats: ["s3"], turns: ["t3"], dealerGames: [] },
    });
    expect(snapshot.players[3]).toEqual({ id: "p4", name: "Lost" });
  });

  it("builds games, seats, rounds and turns with their parents", () => {
    expect(snapshot.games).toEqual([
      {
        id: "g1",
        createdAt: "2024-01-01T00:00:00.000Z",
        createdBy: "instant-user-1",
        initialDealerId: "p2",
      },
      // The dealer doesn't exist, so it is left out.
      {
        id: "g2",
        createdAt: "2024-02-01T00:00:00.000Z",
        createdBy: "instant-user-2",
        deletedAt: "2024-02-02T00:00:00.000Z",
      },
    ]);
    expect(snapshot.seats).toEqual([
      { id: "s1", gameId: "g1", playerId: "p1", orderNumber: 0 },
      { id: "s2", gameId: "g1", playerId: "p2", orderNumber: 1 },
      { id: "s3", gameId: "g1", playerId: "p3", orderNumber: 2 },
      { id: "s4", gameId: "g2", playerId: "p2", orderNumber: 0 },
    ]);
    expect(snapshot.rounds).toEqual([
      { id: "r0", gameId: "g1", roundNumber: 0 },
      { id: "r1", gameId: "g1", roundNumber: 1 },
    ]);
    expect(snapshot.turns).toEqual([
      { id: "t1", roundId: "r0", playerId: "p1", bid: 2, score: 12 },
      { id: "t2", roundId: "r0", playerId: "p2", bid: 0 },
      { id: "t3", roundId: "r0", playerId: "p3" },
    ]);
  });

  it("counts what it kept and what it skipped", () => {
    expect(counts).toEqual({
      players: 4,
      games: 2,
      seats: 4,
      rounds: 2,
      turns: 3,
      skipped: { players: 2, games: 1, seats: 3, rounds: 1, turns: 2 },
    });
  });

  it("keeps games that have no creator, owned by nobody", () => {
    const { snapshot, counts } = transformInstant({
      players: [{ id: "p1", name: "Oli" }],
      games: [
        {
          id: "old",
          createdAt: "2024-08-23T16:04:09.134Z",
          playersOrders: [{ id: "s1", orderNumber: 0, player: [{ id: "p1" }] }],
          rounds: [
            {
              id: "r1",
              roundNumber: 0,
              turns: [{ id: "t1", bid: 1, score: 11, player: [{ id: "p1" }] }],
            },
          ],
        },
      ],
    });
    expect(snapshot.games).toEqual([
      {
        id: "old",
        createdAt: "2024-08-23T16:04:09.134Z",
        createdBy: LEGACY_CREATOR,
      },
    ]);
    expect(snapshot.turns).toHaveLength(1);
    expect(counts.skipped.games).toBe(0);
  });

  it("rejects data that isn't an export", () => {
    expect(() => transformInstant(null)).toThrow(/players/);
    expect(() => transformInstant({ players: [] })).toThrow(/games/);
  });
});

describe("POST /admin/import", () => {
  const post = (url: string, body: unknown, token?: string) =>
    fetch(`${url}/admin/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-import-token": token } : {}),
      },
      body: JSON.stringify(body),
    });

  it("is disabled without IMPORT_TOKEN", async () => {
    const api = await start();
    expect((await post(api.url, fixture, "anything")).status).toBe(404);
  });

  it("checks the token before reading the body", async () => {
    const api = await start({ importToken: "import-secret" });
    expect((await post(api.url, fixture)).status).toBe(403);
    expect((await post(api.url, fixture, "wrong")).status).toBe(403);
    expect((await api.get("/sync/pull?since=0")).body.version).toBe(0);
  });

  it("imports the export once and serves it to clients", async () => {
    const api = await start({ importToken: "import-secret" });
    // Guests existing already must not get in the way.
    await api.guest();
    const stream = await fetch(`${api.url}/sync/stream?since=0`);
    const reader = stream.body!.getReader();
    await reader.read(); // the (empty) first event

    const res = await post(api.url, fixture, "import-secret");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      players: 4,
      games: 2,
      seats: 4,
      rounds: 2,
      turns: 3,
      skipped: { players: 2, games: 1, seats: 3, rounds: 1, turns: 2 },
    });

    const pull = (await api.get("/sync/pull?since=0")).body;
    expect(pull.version).toBe(1);
    expect(pull.puts.players).toHaveLength(4);
    expect(pull.puts.turns).toHaveLength(3);
    expect(pull.puts.players.some((p: any) => p.claimedBy)).toBe(false);

    // Streams already open get the data.
    const pushed = JSON.parse(
      new TextDecoder().decode((await reader.read()).value).slice(6)
    );
    expect(pushed).toMatchObject({ version: 1, reset: true });
    expect(pushed.puts.games).toHaveLength(2);
    await reader.cancel();

    // A second import is refused, as is importing over live data.
    expect((await post(api.url, fixture, "import-secret")).status).toBe(409);
  });

  it("refuses a database that already has games", async () => {
    const api = await start({ importToken: "import-secret" });
    const user = await api.guest();
    await api.push(user.token, ...newGame().actions);
    const res = await post(api.url, fixture, "import-secret");
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe("not_empty");
  });

  it("rejects a body that isn't an export", async () => {
    const api = await start({ importToken: "import-secret" });
    const res = await post(api.url, { hello: "world" }, "import-secret");
    expect(res.status).toBe(400);
  });

  it("accepts bodies far above the normal limits", async () => {
    const api = await start({ importToken: "import-secret" });
    const players = Array.from({ length: 20_000 }, (_, i) => ({
      id: `p${i}`,
      name: "x".repeat(30),
    }));
    const res = await post(api.url, { players, games: [] }, "import-secret");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).players).toBe(20_000);
  }, 30_000); // large body: slow on busy machines
});
