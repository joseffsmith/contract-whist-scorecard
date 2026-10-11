import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionError } from "../../shared/types";
import type { RowOp } from "../../shared/types";
import { createSyncClient } from "./client";
import type { ActionRejection, NetworkSignal, SyncClient } from "./client";
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
  options: { storage?: IDBFactory; batchSize?: number; grace?: number } = {}
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

  it("drops queued actions when a different user logs in", async () => {
    server.addAccount("ann@example.com", "secret123");
    const client = await signedInClient();
    server.blockPush = true;
    await client.dispatch("createPlayer", {
      playerId: "p1",
      name: "Guest Ann",
    });
    await client.logIn("ann@example.com", "secret123");
    expect(client.getPendingCount()).toBe(0);
    expect(client.getView().players.has("p1")).toBe(false);
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
    const error = await client.signInAsGuest().catch((e) => e);
    expect(error.code).toBe("offline");
    expect(error.message).toMatch(/offline/i);
  });

  it("explains when the server can't be reached", async () => {
    const client = newClient();
    await client.start();
    server.offline = true; // the network claims to be up
    const error = await client.signInAsGuest().catch((e) => e);
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
    start = performance.now();
    expect(selectHomeGames(client.getView())).toBe(home);
    expect(performance.now() - start).toBeLessThan(5);
    expect(buildMs).toBeLessThan(500);

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
    expect(dispatchMs / 78).toBeLessThan(50);
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
