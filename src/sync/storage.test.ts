import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import type { ChangeSet } from "../../shared/types";
import { createMemoryStorage, openStorage } from "./storage";
import type { PendingEntry, SyncStorage } from "./storage";

const changes = (
  partial: Partial<ChangeSet> & { version: number }
): ChangeSet => ({
  puts: {},
  deletes: {},
  ...partial,
});

const entry = (n: number, ackVersion?: number): PendingEntry => ({
  id: `a${n}`,
  at: 100 - n, // queue order is by (at, n), not by id
  n,
  userId: "u1",
  isGuest: true,
  action: { id: `a${n}`, name: "claimPlayer", args: { playerId: "p1" } },
  ackVersion,
});

// The same behaviour for both back ends.
describe.each([
  ["IndexedDB", async () => openStorage(new IDBFactory())],
  ["memory", async () => createMemoryStorage()],
])("%s storage", (_name, create: () => Promise<SyncStorage>) => {
  it("starts empty", async () => {
    const stored = await (await create()).load();
    expect(stored.version).toBe(0);
    expect(stored.session).toBeNull();
    expect(stored.pending).toEqual([]);
    expect(stored.data.players.size).toBe(0);
  });

  it("applies change sets row by row", async () => {
    const storage = await create();
    await storage.applyChanges(
      changes({
        version: 1,
        puts: {
          players: [
            { id: "p1", name: "Ann" },
            { id: "p2", name: "Bob" },
          ],
        },
      })
    );
    await storage.applyChanges(
      changes({
        version: 2,
        puts: { players: [{ id: "p1", name: "Anne" }] },
        deletes: { players: ["p2"] },
      })
    );
    const stored = await storage.load();
    expect(stored.version).toBe(2);
    expect([...stored.data.players.values()]).toEqual([
      { id: "p1", name: "Anne" },
    ]);
  });

  it("replaces everything on a reset", async () => {
    const storage = await create();
    await storage.applyChanges(
      changes({ version: 5, puts: { players: [{ id: "p1", name: "Ann" }] } })
    );
    await storage.applyChanges(
      changes({
        version: 3,
        reset: true,
        puts: { players: [{ id: "p2", name: "Bob" }] },
      })
    );
    const stored = await storage.load();
    expect(stored.version).toBe(3);
    expect([...stored.data.players.keys()]).toEqual(["p2"]);
  });

  it("keeps pending actions in order, and the session", async () => {
    const storage = await create();
    await storage.putPending([entry(2), entry(1)]);
    await storage.putPending([entry(1, 7)]);
    await storage.setSession({
      token: "t",
      user: {
        id: "u1",
        email: null,
        isGuest: true,
        hasPassword: false,
        passkeyCount: 0,
      },
    });
    let stored = await storage.load();
    expect(stored.pending.map((e) => [e.id, e.ackVersion])).toEqual([
      ["a2", undefined],
      ["a1", 7],
    ]);
    expect(stored.session?.token).toBe("t");

    await storage.deletePending(["a1"]);
    await storage.setSession(null);
    stored = await storage.load();
    expect(stored.pending.map((e) => e.id)).toEqual(["a2"]);

    await storage.replacePending([entry(3), entry(4)]);
    stored = await storage.load();
    expect(stored.pending.map((e) => e.id)).toEqual(["a4", "a3"]);
    expect(stored.session).toBeNull();
  });
});

describe("openStorage", () => {
  it("persists across opens on the same database", async () => {
    const factory = new IDBFactory();
    const first = await openStorage(factory);
    expect(first.persistent).toBe(true);
    await first.applyChanges(
      changes({ version: 4, puts: { players: [{ id: "p1", name: "Ann" }] } })
    );
    const second = await openStorage(factory);
    expect((await second.load()).data.players.get("p1")?.name).toBe("Ann");
  });

  it("falls back to memory when IndexedDB is missing or broken", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await openStorage(null)).persistent).toBe(false);
    const broken = {
      open() {
        throw new DOMException("denied", "SecurityError");
      },
    } as unknown as IDBFactory;
    const storage = await openStorage(broken);
    expect(storage.persistent).toBe(false);
    await storage.putPending([entry(1)]);
    expect((await storage.load()).pending).toHaveLength(1);
  });
});
