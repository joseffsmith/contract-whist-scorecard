/// <reference types="node" />
import "fake-indexeddb/auto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer } from "../../server/src/app";
import { createSyncClient } from "./client";
import type { ActionRejection, SyncClient } from "./client";
import { openStorage } from "./storage";

// The engine against the real server (SQLite, SSE, rate limits and all).

type Server = Awaited<ReturnType<typeof startServer>>;

let server: Server;
let dataDir: string;
let clients: SyncClient[];
let down: boolean;
let ids: number;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("Timed out waiting for condition");
    await sleep(5);
  }
}

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "whist-sync-"));
  server = await startServer({ port: 0, dataDir });
  clients = [];
  down = false;
  ids = 0;
});

afterEach(async () => {
  clients.forEach((client) => client.stop());
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function newClient(storage = new IDBFactory()) {
  const online = new Set<() => void>();
  const client = createSyncClient({
    // The real server serves from its root; nginx adds /contract-whist/api.
    apiBase: server.url,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      down
        ? Promise.reject(new TypeError("Failed to fetch"))
        : fetch(input, init)) as typeof fetch,
    openStorage: () => openStorage(storage),
    uuid: () => `a-${++ids}`,
    backoff: { minMs: 10, maxMs: 50 },
    streamGraceMs: 50,
    network: {
      isOnline: () => !down,
      subscribe: (cb) => {
        online.add(cb);
        return () => online.delete(cb);
      },
    },
  });
  clients.push(client);
  return Object.assign(client, {
    setDown(value: boolean) {
      down = value;
      online.forEach((cb) => cb());
    },
  });
}

const roundIds = (g: string) =>
  Array.from({ length: 13 }, (_, i) => `${g}-r${i}`);
const synced = (client: SyncClient) =>
  waitFor(() => client.getPendingCount() === 0);

describe("against the real server", () => {
  it("syncs a game live to another device", async () => {
    const phone = newClient();
    const watcher = newClient();
    await Promise.all([phone.start(), watcher.start()]);
    await phone.signInAsGuest();
    await waitFor(() => watcher.getStatus() === "connected");

    await phone.dispatch("createPlayer", {
      playerId: "p1",
      name: "Ann",
      claim: true,
    });
    await phone.dispatch("createGame", {
      gameId: "g1",
      roundIds: roundIds("g1"),
      seatId: "s1",
      playerId: "p1",
    });
    await phone.dispatch("placeBid", {
      turnId: "t1",
      roundId: "g1-r0",
      playerId: "p1",
      bid: 3,
    });
    await phone.dispatch("setScore", { turnId: "t1", score: 12 });
    await phone.dispatch("clearScore", { turnId: "t1" });
    await synced(phone);

    await waitFor(() => watcher.getView().turns.has("t1"));
    expect(watcher.getView().games.get("g1")?.createdBy).toBe(
      phone.getAuth().user?.id
    );
    expect(watcher.getView().rounds.size).toBe(13);
    // The server leaves out null fields; the phone's view agrees.
    await waitFor(() => watcher.getView().turns.get("t1")?.score == null);
    expect(phone.getView().turns.get("t1")?.bid).toBe(3);
    expect(watcher.getAuth().user).toBeNull();
  });

  it("queues offline, survives a reload, then flushes in order", async () => {
    const storage = new IDBFactory();
    const first = newClient(storage);
    await first.start();
    await first.signInAsGuest();
    await waitFor(() => first.getStatus() === "connected");
    first.setDown(true);
    await waitFor(() => first.getStatus() === "offline");
    await first.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await first.dispatch("createPlayer", { playerId: "p2", name: "Bob" });
    await first.persisted();
    first.stop();

    const second = newClient(storage);
    await second.start();
    expect(second.getPendingCount()).toBe(2);
    expect(second.getView().players.size).toBe(2);
    second.setDown(false);
    await synced(second);

    const fresh = newClient();
    await fresh.start();
    await waitFor(() => fresh.getView().players.size === 2);
    expect(fresh.isLoading()).toBe(false);
  });

  it("reports an action the server rejects", async () => {
    const owner = newClient();
    const other = newClient();
    await Promise.all([owner.start(), other.start()]);
    await owner.signInAsGuest();
    await other.signInAsGuest();
    await owner.dispatch("createPlayer", { playerId: "p1", name: "Ann" });
    await synced(owner);
    await waitFor(() => other.getView().players.has("p1"));

    other.setDown(true);
    await waitFor(() => other.getStatus() === "offline");
    const rejections: ActionRejection[] = [];
    other.onActionRejected((r) => rejections.push(r));
    await other.dispatch("claimPlayer", { playerId: "p1" }); // fine as far as it knows
    down = false;
    // Meanwhile the owner claims it first.
    await owner.dispatch("claimPlayer", { playerId: "p1" });
    await synced(owner);
    other.setDown(false);
    await waitFor(() => rejections.length === 1);
    expect(rejections[0].code).toBe("claimed");
    expect(rejections[0].error).toMatch(/claimed/);
    await synced(other);
  });

  it("signs up, logs out and back in, and is told about a wrong password", async () => {
    const client = newClient();
    await client.start();
    const guest = await client.signInAsGuest();
    const user = await client.signUp("ann@example.com", "secret-pass-1");
    expect(user).toMatchObject({
      id: guest.id,
      email: "ann@example.com",
      isGuest: false,
    });
    await client.logOut();
    expect(client.getAuth().user).toBeNull();

    const error = await client
      .logIn("ann@example.com", "wrong-password")
      .catch((e) => e);
    expect(error.code).toBeTruthy();
    expect(error.message).toBeTruthy();
    const back = await client.logIn("ann@example.com", "secret-pass-1");
    expect(back.id).toBe(guest.id);
  });
});
