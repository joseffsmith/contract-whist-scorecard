import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionError } from "../../shared/types";
import type { RowOp } from "../../shared/types";
import { createSyncClient } from "./client";
import type {
  ActionRejection,
  NetworkSignal,
  SyncClient,
  SyncDeps,
} from "./client";
import { createFakeServer } from "./fakeServer";
import type { FakeServer } from "./fakeServer";
import { selectHomeGames } from "./selectors";
import { openStorage } from "./storage";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("Timed out waiting for condition");
    await sleep(3);
  }
}

function createNetwork(): NetworkSignal & { set(online: boolean): void } {
  let online = true;
  const listeners = new Set<() => void>();
  return {
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      online = next;
      listeners.forEach((listener) => listener());
    },
  };
}

const ROUNDS = Array.from({ length: 13 }, (_, i) => `r${i}`);

let server: FakeServer;
let clients: SyncClient[];
let networks: ReturnType<typeof createNetwork>[];
let idb: IDBFactory;
let ids: number;

// One "device": its own storage and network. Sharing `idb` between calls
// simulates reloading the same browser.
function newClient(
  options: {
    storage?: IDBFactory;
    batchSize?: number;
    grace?: number;
    deps?: Partial<SyncDeps>;
  } = {}
) {
  const network = createNetwork();
  network.set(!server.offline);
  networks.push(network);
  const client = createSyncClient({
    fetch: server.fetch,
    openStorage: () => openStorage(options.storage ?? idb),
    network,
    uuid: () => `a-${++ids}`,
    backoff: { minMs: 5, maxMs: 20 },
    streamGraceMs: options.grace ?? 20,
    batchSize: options.batchSize ?? 50,
    requestTimeoutMs: 1000,
    healthyMs: 30,
    ...options.deps,
  });
  clients.push(client);
  return client;
}

function goOffline() {
  server.offline = true;
  networks.forEach((n) => n.set(false));
}
function goOnline() {
  server.offline = false;
  networks.forEach((n) => n.set(true));
}

async function signedInClient(options?: Parameters<typeof newClient>[0]) {
  const client = newClient(options);
  await client.start();
  await client.signInAsGuest();
  await waitFor(() => client.getStatus() === "connected");
  return client;
}

const synced = (client: SyncClient) =>
  waitFor(() => client.getPendingCount() === 0);

const createGameArgs = (gameId: string, playerId = "p1") => ({
  gameId,
  roundIds: ROUNDS.map((r) => `${gameId}-${r}`),
  seatId: `${gameId}-seat`,
  playerId,
});

beforeEach(() => {
  server = createFakeServer();
  clients = [];
  networks = [];
  idb = new IDBFactory();
  ids = 0;
});

afterEach(() => {
  clients.forEach((client) => client.stop());
});

describe("hydration", () => {
  it("renders stored data on load with no connection", async () => {
    const first = await signedInClient();
    await first.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await first.dispatch("createGame", createGameArgs("g1"));
    await synced(first);
    await first.persisted();
    first.stop();

    goOffline();
    const second = newClient();
    await second.start();
    await second.ready;
    expect(second.getView().players.get("p1")?.name).toBe("Ann");
    expect(second.getView().rounds.size).toBe(13);
    expect(selectHomeGames(second.getView()).games).toHaveLength(1);
    expect(second.isLoading()).toBe(false);
    expect(second.getAuth().user?.isGuest).toBe(true);
    await waitFor(() => second.getStatus() === "offline");
  });

  it("is loading until the first pull when there is nothing stored", async () => {
    server.seed([
      { op: "put", table: "players", row: { id: "p1", name: "Ann" } },
    ]);
    const client = newClient();
    const states: boolean[] = [];
    client.subscribe(() => states.push(client.isLoading()));
    await client.start();
    expect(client.isLoading()).toBe(true);
    await waitFor(() => !client.isLoading());
    expect(client.getView().players.has("p1")).toBe(true);
    // Never flips back to loading.
    expect(states.lastIndexOf(true)).toBeLessThan(states.indexOf(false));
  });

  it("is not loading when offline with nothing stored", async () => {
    goOffline();
    const client = newClient();
    await client.start();
    expect(client.isLoading()).toBe(false);
    expect(client.getStatus()).toBe("offline");
  });
});

