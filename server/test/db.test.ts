import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importSnapshot, openDb } from "../src/db";
import { action, start } from "./helpers";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whist-import-"));
  dirs.push(dir);
  return dir;
};

const snapshot = {
  players: [
    { id: "p1", name: "Ann", claimedBy: "old-user" },
    { id: "p2", name: "Bob" },
  ],
  games: [
    {
      id: "g1",
      createdAt: "2024-01-01T00:00:00.000Z",
      createdBy: "old-user",
      initialDealerId: "p1",
    },
  ],
  seats: [
    { id: "s1", gameId: "g1", playerId: "p1", orderNumber: 0 },
    { id: "s2", gameId: "g1", playerId: "p2", orderNumber: 1 },
  ],
  rounds: [{ id: "r1", gameId: "g1", roundNumber: 0 }],
  turns: [{ id: "t1", roundId: "r1", playerId: "p1", bid: 2, score: null }],
};

describe("importSnapshot", () => {
  it("keeps ids and serves the rows over /sync/pull, with no users", async () => {
    const dir = tempDir();
    const db = openDb(dir);
    importSnapshot(db, snapshot);
    db.close();

    const api = await start({ dataDir: dir });
    const pull = await api.get("/sync/pull?since=0");
    expect(pull.body.version).toBe(1);
    expect(pull.body.reset).toBe(true);
    expect(pull.body.puts.players).toEqual(snapshot.players);
    expect(pull.body.puts.games).toEqual(snapshot.games);
    expect(pull.body.puts.seats).toEqual(snapshot.seats);
    expect(pull.body.puts.rounds).toEqual(snapshot.rounds);
    // Unset optional fields (score: null) come back omitted.
    expect(pull.body.puts.turns).toEqual([
      { id: "t1", roundId: "r1", playerId: "p1", bid: 2 },
    ]);
    expect((await api.get("/health")).body.version).toBe(1);

    // New writes continue from the imported version, on top of imported rows.
    const user = await api.guest();
    const res = await api.push(
      user.token,
      action("claimPlayer", { playerId: "p2" })
    );
    expect(res.results[0].ok).toBe(true);
    expect(res.version).toBe(2);
    const next = await api.get("/sync/pull?since=1");
    expect(next.body.puts.players).toEqual([
      { id: "p2", name: "Bob", claimedBy: user.user.id },
    ]);
  });

  it("imports an empty snapshot and refuses a database that has data", () => {
    const db = openDb(tempDir());
    importSnapshot(db, {
      players: [],
      games: [],
      seats: [],
      rounds: [],
      turns: [],
    });
    expect(db.version()).toBe(1);
    expect(() => importSnapshot(db, snapshot)).toThrow(/empty/);
    db.close();
  });

  it("stores mergeLog as JSON and returns it as an object", () => {
    const db = openDb(tempDir());
    const mergeLog = { into: "p2", seats: ["s1"], turns: [], dealerGames: [] };
    importSnapshot(db, {
      ...snapshot,
      players: [
        {
          id: "p1",
          name: "Ann",
          mergedInto: "p2",
          mergedAt: "2024-02-01T00:00:00.000Z",
          mergeLog,
        },
        snapshot.players[1],
      ],
    });
    expect(db.readState().get("players", "p1")?.mergeLog).toEqual(mergeLog);
    expect(db.readState().where("seats", "playerId", "p1")).toHaveLength(1);
    db.close();
  });
});