describe("dispatch", () => {
  it("applies locally, then syncs to the server", async () => {
    const client = await signedInClient();
    await client.dispatch("createPlayer", {
      playerId: "p1",
      name: "Ann",
      claim: true,
    });
    expect(client.getView().players.get("p1")?.claimedBy).toBe(
      client.getAuth().user?.id
    );
    await synced(client);
    expect(server.data.players.get("p1")?.name).toBe("Ann");
  });

  it("throws the ActionError for an invalid action and does not queue it", async () => {
    const client = await signedInClient();
    await synced(client);
    const error = await client
      .dispatch("placeBid", {
        turnId: "t1",
        roundId: "nope",
        playerId: "p1",
        bid: 1,
      })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ActionError);
    expect(error.code).toBe("not_found");
    expect(client.getPendingCount()).toBe(0);
    expect(server.log).toEqual([]);
  });

  it("refuses writes when signed out", async () => {
    const client = newClient();
    await client.start();
    const error = await client
      .dispatch("createPlayer", { playerId: "p1", name: "Ann" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(ActionError);
    expect(error.code).toBe("not_signed_in");
  });

  it("queues offline and keeps the queue across a reload", async () => {
    const first = await signedInClient();
    goOffline();
    await waitFor(() => first.getStatus() === "offline");
    await first.dispatch("createPlayer", { playerId: "p2", name: "Bob" });
    expect(first.getView().players.has("p2")).toBe(true);
    expect(first.getPendingCount()).toBe(1);
    first.stop();

    const second = newClient();
    await second.start();
    expect(second.getView().players.has("p2")).toBe(true);
    expect(second.getPendingCount()).toBe(1);
    expect(server.data.players.has("p2")).toBe(false);

    goOnline();
    await waitFor(() => server.data.players.has("p2"));
    await synced(second);
    expect(second.getView().players.has("p2")).toBe(true);
  });

  it("flushes in order on reconnect, across batches", async () => {
    const client = await signedInClient({ batchSize: 2 });
    goOffline();
    await waitFor(() => client.getStatus() === "offline");
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await client.dispatch("createGame", createGameArgs("g1"));
    await client.dispatch("placeBid", {
      turnId: "t1",
      roundId: "g1-r0",
      playerId: "p1",
      bid: 3,
    });
    await client.dispatch("setScore", { turnId: "t1", score: 12 });
    await client.dispatch("clearScore", { turnId: "t1" });
    expect(client.getView().turns.get("t1")?.score).toBeNull();
    expect(server.log).toEqual([]);

    goOnline();
    await synced(client);
    expect(server.log).toEqual(["a-1", "a-2", "a-3", "a-4", "a-5"]);
    expect(server.data.turns.get("t1")).toEqual({
      id: "t1",
      roundId: "g1-r0",
      playerId: "p1",
      bid: 3,
      score: null,
    });
  });
});

describe("acks and retries", () => {
  it("retries idempotently after a lost push response", async () => {
    const client = await signedInClient();
    server.loseNextPushResponse = true;
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await synced(client);
    expect(server.log).toEqual(["a-1"]);
    expect(server.version).toBe(1);
    expect(
      server.requests.filter((r) => r.path === "/sync/push").length
    ).toBeGreaterThanOrEqual(2);
    expect(client.getView().players.get("p1")?.name).toBe("Ann");
  });

  it("keeps retrying while the server is down, never losing or reordering", async () => {
    const client = await signedInClient();
    server.blockPush = true;
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await client.dispatch("createPlayer", { playerId: "p2", name: "Bob" });
    await sleep(60);
    expect(client.getPendingCount()).toBe(2);
    server.blockPush = false;
    await synced(client);
    expect(server.log).toEqual(["a-1", "a-2"]);
  });

  it("drops a rejected action and reports it", async () => {
    const client = await signedInClient();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await synced(client);
    const rejections: ActionRejection[] = [];
    client.onActionRejected((r) => rejections.push(r));

    goOffline();
    await waitFor(() => client.getStatus() === "offline");
    // Someone else claims Ann while we're away; we can't know yet.
    const other = server.addAccount("o@example.com", "pw");
    server.act(other, {
      id: "other-1",
      name: "claimPlayer",
      args: { playerId: "p1" },
    });
    await client.dispatch("claimPlayer", { playerId: "p1" });
    expect(client.getView().players.get("p1")?.claimedBy).toBe(
      client.getAuth().user?.id
    );

    goOnline();
    await waitFor(() => rejections.length === 1);
    expect(rejections[0].action.name).toBe("claimPlayer");
    expect(rejections[0].code).toBe("claimed");
    expect(rejections[0].error).toMatch(/claimed/);
    await synced(client);
    await waitFor(
      () => client.getView().players.get("p1")?.claimedBy === other.id
    );
  });
});

describe("rebase and no flicker", () => {
  it("rebases pending actions onto changes from other clients", async () => {
    const client = await signedInClient();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await synced(client);

    server.blockPush = true;
    await client.dispatch("createGame", createGameArgs("g1"));
    const other = server.addAccount("o@example.com", "pw");
    server.act(other, {
      id: "other-1",
      name: "createPlayer",
      args: { playerId: "p9", name: "Zed" },
    });
    await waitFor(() => client.getView().players.has("p9"));
    // Ours is still on top of the new snapshot.
    expect(client.getView().games.has("g1")).toBe(true);
    expect(client.getView().seats.size).toBe(1);
    expect(client.getPendingCount()).toBe(1);

    server.blockPush = false;
    await synced(client);
    expect(server.data.games.has("g1")).toBe(true);
    expect(client.getView().players.has("p9")).toBe(true);
  });

  it("skips pending actions that no longer apply, until the server answers", async () => {
    const client = await signedInClient();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await synced(client);

    server.blockPush = true;
    await client.dispatch("claimPlayer", { playerId: "p1" });
    const other = server.addAccount("o@example.com", "pw");
    // Someone else's claim lands first (a real server would have done so
    // before our push); the view must not blow up or show our claim.
    server.act(other, {
      id: "other-1",
      name: "claimPlayer",
      args: { playerId: "p1" },
    });
    await waitFor(
      () => client.getView().players.get("p1")?.claimedBy === other.id
    );
    expect(client.getPendingCount()).toBe(1);
    server.blockPush = false;
    await synced(client);
    expect(client.getView().players.get("p1")?.claimedBy).toBe(other.id);
  });

  it("keeps the optimistic change until the snapshot contains it", async () => {
    const client = await signedInClient({ grace: 150 });
    await synced(client);
    server.holdStream = true;

    const seen: boolean[] = [];
    client.subscribe(() => seen.push(client.getView().players.has("p9")));
    await client.dispatch("createPlayer", { playerId: "p9", name: "Zed" });
    await waitFor(() => server.data.players.has("p9"));
    await sleep(40);
    // The server has it and acked, but the stream hasn't delivered it.
    expect(client.getPendingCount()).toBe(1);
    expect(client.getView().players.has("p9")).toBe(true);

    server.releaseStream();
    await synced(client);
    expect(client.getView().players.has("p9")).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });

  it("pulls the acked change itself when the stream is slow", async () => {
    const client = await signedInClient({ grace: 10 });
    await synced(client);
    server.holdStream = true;
    const seen: boolean[] = [];
    client.subscribe(() => seen.push(client.getView().players.has("p9")));
    await client.dispatch("createPlayer", { playerId: "p9", name: "Zed" });
    await synced(client);
    expect(seen.every(Boolean)).toBe(true);
    expect(client.getView().players.has("p9")).toBe(true);
  });

  it("replaces all data on a reset snapshot", async () => {
    const client = await signedInClient();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await client.dispatch("createPlayer", { playerId: "p2", name: "Bob" });
    await synced(client);
    await waitFor(() => client.getView().players.size === 2);

    // The server is restored from a backup that never had Bob.
    server.data.players.delete("p2");
    server.broadcastReset();
    await waitFor(() => !client.getView().players.has("p2"));
    expect(client.getView().players.has("p1")).toBe(true);

    await client.persisted();
    client.stop();
    goOffline();
    const reloaded = newClient();
    await reloaded.start();
    expect([...reloaded.getView().players.keys()]).toEqual(["p1"]);
  });
});

describe("live updates and reconnecting", () => {
  it("shows one device's changes on another", async () => {
    const phone = await signedInClient();
    const watcher = newClient({ storage: new IDBFactory() });
    await watcher.start();
    await waitFor(() => watcher.getStatus() === "connected");
    await phone.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await waitFor(() => watcher.getView().players.has("p1"));
    expect(watcher.getAuth().user).toBeNull();
  });

  it("reconnects after the stream drops and catches up", async () => {
    const client = await signedInClient();
    const other = server.addAccount("o@example.com", "pw");
    server.offline = true;
    server.cutStreams();
    await waitFor(() => client.getStatus() !== "connected");
    server.act(other, {
      id: "other-1",
      name: "createPlayer",
      args: { playerId: "p9", name: "Zed" },
    });
    server.offline = false;
    await waitFor(() => client.getStatus() === "connected");
    await waitFor(() => client.getView().players.has("p9"));
  });

  it("goes offline with the network and reconnects immediately when it returns", async () => {
    const client = await signedInClient();
    goOffline();
    await waitFor(() => client.getStatus() === "offline");
    goOnline();
    await waitFor(() => client.getStatus() === "connected");
  });
});

describe("auth", () => {
  it("keeps the session across a reload, so auth works offline", async () => {
    const first = await signedInClient();
    const user = first.getAuth().user;
    await first.persisted();
    first.stop();
    goOffline();
    const second = newClient();
    await second.start();
    expect(second.getAuth()).toEqual({ isLoading: false, user });
  });

  it("is loading until hydrated", async () => {
    const client = newClient();
    expect(client.getAuth()).toEqual({ isLoading: true, user: null });
    await client.start();
    expect(client.getAuth()).toEqual({ isLoading: false, user: null });
  });

  it("upgrades a guest in place on sign up, keeping queued work", async () => {
    const client = await signedInClient();
    const guest = client.getAuth().user!;
    server.blockPush = true;
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    const user = await client.signUp("ann@example.com", "secret123");
    expect(user).toEqual({
      id: guest.id,
      email: "ann@example.com",
      isGuest: false,
    });
    expect(client.getAuth().user).toEqual(user);
    expect(client.getPendingCount()).toBe(1);
    server.blockPush = false;
    await synced(client);
    expect(server.data.players.has("p1")).toBe(true);
  });

  it("logs in sending the guest token, and pushes the guest's work first", async () => {
    server.addAccount("ann@example.com", "secret123");
    const client = await signedInClient();
    await client.dispatch("createPlayer", {
      playerId: "p1",
      name: "Guest Ann",
    });
    const user = await client.logIn("ann@example.com", "secret123");
    expect(user.isGuest).toBe(false);
    const login = server.requests.find((r) => r.path === "/auth/login")!;
    const guestPush = server.requests.find((r) => r.path === "/sync/push")!;
    expect(login.body.guestToken).toBe(guestPush.token);
    expect(server.data.players.has("p1")).toBe(true);
    expect(client.getPendingCount()).toBe(0);
  });

  it("surfaces the server's message and code", async () => {
    const client = newClient();
    await client.start();
    const error = await client
      .logIn("nobody@example.com", "nope")
      .catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Wrong email or password.");
    expect(error.code).toBe("bad_credentials");

    server.addAccount("ann@example.com", "secret123");
    const dupe = await client
      .signUp("ann@example.com", "secret123")
      .catch((e) => e);
    expect(dupe.code).toBe("has_account");
  });

  it("explains when offline", async () => {
    const client = newClient();
    await client.start();
    goOffline();
    const error = await client
      .signUp("a@example.com", "secret123")
      .catch((e) => e);
    expect(error.code).toBe("offline");
    expect(error.message).toMatch(/offline/i);
  });

  it("explains when the server can't be reached", async () => {
    const client = newClient();
    await client.start();
    server.offline = true; // the network claims to be up
    const error = await client
      .signUp("a@example.com", "secret123")
      .catch((e) => e);
    expect(error.code).toBe("network");
    expect(error.message).toMatch(/reach the server/i);
  });

  it("logOut clears the session and queue but keeps synced data", async () => {
    const client = await signedInClient();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await synced(client);
    server.blockPush = true;
    await client.dispatch("createPlayer", { playerId: "p2", name: "Bob" });
    expect(client.getPendingCount()).toBe(1);

    await client.logOut();
    expect(client.getAuth().user).toBeNull();
    expect(client.getPendingCount()).toBe(0);
    expect(client.getView().players.has("p1")).toBe(true);
    expect(client.getView().players.has("p2")).toBe(false);
    await waitFor(() => server.requests.some((r) => r.path === "/auth/logout"));

    await client.persisted();
    client.stop();
    goOffline();
    const reloaded = newClient();
    await reloaded.start();
    expect(reloaded.getAuth().user).toBeNull();
    expect(reloaded.getPendingCount()).toBe(0);
    expect(reloaded.getView().players.has("p1")).toBe(true);
  });

  it("keeps the queue when the server forgets the session, and resumes on sign in", async () => {
    server.addAccount("ann@example.com", "secret123");
    const client = newClient();
    await client.start();
    await client.logIn("ann@example.com", "secret123");
    await waitFor(() => client.getStatus() === "connected");

    server.forgetTokens();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await waitFor(() => client.getAuth().user === null);
    expect(client.getPendingCount()).toBe(1);
    expect(client.getView().players.has("p1")).toBe(true);
    const pushes = () =>
      server.requests.filter((r) => r.path === "/sync/push").length;
    const before = pushes();
    await sleep(50);
    expect(pushes()).toBe(before); // not pushing without a session

    await client.logIn("ann@example.com", "secret123");
    await synced(client);
    expect(server.data.players.has("p1")).toBe(true);
  });
});

describe("scale", () => {
  it("handles ~100 games of 13 rounds and 6 players", async () => {
    const client = await signedInClient();
    const userId = client.getAuth().user!.id;
    const ops: RowOp[] = [];
    for (let p = 0; p < 6; p++) {
      ops.push({
        op: "put",
        table: "players",
        row: { id: `p${p}`, name: `P${p}` },
      });
    }
    for (let g = 0; g < 100; g++) {
      ops.push({
        op: "put",
        table: "games",
        row: {
          id: `g${g}`,
          createdAt: "2026-01-01T00:00:00.000Z",
          createdBy: userId,
        },
      });
      for (let p = 0; p < 6; p++) {
        ops.push({
          op: "put",
          table: "seats",
          row: {
            id: `g${g}-s${p}`,
            gameId: `g${g}`,
            playerId: `p${p}`,
            orderNumber: p,
          },
        });
      }
      for (let r = 0; r < 13; r++) {
        ops.push({
          op: "put",
          table: "rounds",
          row: { id: `g${g}-r${r}`, gameId: `g${g}`, roundNumber: r },
        });
        for (let p = 0; p < 6; p++) {
          ops.push({
            op: "put",
            table: "turns",
            row: {
              id: `g${g}-r${r}-t${p}`,
              roundId: `g${g}-r${r}`,
              playerId: `p${p}`,
              bid: 1,
              score: 1,
            },
          });
        }
      }
    }
    server.seed(ops);
    await waitFor(() => client.getView().turns.size === 100 * 13 * 6);

    let start = performance.now();
    const home = selectHomeGames(client.getView());
    const buildMs = performance.now() - start;
    expect(home.games).toHaveLength(100);
    expect(selectHomeGames(client.getView())).toBe(home); // cached
    expect(buildMs).toBeLessThan(1000);

    // Offline play on one game: every dispatch and the rebuild stay quick.
    goOffline();
    await waitFor(() => client.getStatus() === "offline");
    server.requests.length = 0;
    start = performance.now();
    for (let r = 0; r < 13; r++) {
      for (let p = 0; p < 6; p++) {
        await client.dispatch("deleteTurn", { turnId: `g0-r${r}-t${p}` });
      }
    }
    const dispatchMs = performance.now() - start;
    expect(client.getPendingCount()).toBe(78);
    expect(dispatchMs / 78).toBeLessThan(100);
    expect(client.getView().turns.size).toBe(100 * 13 * 6 - 78);

    goOnline();
    start = performance.now();
    await waitFor(
      () => client.getView().turns.size === 100 * 13 * 6 - 78,
      10_000
    );
    await synced(client);
    expect(server.log).toHaveLength(78);
  }, 30_000);
});

// ── Hardening ───────────────────────────────────────────────────────────

const rejectionsOf = (client: SyncClient) => {
  const list: ActionRejection[] = [];
  client.onActionRejected((r) => list.push(r));
  return list;
};

function importArgs(gameId: string, userId: string) {
  const playerIds = Array.from({ length: 6 }, (_, i) => `${gameId}-p${i}`);
  return {
    game: {
      id: gameId,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: userId,
    },
    newPlayers: playerIds.map((id) => ({ id, name: `Player ${id}` })),
    seats: playerIds.map((playerId, i) => ({
      id: `${gameId}-s${i}`,
      gameId,
      playerId,
      orderNumber: i,
    })),
    rounds: ROUNDS.map((_, r) => ({
      id: `${gameId}-r${r}`,
      gameId,
      roundNumber: r,
    })),
    turns: ROUNDS.flatMap((_, r) =>
      playerIds.map((playerId, i) => ({
        id: `${gameId}-r${r}-t${i}`,
        roundId: `${gameId}-r${r}`,
        playerId,
        bid: 1,
        score: 1,
      }))
    ),
  };
}

const pushBodies = () =>
  server.requests
    .filter((r) => r.path === "/sync/push")
    .map((r) => r.body.actions);

describe("push batches", () => {
  it("keeps each batch within the byte limit", async () => {
    const client = await signedInClient({ deps: { maxBatchBytes: 700 } });
    goOffline();
    await waitFor(() => client.getStatus() === "offline");
    for (let i = 1; i <= 8; i++) {
      await client.dispatch("createPlayer", {
        playerId: `p${i}`,
        name: `Player ${i}`,
      });
    }
    goOnline();
    await synced(client);
    const batches = pushBodies();
    expect(batches.length).toBeGreaterThan(2);
    for (const actions of batches) {
      expect(actions.length === 1 || JSON.stringify(actions).length < 900).toBe(
        true
      );
    }
    expect(server.log).toEqual([
      "a-1",
      "a-2",
      "a-3",
      "a-4",
      "a-5",
      "a-6",
      "a-7",
      "a-8",
    ]);
  });

  it("splits a batch the server calls too large, in order, until it fits", async () => {
    const client = await signedInClient();
    const userId = client.getAuth().user!.id;
    server.maxPushBytes = 30_000;
    goOffline();
    await waitFor(() => client.getStatus() === "offline");
    const rejections = rejectionsOf(client);
    for (let i = 0; i < 12; i++) {
      await client.dispatch("importGame", importArgs(`g${i}`, userId));
    }
    goOnline();
    await synced(client);
    expect(server.log).toHaveLength(12);
    expect(server.log).toEqual(
      Array.from({ length: 12 }, (_, i) => `a-${i + 1}`)
    );
    expect(server.data.games.size).toBe(12);
    expect(rejections).toEqual([]);
    expect(server.requests.some((r) => r.path === "/sync/push")).toBe(true);
  });

  it("drops a single action the server won't take, and carries on", async () => {
    const client = await signedInClient();
    const userId = client.getAuth().user!.id;
    server.maxPushBytes = 3000;
    goOffline();
    await waitFor(() => client.getStatus() === "offline");
    const rejections = rejectionsOf(client);
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await client.dispatch("importGame", importArgs("big", userId));
    await client.dispatch("createPlayer", { playerId: "p2", name: "Bob" });
    goOnline();
    await synced(client);
    expect(rejections.map((r) => [r.action.name, r.code])).toEqual([
      ["importGame", "too_large"],
    ]);
    expect(server.log).toEqual(["a-1", "a-3"]);
    expect(client.getView().games.has("big")).toBe(false);
  });

  it("drops an action the server calls invalid once it is alone", async () => {
    const client = await signedInClient();
    server.pushStatus = 400;
    const rejections = rejectionsOf(client);
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await client.dispatch("createPlayer", { playerId: "p2", name: "Bob" });
    await synced(client);
    expect(rejections.map((r) => r.code)).toEqual(["invalid", "invalid"]);
    expect(client.getView().players.size).toBe(0);
  });

  it("retries a server_error result without dropping or reordering", async () => {
    const client = await signedInClient();
    const rejections = rejectionsOf(client);
    server.blockPush = true;
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await client.dispatch("createGame", createGameArgs("g1"));
    server.blockPush = false;
    server.serverErrors = 2; // the first action fails twice; the game would be rejected
    await synced(client);
    expect(rejections).toEqual([]);
    expect(server.log).toEqual(["a-1", "a-2"]);
    expect(server.data.games.has("g1")).toBe(true);
  });

  it("treats a 200 page of HTML as no connection and keeps retrying", async () => {
    const client = await signedInClient();
    server.portal = true;
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await sleep(60);
    expect(client.getPendingCount()).toBe(1);
    expect(client.getView().players.has("p1")).toBe(true);
    server.portal = false;
    await synced(client);
    expect(server.data.players.has("p1")).toBe(true);
  });

  it("treats a wrong-shaped push answer as a failure and retries", async () => {
    const client = newClient({
      deps: {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const res = await server.fetch(input, init);
          if (String(input).includes("/sync/push") && server.pushStatus === 0) {
            return new Response("[]", { status: 200 });
          }
          return res;
        }) as typeof fetch,
      },
    });
    await client.start();
    await client.signInAsGuest();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await sleep(40);
    expect(client.getPendingCount()).toBe(1); // wrong-shaped answers aren't acks
    expect(
      server.requests.filter((r) => r.path === "/sync/push").length
    ).toBeGreaterThan(1);
  });
});

describe("snapshots and rollbacks", () => {
  it("ignores a stale full snapshot that arrives after newer stream events", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let armed = false;
    const client = await signedInClient({
      grace: 10,
      deps: {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          const res = await server.fetch(input, init);
          if (armed && String(input).includes("/sync/pull")) {
            armed = false;
            await gate; // the answer was made now, but arrives late
          }
          return res;
        }) as typeof fetch,
      },
    });
    await synced(client);
    const other = server.addAccount("o@example.com", "pw");
    server.holdStream = true;
    server.forceReset = true;
    armed = true;
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await waitFor(() => !armed); // the catch-up pull is in flight
    server.act(other, {
      id: "o1",
      name: "createPlayer",
      args: { playerId: "p2", name: "Bob" },
    });
    server.act(other, {
      id: "o2",
      name: "createPlayer",
      args: { playerId: "p3", name: "Cat" },
    });
    server.releaseStream();
    await waitFor(() => client.getView().players.size === 3);

    release();
    await sleep(30);
    expect([...client.getView().players.keys()].sort()).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    await synced(client);
  });

  it("shares one pull between callers", async () => {
    const client = await signedInClient({ grace: 5 });
    await synced(client);
    server.holdStream = true;
    const before = server.pullCount;
    for (let i = 0; i < 5; i++) {
      await client.dispatch("createPlayer", {
        playerId: `p${i}`,
        name: `P${i}`,
      });
    }
    await synced(client);
    // Five acks wanted five catch-ups; they share pulls instead.
    expect(server.pullCount - before).toBeLessThan(5);
  });

  it("follows a server that was restored from an older backup", async () => {
    const first = await signedInClient();
    await first.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await synced(first);
    const backup = server.backup();
    await first.dispatch("createPlayer", { playerId: "p2", name: "Bob" });
    await synced(first);
    await waitFor(() => first.getView().players.size === 2);
    await first.persisted();
    first.stop();

    server.restore(backup); // version goes back from 2 to 1
    const second = newClient();
    await second.start();
    await waitFor(() => second.getStatus() === "connected");
    expect([...second.getView().players.keys()]).toEqual(["p1"]);
    expect(second.getAuth().user).not.toBeNull();
  });

  it("re-sends acked actions the server lost in a rollback", async () => {
    const client = await signedInClient({ grace: 400 });
    await synced(client);
    const backup = server.backup();
    server.holdStream = true;
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await waitFor(() => server.data.players.has("p1"));
    await sleep(30);
    expect(client.getPendingCount()).toBe(1); // acked, snapshot behind

    server.held.length = 0; // the stream died before it delivered those
    server.restore(backup); // the server forgets p1 and the action id
    server.releaseStream();
    await waitFor(() => server.data.players.has("p1"));
    await synced(client);
    expect(server.log.filter((id) => id === "a-1")).toHaveLength(2);
    expect(client.getView().players.has("p1")).toBe(true);
  });
});

describe("connection", () => {
  it("backs off when the server rate limits", async () => {
    server.rateLimited = true;
    const client = newClient({ deps: { backoff: { minMs: 50, maxMs: 800 } } });
    await client.start();
    await sleep(300);
    expect(server.pullCount).toBeLessThanOrEqual(2);
    expect(server.pullCount).toBeGreaterThanOrEqual(1);
    expect(client.getStatus()).toBe("offline");
    server.rateLimited = false;
    await waitFor(() => client.getStatus() === "connected", 3000);
  });

  it("stays connected and keeps syncing when only the stream is blocked", async () => {
    server.streamLimited = true;
    const other = server.addAccount("o@example.com", "pw");
    const client = await signedInClient();
    expect(client.getStatus()).toBe("connected");
    server.act(other, {
      id: "o1",
      name: "createPlayer",
      args: { playerId: "p9", name: "Zed" },
    });
    // No stream, so it arrives by polling.
    await waitFor(() => client.getView().players.has("p9"));
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await synced(client);
    expect(server.data.players.has("p1")).toBe(true);
    expect(client.getStatus()).toBe("connected");
  });

  it("keeps backing off when streams open but die straight away", async () => {
    server.dropStreams = true;
    const client = newClient({
      deps: { backoff: { minMs: 30, maxMs: 500 }, healthyMs: 1000 },
    });
    await client.start();
    await sleep(300);
    // Delays of 30, 60, 120... mean about four opens, not ten.
    expect(server.streamOpens).toBeLessThanOrEqual(5);
    expect(server.streamOpens).toBeGreaterThanOrEqual(2);
  });

  it("keeps trying, slowly, when the browser says we're offline", async () => {
    const client = newClient({ deps: { backoff: { minMs: 5, maxMs: 40 } } });
    networks[networks.length - 1].set(false);
    await client.start();
    expect(client.getStatus()).toBe("offline");
    // The browser is wrong: the server is reachable.
    await waitFor(() => client.getStatus() === "connected");
    expect(server.pullCount).toBeGreaterThan(0);
  });

  it("notices a revoked session and keeps the queue", async () => {
    const client = await signedInClient();
    server.blockPush = true;
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    server.forgetTokens();
    networks[0].set(true); // reconnect, which checks the session
    await waitFor(() => client.getAuth().user === null);
    expect(client.getPendingCount()).toBe(1);
    expect(client.getView().players.has("p1")).toBe(true);
  });

  it("does nothing after stop(), and start() picks up again", async () => {
    const client = await signedInClient();
    server.offline = true; // retry timers are running
    client.stop();
    await sleep(30);
    const requests = server.requests.length;
    const pulls = server.pullCount;
    await sleep(80);
    expect(server.requests.length).toBe(requests);
    expect(server.pullCount).toBe(pulls);

    server.offline = false;
    await client.start();
    await waitFor(() => client.getStatus() === "connected");
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await synced(client);
    expect(server.data.players.has("p1")).toBe(true);
  });

  it("is not loading when only queued changes are stored", async () => {
    const first = await signedInClient();
    goOffline();
    await waitFor(() => first.getStatus() === "offline");
    await first.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await first.persisted();
    first.stop();

    // Reload with a server that never answers.
    const second = newClient({
      deps: { fetch: (() => new Promise(() => {})) as unknown as typeof fetch },
    });
    await second.start();
    expect(second.getStatus()).not.toBe("connected");
    expect(second.getView().players.size).toBe(1);
    expect(second.isLoading()).toBe(false);
  });
});

describe("sessions", () => {
  it("refuses to leave a guest session while its changes are unsynced", async () => {
    server.addAccount("ann@example.com", "secret123");
    const client = await signedInClient();
    server.blockPush = true;
    await client.dispatch("createPlayer", {
      playerId: "p1",
      name: "Guest Ann",
    });
    const error = await client
      .logIn("ann@example.com", "secret123")
      .catch((e) => e);
    expect(error.code).toBe("unsynced");
    expect(error.message).toBe(
      "Couldn't sync your changes yet. Try again when you have signal."
    );
    expect(client.getAuth().user?.isGuest).toBe(true);
    expect(client.getPendingCount()).toBe(1);
    expect(client.getView().players.has("p1")).toBe(true);
    expect(server.requests.some((r) => r.path === "/auth/login")).toBe(false);

    server.blockPush = false;
    const user = await client.logIn("ann@example.com", "secret123");
    expect(user.isGuest).toBe(false);
    expect(server.data.players.has("p1")).toBe(true);
  });

  it("reports queued actions dropped when a different user signs in", async () => {
    server.addAccount("ann@example.com", "secret123");
    server.addAccount("bob@example.com", "secret456");
    const client = newClient();
    await client.start();
    await client.logIn("ann@example.com", "secret123");
    await waitFor(() => client.getStatus() === "connected");
    server.forgetTokens(); // the session is gone, the queue stays
    const rejections = rejectionsOf(client);
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann's" });
    await waitFor(() => client.getAuth().user === null);
    expect(client.getPendingCount()).toBe(1);

    await client.logIn("bob@example.com", "secret456");
    expect(client.getPendingCount()).toBe(0);
    expect(rejections.map((r) => [r.action.id, r.code])).toEqual([
      ["a-1", "signed_out"],
    ]);
    expect(client.getView().players.has("p1")).toBe(false);
  });

  it("reports queued actions dropped by logging out", async () => {
    const client = await signedInClient();
    server.blockPush = true;
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    const rejections = rejectionsOf(client);
    await client.logOut();
    expect(rejections.map((r) => r.code)).toEqual(["signed_out"]);
  });

  it("only clears the session on a 401 for the token that was sent", async () => {
    server.addAccount("bob@example.com", "secret456");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = 0;
    const client = await signedInClient({
      deps: {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).includes("/sync/push")) {
            held += 1;
            await gate;
          }
          return server.fetch(input, init);
        }) as typeof fetch,
      },
    });
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await waitFor(() => held === 1); // in flight with the guest's token
    server.forgetTokens();
    await client.logOut();
    await client.logIn("bob@example.com", "secret456");
    expect(client.getAuth().user?.email).toBe("bob@example.com");

    release();
    await sleep(40);
    expect(client.getAuth().user?.email).toBe("bob@example.com");
  });

  it("claims admin with the bootstrap token and shows it at once", async () => {
    server.addAccount("ann@example.com", "secret123");
    const client = newClient();
    await client.start();
    expect(await client.claimAdmin("bootstrap").catch((e) => e.code)).toBe(
      "not_signed_in"
    );
    await client.logIn("ann@example.com", "secret123");
    expect(client.getAuth().user?.isAdmin).toBeUndefined();
    expect(await client.claimAdmin("nope").catch((e) => e.code)).toBe(
      "forbidden"
    );
    expect(client.getAuth().user?.isAdmin).toBeUndefined();

    await client.claimAdmin("bootstrap");
    expect(client.getAuth().user?.isAdmin).toBe(true);
    expect(
      server.requests.filter((r) => r.path === "/auth/claim-admin")
    ).toHaveLength(2);
    // Saved with the session, so it survives a reload offline.
    await client.persisted();
    client.stop();
    goOffline();
    const reloaded = newClient();
    await reloaded.start();
    expect(reloaded.getAuth().user?.isAdmin).toBe(true);
  });

  it("picks up role changes made elsewhere when it reconnects", async () => {
    server.addAccount("ann@example.com", "secret123");
    const client = newClient();
    await client.start();
    const user = await client.logIn("ann@example.com", "secret123");
    await waitFor(() => client.getStatus() === "connected");
    expect(client.getAuth().user?.isAdmin).toBeUndefined();
    server.makeAdmin(user.id);
    networks[0].set(true); // reconnect, which re-reads the user
    await waitFor(() => client.getAuth().user?.isAdmin === true);
    expect(client.getAuth().user?.id).toBe(user.id);
  });
});

// ── Storage trouble ─────────────────────────────────────────────────────

// An IDBFactory we can break: opens fail while `broken`, and every database it
// handed out can be closed behind the engine's back (as iOS does).
function breakableIdb() {
  const real = new IDBFactory();
  const dbs: IDBDatabase[] = [];
  const control = {
    broken: false,
    killConnections: () => dbs.forEach((db) => db.close()),
    factory: {
      open(name: string, version?: number) {
        if (control.broken) throw new Error("IndexedDB is gone");
        const request = real.open(name, version);
        request.addEventListener("success", () => dbs.push(request.result));
        return request;
      },
    } as unknown as IDBFactory,
    real,
  };
  return control;
}

describe("storage trouble", () => {
  it("reopens a connection that was killed and carries on", async () => {
    const idbControl = breakableIdb();
    const client = await signedInClient({
      deps: { openStorage: () => openStorage(idbControl.factory) },
    });
    await synced(client);
    expect(client.getStorageHealth()).toBe("ok");
    idbControl.killConnections();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await client.persisted();
    expect(client.getStorageHealth()).toBe("ok");
    client.stop();

    goOffline();
    const reloaded = newClient({ storage: idbControl.real });
    await reloaded.start();
    expect(reloaded.getView().players.has("p1")).toBe(true);
  });

  it("reports failing storage, then repairs it from memory when it works again", async () => {
    const idbControl = breakableIdb();
    const client = await signedInClient({
      deps: { openStorage: () => openStorage(idbControl.factory) },
    });
    await synced(client);
    const healths: string[] = [];
    client.subscribe(() => healths.push(client.getStorageHealth()));

    server.blockPush = true; // keep the changes queued
    idbControl.broken = true;
    idbControl.killConnections();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    expect(client.getStorageHealth()).toBe("failing");
    expect(healths).toContain("failing");
    // Still works for now.
    expect(client.getView().players.has("p1")).toBe(true);

    idbControl.broken = false;
    await client.dispatch("createPlayer", { playerId: "p2", name: "Bob" });
    // Other writes that failed meanwhile (session, snapshot) are repaired by
    // the periodic retry.
    await waitFor(() => client.getStorageHealth() === "ok");
    await client.persisted();
    client.stop();

    // Both queued changes are on disk, though the first write had failed.
    goOffline();
    const reloaded = newClient({ storage: idbControl.real });
    await reloaded.start();
    expect(reloaded.getPendingCount()).toBe(2);
    expect(reloaded.getAuth().user).not.toBeNull();
  });

  it("heals on its own after a failure", async () => {
    const idbControl = breakableIdb();
    const client = await signedInClient({
      deps: { openStorage: () => openStorage(idbControl.factory) },
    });
    server.blockPush = true;
    idbControl.broken = true;
    idbControl.killConnections();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    expect(client.getStorageHealth()).toBe("failing");
    idbControl.broken = false;
    await waitFor(() => client.getStorageHealth() === "ok");
    await client.persisted();
    const stored = await (await openStorage(idbControl.real)).load();
    expect(stored.pending).toHaveLength(1);
  });

  it("falls back to memory when IndexedDB is missing, and says so", async () => {
    const client = newClient({
      deps: { openStorage: () => openStorage(null) },
    });
    await client.start();
    expect(client.getStorageHealth()).toBe("memory");
    await client.signInAsGuest();
    await client.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await synced(client);
    expect(server.data.players.has("p1")).toBe(true);
  });

  it("falls back to memory when opening storage hangs", async () => {
    const hanging = { open: () => ({}) } as unknown as IDBFactory;
    const client = newClient({
      deps: { openStorage: () => openStorage(hanging, 30) },
    });
    await client.start();
    expect(client.getStorageHealth()).toBe("memory");
    expect(client.getAuth().isLoading).toBe(false);
  });

  it("falls back to memory when an injected openStorage never answers", async () => {
    const client = newClient({
      deps: { openStorage: () => new Promise(() => {}), storageTimeoutMs: 30 },
    });
    await client.start();
    expect(client.getStorageHealth()).toBe("memory");
  });

  it("does not write over stored data it couldn't read", async () => {
    const first = await signedInClient();
    server.blockPush = true;
    await first.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await first.persisted();
    const original = await (await openStorage(idb)).load();
    first.stop();

    const second = newClient({
      deps: {
        openStorage: async () => ({
          ...(await openStorage(idb)),
          load: async () => {
            throw new Error("can't read");
          },
        }),
      },
    });
    await second.start();
    expect(second.getStorageHealth()).toBe("memory");
    expect(second.getAuth().user).toBeNull();
    await second.signInAsGuest();
    await second.dispatch("createPlayer", { playerId: "p2", name: "Bob" });
    await second.persisted();

    const after = await (await openStorage(idb)).load();
    expect(after.session).toEqual(original.session);
    expect(after.pending.map((e) => e.id)).toEqual(
      original.pending.map((e) => e.id)
    );
  });

  it("keeps queued actions from two tabs sharing one database", async () => {
    const setup = await signedInClient();
    await setup.persisted();
    setup.stop();

    goOffline();
    // Both tabs load the same stored state before either has written.
    const a = newClient({ deps: { now: () => 1000 } });
    const b = newClient({ deps: { now: () => 1000 } });
    await Promise.all([a.start(), b.start()]);
    await a.dispatch("createPlayer", { playerId: "pa", name: "From A" });
    await b.dispatch("createPlayer", { playerId: "pb", name: "From B" });
    await Promise.all([a.persisted(), b.persisted()]);
    a.stop();
    b.stop();

    const reloaded = newClient();
    await reloaded.start();
    expect(reloaded.getPendingCount()).toBe(2);
    expect([...reloaded.getView().players.keys()].sort()).toEqual(["pa", "pb"]);
    goOnline();
    await synced(reloaded);
    expect(server.data.players.size).toBe(2);
  });
});

// ── Provisional guests (first use with no signal) ───────────────────────

const uuidDeps = () => {
  let n = 0;
  return {
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  };
};

// A client that starts offline and plays as a guest, with some play queued.
async function offlineGuest(withImport = false) {
  goOffline();
  const client = newClient({ deps: uuidDeps() });
  await client.start();
  const user = await client.signInAsGuest();
  await client.dispatch("createPlayer", {
    playerId: "p1",
    name: "Ann",
    claim: true,
  });
  await client.dispatch("createGame", createGameArgs("g1"));
  await client.dispatch("placeBid", {
    turnId: "t1",
    roundId: "g1-r0",
    playerId: "p1",
    bid: 2,
  });
  if (withImport)
    await client.dispatch("importGame", importArgs("old", user.id));
  return { client, user };
}

describe("provisional guests", () => {
  it("lets a first-time visitor with no signal play, across a reload", async () => {
    const { client, user } = await offlineGuest();
    expect(user).toMatchObject({ email: null, isGuest: true });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(client.getAuth()).toEqual({ isLoading: false, user });
    expect(client.getPendingCount()).toBe(3);
    expect(client.getView().players.get("p1")?.claimedBy).toBe(user.id);
    expect(client.getView().games.get("g1")?.createdBy).toBe(user.id);
    expect(server.requests.filter((r) => r.path === "/auth/guest")).toEqual([]);
    await client.persisted();
    client.stop();

    const reloaded = newClient({ deps: uuidDeps() });
    await reloaded.start();
    expect(reloaded.getAuth().user).toEqual(user);
    expect(reloaded.getPendingCount()).toBe(3);
    expect(reloaded.getView().turns.get("t1")?.bid).toBe(2);
    expect(server.data.games.size).toBe(0);
  });

  it("registers the same id once online and sends everything", async () => {
    const { client, user } = await offlineGuest();
    await client.persisted();
    client.stop();
    const reloaded = newClient({ deps: uuidDeps() });
    await reloaded.start();

    goOnline();
    await synced(reloaded);
    const register = server.requests.find((r) => r.path === "/auth/guest")!;
    expect(register.body).toEqual({ id: user.id });
    expect(reloaded.getAuth().user).toEqual(user);
    expect(server.data.games.get("g1")?.createdBy).toBe(user.id);
    expect(server.data.players.get("p1")?.claimedBy).toBe(user.id);
    expect(server.data.turns.get("t1")?.bid).toBe(2);
    // It is a normal guest now: its token works and it keeps playing.
    await reloaded.dispatch("setScore", { turnId: "t1", score: 5 });
    await synced(reloaded);
    expect(server.data.turns.get("t1")?.score).toBe(5);
    expect(
      server.requests.filter((r) => r.path === "/auth/guest")
    ).toHaveLength(1);
  });

  it("stays provisional through network errors and keeps trying", async () => {
    const { client, user } = await offlineGuest();
    // The browser thinks it's online but the server can't be reached.
    networks[0].set(true);
    await sleep(60);
    expect(client.getAuth().user).toEqual(user);
    expect(client.getPendingCount()).toBe(3);
    server.offline = false;
    await synced(client);
    expect(server.data.games.get("g1")?.createdBy).toBe(user.id);
  });

  it("falls back to a fresh guest when the id is taken, moving the queue over", async () => {
    const { client, user } = await offlineGuest(true);
    server.takenIds.add(user.id);
    goOnline();
    await synced(client);
    const fresh = client.getAuth().user!;
    expect(fresh.id).not.toBe(user.id);
    expect(fresh.isGuest).toBe(true);
    expect(
      server.requests.filter((r) => r.path === "/auth/guest").map((r) => r.body)
    ).toEqual([{ id: user.id }, {}]);
    // Everything landed under the new id, including the id inside importGame.
    expect(server.data.games.get("g1")?.createdBy).toBe(fresh.id);
    expect(server.data.games.get("old")?.createdBy).toBe(fresh.id);
    expect(server.data.players.get("p1")?.claimedBy).toBe(fresh.id);
    expect(server.log).toHaveLength(4);
    expect(client.getView().games.get("old")?.createdBy).toBe(fresh.id);
  });

  it("treats an id the server finds malformed the same way", async () => {
    goOffline();
    const client = newClient(); // test ids like "a-1" aren't uuids
    await client.start();
    const user = await client.signInAsGuest();
    await client.dispatch("createPlayer", {
      playerId: "p1",
      name: "Ann",
      claim: true,
    });
    goOnline();
    await synced(client);
    expect(client.getAuth().user!.id).not.toBe(user.id);
    expect(server.data.players.get("p1")?.claimedBy).toBe(
      client.getAuth().user!.id
    );
  });

  it("registers it first when logging in, then merges as a guest", async () => {
    server.addAccount("ann@example.com", "secret123");
    const { client, user } = await offlineGuest();
    goOnline();
    const account = await client.logIn("ann@example.com", "secret123");
    expect(account.isGuest).toBe(false);
    const paths = server.requests
      .map((r) => r.path)
      .filter(
        (p) =>
          (p !== "/auth/me" && p.startsWith("/auth/")) || p === "/sync/push"
      );
    expect(paths.slice(0, 3)).toEqual([
      "/auth/guest",
      "/sync/push",
      "/auth/login",
    ]);
    const login = server.requests.find((r) => r.path === "/auth/login")!;
    expect(typeof login.body.guestToken).toBe("string");
    // The guest's play was saved under the guest before the switch.
    expect(server.data.games.get("g1")?.createdBy).toBe(user.id);
    expect(client.getPendingCount()).toBe(0);
  });

  it("registers it first when signing up, then upgrades it in place", async () => {
    const { client, user } = await offlineGuest();
    goOnline();
    const account = await client.signUp("ann@example.com", "secret123");
    expect(account).toEqual({
      id: user.id,
      email: "ann@example.com",
      isGuest: false,
    });
    await synced(client);
    expect(server.data.games.get("g1")?.createdBy).toBe(user.id);
  });

  it("can't log in or sign up without signal, and nothing is lost", async () => {
    const { client } = await offlineGuest();
    const error = await client
      .logIn("ann@example.com", "secret123")
      .catch((e) => e);
    expect(error.code).toBe("offline");
    expect(
      (await client.signUp("a@example.com", "secret123").catch((e) => e)).code
    ).toBe("offline");
    expect(client.getPendingCount()).toBe(3);
  });

  it("reports queued actions if the provisional guest logs out", async () => {
    const { client } = await offlineGuest();
    const rejections = rejectionsOf(client);
    await client.logOut();
    expect(rejections.map((r) => r.code)).toEqual([
      "signed_out",
      "signed_out",
      "signed_out",
    ]);
    expect(client.getAuth().user).toBeNull();
    expect(client.getPendingCount()).toBe(0);
  });

  it("online first use still just asks the server for a guest", async () => {
    const client = newClient({ deps: uuidDeps() });
    await client.start();
    const user = await client.signInAsGuest();
    expect(
      server.requests.filter((r) => r.path === "/auth/guest").map((r) => r.body)
    ).toEqual([{}]);
    expect(user.id).toMatch(/^u-/);
    // And returns the same guest when asked again.
    expect(await client.signInAsGuest()).toEqual(user);
  });
});
