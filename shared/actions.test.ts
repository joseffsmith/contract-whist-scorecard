import { describe, expect, it } from "vitest";
import {
  DEALS_NUM_CARDS,
  applyAction,
  applyOps,
  createMemoryState,
  memoryReadState,
} from "./actions";
import { ActionError } from "./types";
import type {
  Action,
  ActionArgs,
  ActionContext,
  ActionName,
  DataState,
  ReadState,
  RowOp,
  TableName,
  Tables,
} from "./types";

const NOW = "2026-03-01T12:00:00.000Z";

function ctxFor(
  userId: string | null,
  isGuest = false,
  internal?: ActionContext["internal"]
): ActionContext {
  return { userId, isGuest, now: NOW, internal };
}
const alice = ctxFor("alice");
const bob = ctxFor("bob");
const carol = ctxFor("carol");
const guest = ctxFor("guest1", true);
const anon = ctxFor(null, true);

let actionCounter = 0;

// Applies an action and writes the resulting ops into `data`.
function run<N extends ActionName>(
  data: DataState,
  ctx: ActionContext,
  name: N,
  args: ActionArgs[N]
): RowOp[] {
  const action = { id: `a${++actionCounter}`, name, args };
  const ops = applyAction(memoryReadState(data), action, ctx);
  applyOps(data, ops);
  return ops;
}

// Asserts the action is rejected with `code`, and returns the message.
function reject<N extends ActionName>(
  data: DataState,
  ctx: ActionContext,
  name: N,
  args: ActionArgs[N],
  code: string
): string {
  const action = { id: `a${++actionCounter}`, name, args };
  try {
    applyAction(memoryReadState(data), action, ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(ActionError);
    expect((error as ActionError).code).toBe(code);
    expect((error as ActionError).message).not.toBe("");
    return (error as ActionError).message;
  }
  throw new Error(`${name} was not rejected (expected ${code})`);
}

function seed<T extends TableName>(
  data: DataState,
  table: T,
  row: Tables[T]
): void {
  applyOps(data, [{ op: "put", table, row }]);
}

function row<T extends TableName>(
  data: DataState,
  table: T,
  id: string
): Tables[T] {
  const found = data[table].get(id);
  if (!found) throw new Error(`no ${table} row ${id}`);
  return found as Tables[T];
}

const roundIds = (prefix: string) =>
  Array.from({ length: 13 }, (_, i) => `${prefix}r${i}`);

// players: p1 (alice), p2 (bob), p3 and p4 unclaimed.
// game g1 (created by alice): seats s1=p1, s2=p2, s3=p3; rounds g1r0..g1r12.
function world(): DataState {
  const data = createMemoryState();
  run(data, alice, "createPlayer", {
    playerId: "p1",
    name: "Alice",
    claim: true,
  });
  run(data, bob, "createPlayer", { playerId: "p2", name: "Bob", claim: true });
  run(data, alice, "createPlayer", { playerId: "p3", name: "Cara" });
  run(data, alice, "createPlayer", { playerId: "p4", name: "Dan" });
  run(data, alice, "createGame", {
    gameId: "g1",
    roundIds: roundIds("g1"),
    seatId: "s1",
    playerId: "p1",
  });
  run(data, alice, "addSeat", {
    seatId: "s2",
    gameId: "g1",
    playerId: "p2",
    orderNumber: 1,
  });
  run(data, alice, "addSeat", {
    seatId: "s3",
    gameId: "g1",
    playerId: "p3",
    orderNumber: 2,
  });
  return data;
}

// world() plus a bid by p1 in round 0 of g1 (turn t1), so g1 has started.
function startedWorld(): DataState {
  const data = world();
  run(data, alice, "placeBid", {
    turnId: "t1",
    roundId: "g1r0",
    playerId: "p1",
    bid: 2,
  });
  return data;
}

// A second game g2 (created by alice) with p4 as host and initial dealer, and
// a bid by p4 (turn t4) in round 0.
function worldWithDan(): DataState {
  const data = world();
  run(data, alice, "createGame", {
    gameId: "g2",
    roundIds: roundIds("g2"),
    seatId: "s4",
    playerId: "p4",
  });
  run(data, alice, "setInitialDealer", { gameId: "g2", playerId: "p4" });
  run(data, alice, "placeBid", {
    turnId: "t4",
    roundId: "g2r0",
    playerId: "p4",
    bid: 3,
  });
  return data;
}

function snapshot(data: DataState): DataState {
  const copy = createMemoryState();
  for (const table of Object.keys(data) as TableName[]) {
    for (const [id, value] of data[table]) {
      (copy[table] as Map<string, unknown>).set(id, structuredClone(value));
    }
  }
  return copy;
}

describe("memory state helpers", () => {
  it("applyOps puts, replaces and deletes by id", () => {
    const data = createMemoryState();
    applyOps(data, [
      { op: "put", table: "players", row: { id: "a", name: "A" } },
      { op: "put", table: "players", row: { id: "b", name: "B" } },
    ]);
    applyOps(data, [
      { op: "put", table: "players", row: { id: "a", name: "A2" } },
      { op: "delete", table: "players", id: "b" },
    ]);
    expect([...data.players.values()]).toEqual([{ id: "a", name: "A2" }]);
  });

  it("memoryReadState gets rows and filters with where", () => {
    const data = world();
    const state = memoryReadState(data);
    expect(state.get("players", "p1")?.name).toBe("Alice");
    expect(state.get("players", "nope")).toBeUndefined();
    expect(
      state
        .where("seats", "gameId", "g1")
        .map((s) => s.id)
        .sort()
    ).toEqual(["s1", "s2", "s3"]);
    expect(state.where("seats", "gameId", "other")).toEqual([]);
  });

  it("exports the deal sizes", () => {
    expect(DEALS_NUM_CARDS).toEqual([7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("applyAction general behaviour", () => {
  it("rejects an unknown action name", () => {
    const data = createMemoryState();
    reject(
      data,
      alice,
      "nope" as ActionName,
      {} as ActionArgs["claimPlayer"],
      "unknown_action"
    );
  });

  it("never mutates the state it reads, for every action", () => {
    const data = worldWithDan();
    run(data, alice, "createPlayer", { playerId: "p5", name: "Eve" });
    run(data, alice, "claimPlayer", { playerId: "p3" });
    run(data, alice, "createGame", {
      gameId: "g8",
      roundIds: roundIds("g8"),
      seatId: "s8",
      playerId: "p5",
    });
    run(data, alice, "placeBid", {
      turnId: "t1",
      roundId: "g1r0",
      playerId: "p1",
      bid: 2,
    });
    run(data, alice, "setScore", { turnId: "t1", score: 3 });
    // p4 merged into p1 earlier, so undoMerge has something to do.
    run(data, alice, "mergePlayers", { fromId: "p4", intoId: "p1" });
    // Freeze every row (and nested merge logs); any in-place write would throw.
    for (const table of Object.keys(data) as TableName[]) {
      for (const r of data[table].values()) {
        const log = (r as { mergeLog?: object | null }).mergeLog;
        if (log) Object.freeze(log);
        Object.freeze(r);
      }
    }
    const before = snapshot(data);
    const state = memoryReadState(data);
    const act = <N extends ActionName>(
      ctx: ActionContext,
      name: N,
      args: ActionArgs[N]
    ) => {
      const ops = applyAction(state, { id: "x", name, args }, ctx);
      expect(ops.length, name).toBeGreaterThan(0);
    };
    act(alice, "createPlayer", { playerId: "p6", name: "Fay", claim: true });
    act(bob, "claimPlayer", { playerId: "p5" });
    act(alice, "unclaimPlayer", { playerId: "p1" });
    act(alice, "createGame", {
      gameId: "g9",
      roundIds: roundIds("g9"),
      seatId: "s9",
      playerId: "p5",
    });
    act(alice, "deleteGame", { gameId: "g1" });
    act(alice, "addSeat", {
      seatId: "s9",
      gameId: "g1",
      playerId: "p5",
      orderNumber: 3,
    });
    act(alice, "removeSeat", { seatId: "s3" });
    act(alice, "reorderSeats", { gameId: "g1", seatIds: ["s3", "s2", "s1"] });
    act(alice, "setInitialDealer", { gameId: "g8", playerId: "p5" });
    act(alice, "placeBid", {
      turnId: "t9",
      roundId: "g1r1",
      playerId: "p2",
      bid: 1,
    });
    act(alice, "setScore", { turnId: "t1", score: 5 });
    act(alice, "clearScore", { turnId: "t1" });
    act(alice, "deleteTurn", { turnId: "t1" });
    act(alice, "mergePlayers", { fromId: "p5", intoId: "p3" });
    act(alice, "undoMerge", { fromId: "p4" });
    act(alice, "importGame", {
      game: { id: "gi", createdAt: NOW, createdBy: "alice" },
      newPlayers: [{ id: "n1", name: "New" }],
      seats: [{ id: "is1", gameId: "gi", playerId: "n1", orderNumber: 0 }],
      rounds: [{ id: "ir0", gameId: "gi", roundNumber: 0 }],
      turns: [{ id: "it1", roundId: "ir0", playerId: "n1", bid: 1 }],
    });
    expect(data).toEqual(before);
  });

  it("turns anything else thrown while reading the args into an ActionError", () => {
    const state: ReadState = {
      get: () => {
        throw new TypeError("boom");
      },
      where: () => [],
    };
    const call = (action: unknown) => () =>
      applyAction(state, action as Action, alice);
    for (const action of [
      { id: "x", name: "claimPlayer", args: { playerId: "p1" } },
      { id: "x", name: "claimPlayer", args: null },
      { id: "x", name: "claimPlayer" },
      null,
    ]) {
      expect(call(action)).toThrow(ActionError);
    }
  });
});

describe("replaying actions", () => {
  // Each step is applied, then applied again to the state it produced.
  type Step = [ActionContext, ActionName, unknown];
  const steps: Step[] = [
    [alice, "createPlayer", { playerId: "p1", name: "A", claim: true }],
    [alice, "createPlayer", { playerId: "p2", name: "B" }],
    [alice, "createPlayer", { playerId: "p3", name: "C" }],
    [alice, "createPlayer", { playerId: "p4", name: "D" }],
    [bob, "claimPlayer", { playerId: "p3" }],
    [bob, "unclaimPlayer", { playerId: "p3" }],
    [
      alice,
      "createGame",
      { gameId: "g1", roundIds: roundIds("g1"), seatId: "s1", playerId: "p1" },
    ],
    [
      alice,
      "addSeat",
      { seatId: "s2", gameId: "g1", playerId: "p2", orderNumber: 1 },
    ],
    [
      alice,
      "addSeat",
      { seatId: "s3", gameId: "g1", playerId: "p3", orderNumber: 2 },
    ],
    [alice, "reorderSeats", { gameId: "g1", seatIds: ["s3", "s1", "s2"] }],
    [alice, "setInitialDealer", { gameId: "g1", playerId: "p2" }],
    [
      alice,
      "placeBid",
      { turnId: "t1", roundId: "g1r0", playerId: "p1", bid: 3 },
    ],
    [
      alice,
      "placeBid",
      { turnId: "t2", roundId: "g1r0", playerId: "p2", bid: 1 },
    ],
    [alice, "setScore", { turnId: "t1", score: 5 }],
    [alice, "clearScore", { turnId: "t1" }],
    [alice, "deleteTurn", { turnId: "t2" }],
    [alice, "removeSeat", { seatId: "s3" }],
    [
      alice,
      "createGame",
      { gameId: "g2", roundIds: roundIds("g2"), seatId: "s4", playerId: "p4" },
    ],
    [alice, "mergePlayers", { fromId: "p4", intoId: "p1" }],
    [alice, "undoMerge", { fromId: "p4" }],
    [alice, "deleteGame", { gameId: "g2" }],
    [
      alice,
      "importGame",
      {
        game: { id: "gi", createdAt: NOW, createdBy: "alice" },
        newPlayers: [{ id: "n1", name: "New" }],
        seats: [{ id: "is1", gameId: "gi", playerId: "n1", orderNumber: 0 }],
        rounds: [{ id: "ir0", gameId: "gi", roundNumber: 0 }],
        turns: [{ id: "it1", roundId: "ir0", playerId: "n1", bid: 1 }],
      },
    ],
  ];

  it("covers every action", () => {
    expect(new Set(steps.map((s) => s[1])).size).toBe(16);
  });

  it("applying an action twice is a no-op the second time", () => {
    const data = createMemoryState();
    for (const [ctx, name, args] of steps) {
      const act = { id: `r${++actionCounter}`, name, args } as Action;
      const ops = applyAction(memoryReadState(data), act, ctx);
      expect(ops.length, `${name} first`).toBeGreaterThan(0);
      applyOps(data, ops);
      expect(
        applyAction(memoryReadState(data), act, ctx),
        `${name} replay`
      ).toEqual([]);
    }
  });

  it("claiming a player twice and re-adding a deleted turn id behave", () => {
    const data = world();
    run(data, bob, "claimPlayer", { playerId: "p3" });
    expect(run(data, bob, "claimPlayer", { playerId: "p3" })).toEqual([]);
  });
});

describe("determinism", () => {
  // The same rows inserted in a different order must give identical ops.
  function reversed(data: DataState): DataState {
    const copy = createMemoryState();
    for (const table of Object.keys(data) as TableName[]) {
      for (const [id, value] of [...data[table]].reverse()) {
        (copy[table] as Map<string, unknown>).set(id, value);
      }
    }
    return copy;
  }

  function busyDan(): DataState {
    const data = worldWithDan();
    for (const n of ["3", "4", "5"]) {
      run(data, alice, "createGame", {
        gameId: `gx${n}`,
        roundIds: roundIds(`gx${n}`),
        seatId: `sx${n}`,
        playerId: "p4",
      });
      run(data, alice, "setInitialDealer", {
        gameId: `gx${n}`,
        playerId: "p4",
      });
      run(data, alice, "placeBid", {
        turnId: `tx${n}`,
        roundId: `gx${n}r0`,
        playerId: "p4",
        bid: 1,
      });
    }
    return data;
  }

  it("mergePlayers and undoMerge ops do not depend on insertion order", () => {
    const a = busyDan();
    const b = reversed(a);
    const act = (
      data: DataState,
      name: "mergePlayers" | "undoMerge",
      args: any
    ) => applyAction(memoryReadState(data), { id: "x", name, args }, alice);
    const mergeArgs = { fromId: "p4", intoId: "p1" };
    const opsA = act(a, "mergePlayers", mergeArgs);
    expect(opsA.length).toBeGreaterThan(8);
    expect(act(b, "mergePlayers", mergeArgs)).toEqual(opsA);

    applyOps(a, opsA);
    applyOps(b, opsA);
    const undoA = act(reversed(a), "undoMerge", { fromId: "p4" });
    expect(act(a, "undoMerge", { fromId: "p4" })).toEqual(undoA);
    expect(act(b, "undoMerge", { fromId: "p4" })).toEqual(undoA);
  });

  it("mergePlayers puts rows in id order", () => {
    const ops = applyAction(
      memoryReadState(reversed(busyDan())),
      { id: "x", name: "mergePlayers", args: { fromId: "p4", intoId: "p1" } },
      alice
    );
    const seatIds = ops.flatMap((op) =>
      op.op === "put" && op.table === "seats" ? [op.row.id] : []
    );
    expect(seatIds).toEqual([...seatIds].sort());
  });
});

describe("malformed arguments", () => {
  const valid: { [N in ActionName]: ActionArgs[N] } = {
    createPlayer: { playerId: "p5", name: "Eve", claim: true },
    claimPlayer: { playerId: "p3" },
    unclaimPlayer: { playerId: "p1" },
    createGame: {
      gameId: "g9",
      roundIds: roundIds("g9"),
      seatId: "s9",
      playerId: "p1",
    },
    deleteGame: { gameId: "g1" },
    addSeat: { seatId: "s9", gameId: "g1", playerId: "p5", orderNumber: 3 },
    removeSeat: { seatId: "s3" },
    reorderSeats: { gameId: "g1", seatIds: ["s3", "s2", "s1"] },
    setInitialDealer: { gameId: "g5", playerId: "p6" },
    placeBid: { turnId: "t9", roundId: "g1r1", playerId: "p2", bid: 1 },
    setScore: { turnId: "t1", score: 4 },
    clearScore: { turnId: "t1" },
    deleteTurn: { turnId: "t1" },
    mergePlayers: { fromId: "p5", intoId: "p3" },
    undoMerge: { fromId: "p4" },
    importGame: {
      game: { id: "gi", createdAt: NOW, createdBy: "alice", deletedAt: null },
      newPlayers: [{ id: "n1", name: "New" }],
      seats: [{ id: "is1", gameId: "gi", playerId: "n1", orderNumber: 0 }],
      rounds: [{ id: "ir0", gameId: "gi", roundNumber: 0 }],
      turns: [{ id: "it1", roundId: "ir0", playerId: "n1", bid: 1, score: 2 }],
    },
  };
  const junk: unknown[] = [
    null,
    undefined,
    [],
    [null],
    123,
    NaN,
    Infinity,
    {},
    "",
    true,
    "x".repeat(101),
  ];

  // Every path into the args: top-level fields, and fields of nested objects
  // and array elements.
  function paths(
    value: unknown,
    prefix: (string | number)[] = []
  ): (string | number)[][] {
    if (value === null || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([key, child]) => {
      const path = [...prefix, Array.isArray(value) ? Number(key) : key];
      return [path, ...paths(child, path)];
    });
  }
  function withValue(args: unknown, path: (string | number)[], value: unknown) {
    const copy = structuredClone(args) as any;
    let node = copy;
    for (const key of path.slice(0, -1)) node = node[key];
    node[path[path.length - 1]] = value;
    return copy;
  }

  function sweepState(): DataState {
    const data = startedWorld();
    run(data, alice, "createPlayer", { playerId: "p5", name: "Eve" });
    run(data, alice, "createPlayer", { playerId: "p6", name: "Fay" });
    run(data, alice, "createGame", {
      gameId: "g5",
      roundIds: roundIds("g5"),
      seatId: "s5",
      playerId: "p6",
    });
    run(data, alice, "mergePlayers", { fromId: "p4", intoId: "p1" });
    return data;
  }

  for (const name of Object.keys(valid) as ActionName[]) {
    it(`${name} only ever throws ActionError`, () => {
      const data = sweepState();
      const state = memoryReadState(data);
      const args = valid[name];
      // The unmodified args are accepted.
      expect(
        applyAction(state, { id: "x", name, args } as Action, alice).length
      ).toBeGreaterThanOrEqual(0);
      let tried = 0;
      for (const path of paths(args)) {
        for (const value of junk) {
          for (const ctx of [alice, anon]) {
            tried++;
            const action = {
              id: "x",
              name,
              args: withValue(args, path, value),
            };
            try {
              applyAction(state, action as Action, ctx);
            } catch (error) {
              expect(
                error,
                `${name} ${path.join(".")}=${String(value)}`
              ).toBeInstanceOf(ActionError);
            }
          }
        }
      }
      expect(tried).toBeGreaterThan(0);
      for (const bad of junk) {
        try {
          applyAction(state, { id: "x", name, args: bad } as Action, alice);
        } catch (error) {
          expect(error).toBeInstanceOf(ActionError);
        }
      }
    });
  }

  it("junk ids and counts are rejected as invalid, not accepted", () => {
    const data = sweepState();
    reject(data, alice, "claimPlayer", { playerId: null as any }, "invalid");
    reject(data, alice, "claimPlayer", { playerId: {} as any }, "invalid");
    reject(data, alice, "deleteGame", { gameId: ["g1"] as any }, "invalid");
    reject(
      data,
      alice,
      "claimPlayer",
      { playerId: "x".repeat(101) },
      "invalid"
    );
  });
});

describe("createPlayer", () => {
  it("creates a trimmed, unclaimed player stamped with ctx.now", () => {
    const data = createMemoryState();
    const ops = run(data, alice, "createPlayer", {
      playerId: "p",
      name: "  Zed  ",
    });
    expect(ops).toEqual([
      {
        op: "put",
        table: "players",
        row: { id: "p", name: "Zed", createdAt: NOW },
      },
    ]);
  });

  it("claims the player for the user when claim is set", () => {
    const data = createMemoryState();
    run(data, alice, "createPlayer", {
      playerId: "p",
      name: "Zed",
      claim: true,
    });
    expect(row(data, "players", "p").claimedBy).toBe("alice");
  });

  it("lets guests create players", () => {
    const data = createMemoryState();
    run(data, guest, "createPlayer", { playerId: "p", name: "Zed" });
    expect(data.players.size).toBe(1);
  });

  it("requires a signed-in user", () => {
    reject(
      createMemoryState(),
      anon,
      "createPlayer",
      { playerId: "p", name: "Z" },
      "not_signed_in"
    );
  });

  it("rejects empty and over-long names", () => {
    const data = createMemoryState();
    reject(data, alice, "createPlayer", { playerId: "p", name: "" }, "invalid");
    reject(
      data,
      alice,
      "createPlayer",
      { playerId: "p", name: "   " },
      "invalid"
    );
    reject(
      data,
      alice,
      "createPlayer",
      { playerId: "p", name: "x".repeat(41) },
      "invalid"
    );
    run(data, alice, "createPlayer", { playerId: "p", name: "x".repeat(40) });
    expect(row(data, "players", "p").name).toHaveLength(40);
  });

  it("measures the length after trimming", () => {
    const data = createMemoryState();
    run(data, alice, "createPlayer", {
      playerId: "p",
      name: ` ${"x".repeat(40)} `,
    });
    expect(row(data, "players", "p").name).toHaveLength(40);
  });

  it("is idempotent for the same id and name, and conflicts otherwise", () => {
    const data = createMemoryState();
    run(data, alice, "createPlayer", { playerId: "p", name: "Zed" });
    expect(
      run(data, alice, "createPlayer", { playerId: "p", name: "Zed" })
    ).toEqual([]);
    reject(
      data,
      alice,
      "createPlayer",
      { playerId: "p", name: "Other" },
      "conflict"
    );
  });
});

describe("claimPlayer", () => {
  it("claims an unclaimed player", () => {
    const data = world();
    run(data, bob, "claimPlayer", { playerId: "p3" });
    expect(row(data, "players", "p3")).toEqual({
      id: "p3",
      name: "Cara",
      createdAt: NOW,
      claimedBy: "bob",
    });
  });

  it("allows re-claiming a player you already own", () => {
    const data = world();
    run(data, alice, "claimPlayer", { playerId: "p1" });
    expect(row(data, "players", "p1").claimedBy).toBe("alice");
  });

  it("rejects a player claimed by someone else", () => {
    reject(world(), alice, "claimPlayer", { playerId: "p2" }, "claimed");
  });

  it("rejects a merged player", () => {
    const data = world();
    seed(data, "players", { id: "p4", name: "Dan", mergedInto: "p3" });
    reject(data, alice, "claimPlayer", { playerId: "p4" }, "merged");
  });

  it("rejects unknown players and signed-out users", () => {
    const data = world();
    reject(data, alice, "claimPlayer", { playerId: "nope" }, "not_found");
    reject(data, anon, "claimPlayer", { playerId: "p3" }, "not_signed_in");
  });
});

describe("unclaimPlayer", () => {
  it("clears claimedBy for the owner", () => {
    const data = world();
    run(data, alice, "unclaimPlayer", { playerId: "p1" });
    expect(row(data, "players", "p1").claimedBy).toBeNull();
  });

  it("rejects anyone but the owner", () => {
    const data = world();
    reject(data, bob, "unclaimPlayer", { playerId: "p1" }, "forbidden");
    reject(data, alice, "unclaimPlayer", { playerId: "p2" }, "forbidden");
  });

  it("does nothing for a player nobody has claimed", () => {
    expect(run(world(), alice, "unclaimPlayer", { playerId: "p3" })).toEqual(
      []
    );
  });

  it("rejects unknown players and signed-out users", () => {
    const data = world();
    reject(data, alice, "unclaimPlayer", { playerId: "nope" }, "not_found");
    reject(data, anon, "unclaimPlayer", { playerId: "p1" }, "not_signed_in");
  });
});

describe("createGame", () => {
  const args = (over: Partial<ActionArgs["createGame"]> = {}) => ({
    gameId: "g9",
    roundIds: roundIds("g9"),
    seatId: "s9",
    playerId: "p1",
    ...over,
  });

  it("creates the game, 13 rounds and the host seat", () => {
    const data = world();
    const ops = run(data, bob, "createGame", args());
    expect(ops).toHaveLength(15);
    expect(row(data, "games", "g9")).toEqual({
      id: "g9",
      createdAt: NOW,
      createdBy: "bob",
    });
    for (let n = 0; n < 13; n++) {
      expect(row(data, "rounds", `g9r${n}`)).toEqual({
        id: `g9r${n}`,
        gameId: "g9",
        roundNumber: n,
      });
    }
    expect(row(data, "seats", "s9")).toEqual({
      id: "s9",
      gameId: "g9",
      playerId: "p1",
      orderNumber: 0,
    });
  });

  it("lets guests create games", () => {
    const data = world();
    run(data, guest, "createGame", args());
    expect(row(data, "games", "g9").createdBy).toBe("guest1");
  });

  it("requires a signed-in user", () => {
    reject(world(), anon, "createGame", args(), "not_signed_in");
  });

  it("needs exactly 13 unique round ids", () => {
    const data = world();
    reject(
      data,
      alice,
      "createGame",
      args({ roundIds: roundIds("g9").slice(1) }),
      "invalid"
    );
    reject(
      data,
      alice,
      "createGame",
      args({ roundIds: [...roundIds("g9"), "extra"] }),
      "invalid"
    );
    reject(
      data,
      alice,
      "createGame",
      args({ roundIds: [...roundIds("g9").slice(1), "g9r1"] }),
      "invalid"
    );
  });

  it("needs an existing, unmerged player", () => {
    const data = world();
    reject(data, alice, "createGame", args({ playerId: "nope" }), "not_found");
    seed(data, "players", { id: "p4", name: "Dan", mergedInto: "p3" });
    reject(data, alice, "createGame", args({ playerId: "p4" }), "merged");
  });

  it("is idempotent for the creator, and conflicts for other ids in use", () => {
    const data = world();
    run(data, alice, "createGame", args());
    expect(run(data, alice, "createGame", args())).toEqual([]);
    reject(data, bob, "createGame", args(), "conflict");
    reject(
      data,
      alice,
      "createGame",
      args({ gameId: "g10", seatId: "s1" }),
      "conflict"
    );
    reject(
      data,
      alice,
      "createGame",
      args({ gameId: "g10", seatId: "s10", roundIds: roundIds("g1") }),
      "conflict"
    );
  });
});

describe("deleteGame", () => {
  it("soft-deletes for the creator", () => {
    const data = world();
    run(data, alice, "deleteGame", { gameId: "g1" });
    expect(row(data, "games", "g1").deletedAt).toBe(NOW);
  });

  it("does nothing to a game that is already deleted", () => {
    const data = world();
    run(data, alice, "deleteGame", { gameId: "g1" });
    expect(run(data, ctxFor("alice"), "deleteGame", { gameId: "g1" })).toEqual(
      []
    );
  });

  it("rejects non-creators, unknown games and signed-out users", () => {
    const data = world();
    reject(data, bob, "deleteGame", { gameId: "g1" }, "forbidden");
    reject(data, alice, "deleteGame", { gameId: "nope" }, "not_found");
    reject(data, anon, "deleteGame", { gameId: "g1" }, "not_signed_in");
  });
});

describe("addSeat", () => {
  const args = (over: Partial<ActionArgs["addSeat"]> = {}) => ({
    seatId: "s9",
    gameId: "g1",
    playerId: "p4",
    orderNumber: 3,
    ...over,
  });

  it("lets the creator seat any player", () => {
    const data = world();
    const ops = run(data, alice, "addSeat", args());
    expect(ops).toEqual([
      {
        op: "put",
        table: "seats",
        row: { id: "s9", gameId: "g1", playerId: "p4", orderNumber: 3 },
      },
    ]);
  });

  it("lets a user seat their own claimed player before the game starts", () => {
    const data = world();
    run(data, carol, "claimPlayer", { playerId: "p4" });
    run(data, carol, "addSeat", args());
    expect(row(data, "seats", "s9").playerId).toBe("p4");
  });

  it("rejects a claimer once the game has started", () => {
    const data = startedWorld();
    run(data, carol, "claimPlayer", { playerId: "p4" });
    reject(data, carol, "addSeat", args(), "started");
    // The creator can still add players mid-game.
    run(data, alice, "addSeat", args());
  });

  it("rejects non-creators who haven't claimed the player", () => {
    const data = world();
    reject(data, carol, "addSeat", args(), "forbidden");
    // Claimed by someone else doesn't count either.
    reject(data, carol, "addSeat", args({ playerId: "p2" }), "forbidden");
  });

  it("rejects deleted games", () => {
    const data = world();
    run(data, alice, "deleteGame", { gameId: "g1" });
    reject(data, alice, "addSeat", args(), "not_found");
  });

  it("rejects unknown games and players, and signed-out users", () => {
    const data = world();
    reject(data, alice, "addSeat", args({ gameId: "nope" }), "not_found");
    reject(data, alice, "addSeat", args({ playerId: "nope" }), "not_found");
    reject(data, anon, "addSeat", args(), "not_signed_in");
  });

  it("rejects merged players", () => {
    const data = world();
    seed(data, "players", { id: "p4", name: "Dan", mergedInto: "p3" });
    reject(data, alice, "addSeat", args(), "merged");
  });

  it("rejects a player who is already seated", () => {
    reject(world(), alice, "addSeat", args({ playerId: "p2" }), "conflict");
  });

  it("is idempotent for the same seat, and conflicts on a reused seat id", () => {
    const data = world();
    run(data, alice, "addSeat", args());
    expect(run(data, alice, "addSeat", args())).toEqual([]);
    reject(data, alice, "addSeat", args({ playerId: "p2" }), "conflict");
    reject(data, alice, "addSeat", args({ seatId: "s1" }), "conflict");
  });

  it("rejects a bad order number", () => {
    const data = world();
    reject(data, alice, "addSeat", args({ orderNumber: -1 }), "invalid");
    reject(data, alice, "addSeat", args({ orderNumber: 1.5 }), "invalid");
  });
});

describe("removeSeat", () => {
  it("deletes the seat for the creator", () => {
    const data = world();
    const ops = run(data, alice, "removeSeat", { seatId: "s3" });
    expect(ops).toEqual([{ op: "delete", table: "seats", id: "s3" }]);
    expect(data.seats.has("s3")).toBe(false);
  });

  it("does nothing when the seat is already gone", () => {
    expect(run(world(), alice, "removeSeat", { seatId: "nope" })).toEqual([]);
  });

  it("rejects non-creators and signed-out users", () => {
    const data = world();
    reject(data, bob, "removeSeat", { seatId: "s3" }, "forbidden");
    reject(data, anon, "removeSeat", { seatId: "s3" }, "not_signed_in");
  });

  it("rejects a player who has turns in this game", () => {
    const data = startedWorld();
    reject(data, alice, "removeSeat", { seatId: "s1" }, "has_turns");
    // Players with no turns can still be removed.
    run(data, alice, "removeSeat", { seatId: "s2" });
  });

  it("ignores turns the player has in other games", () => {
    const data = worldWithDan();
    run(data, alice, "addSeat", {
      seatId: "s5",
      gameId: "g1",
      playerId: "p4",
      orderNumber: 3,
    });
    run(data, alice, "removeSeat", { seatId: "s5" });
    expect(data.seats.has("s5")).toBe(false);
  });
});

describe("reorderSeats", () => {
  it("puts orderNumber = index for every seat", () => {
    const data = world();
    const ops = run(data, alice, "reorderSeats", {
      gameId: "g1",
      seatIds: ["s3", "s1", "s2"],
    });
    expect(ops).toHaveLength(3);
    expect(row(data, "seats", "s3").orderNumber).toBe(0);
    expect(row(data, "seats", "s1").orderNumber).toBe(1);
    expect(row(data, "seats", "s2").orderNumber).toBe(2);
    expect(row(data, "seats", "s2").playerId).toBe("p2");
  });

  it("rejects non-creators, unknown games and signed-out users", () => {
    const data = world();
    const args = { gameId: "g1", seatIds: ["s1", "s2", "s3"] };
    reject(data, bob, "reorderSeats", args, "forbidden");
    reject(
      data,
      alice,
      "reorderSeats",
      { ...args, gameId: "nope" },
      "not_found"
    );
    reject(data, anon, "reorderSeats", args, "not_signed_in");
  });

  it("requires exactly the game's seats", () => {
    const data = worldWithDan();
    const bad = (seatIds: string[]) =>
      reject(data, alice, "reorderSeats", { gameId: "g1", seatIds }, "invalid");
    bad(["s1", "s2"]); // missing one
    bad(["s1", "s2", "s3", "s4"]); // extra, from another game
    bad(["s1", "s2", "s4"]); // wrong one
    bad(["s1", "s1", "s2"]); // duplicate
    bad(["s1", "s2", "s3", "s3"]); // duplicate plus right length
  });
});

describe("setInitialDealer", () => {
  it("sets the dealer for the creator", () => {
    const data = world();
    run(data, alice, "setInitialDealer", { gameId: "g1", playerId: "p2" });
    expect(row(data, "games", "g1").initialDealerId).toBe("p2");
    run(data, alice, "setInitialDealer", { gameId: "g1", playerId: "p3" });
    expect(row(data, "games", "g1").initialDealerId).toBe("p3");
  });

  it("rejects non-creators, unknown games and signed-out users", () => {
    const data = world();
    const args = { gameId: "g1", playerId: "p2" };
    reject(data, bob, "setInitialDealer", args, "forbidden");
    reject(
      data,
      alice,
      "setInitialDealer",
      { ...args, gameId: "nope" },
      "not_found"
    );
    reject(data, anon, "setInitialDealer", args, "not_signed_in");
  });

  it("rejects once the game has started", () => {
    reject(
      startedWorld(),
      alice,
      "setInitialDealer",
      { gameId: "g1", playerId: "p2" },
      "started"
    );
  });

  it("rejects a player who isn't seated", () => {
    reject(
      world(),
      alice,
      "setInitialDealer",
      { gameId: "g1", playerId: "p4" },
      "invalid"
    );
  });
});

describe("placeBid", () => {
  const args = (over: Partial<ActionArgs["placeBid"]> = {}) => ({
    turnId: "t9",
    roundId: "g1r0",
    playerId: "p2",
    bid: 3,
    ...over,
  });

  it("creates a turn with the bid and no score", () => {
    const data = world();
    const ops = run(data, alice, "placeBid", args());
    expect(ops).toEqual([
      {
        op: "put",
        table: "turns",
        row: { id: "t9", roundId: "g1r0", playerId: "p2", bid: 3, score: null },
      },
    ]);
  });

  it("accepts bids from 0 up to the round's card count", () => {
    const data = world();
    run(data, alice, "placeBid", args({ turnId: "a", bid: 0 }));
    run(data, alice, "placeBid", args({ turnId: "b", playerId: "p1", bid: 7 }));
    // Round 6 deals one card.
    run(
      data,
      alice,
      "placeBid",
      args({ turnId: "c", roundId: "g1r6", bid: 1 })
    );
    // Round 12 deals seven again.
    run(
      data,
      alice,
      "placeBid",
      args({ turnId: "d", roundId: "g1r12", bid: 7 })
    );
  });

  it("rejects bids outside 0..numCards or not whole numbers", () => {
    const data = world();
    reject(data, alice, "placeBid", args({ bid: 8 }), "invalid");
    reject(data, alice, "placeBid", args({ bid: -1 }), "invalid");
    reject(data, alice, "placeBid", args({ bid: 1.5 }), "invalid");
    reject(data, alice, "placeBid", args({ bid: NaN }), "invalid");
    reject(
      data,
      alice,
      "placeBid",
      args({ bid: "3" as unknown as number }),
      "invalid"
    );
    reject(
      data,
      alice,
      "placeBid",
      args({ roundId: "g1r6", bid: 2 }),
      "invalid"
    );
    reject(
      data,
      alice,
      "placeBid",
      args({ roundId: "g1r5", bid: 3 }),
      "invalid"
    );
  });

  it("only the creator may bid", () => {
    const data = world();
    reject(data, bob, "placeBid", args(), "forbidden");
    reject(data, guest, "placeBid", args(), "forbidden");
    reject(data, anon, "placeBid", args(), "not_signed_in");
  });

  it("rejects unknown rounds", () => {
    reject(world(), alice, "placeBid", args({ roundId: "nope" }), "not_found");
  });

  it("rejects deleted games", () => {
    const data = world();
    run(data, alice, "deleteGame", { gameId: "g1" });
    reject(data, alice, "placeBid", args(), "not_found");
  });

  it("rejects players who aren't seated in the game", () => {
    reject(world(), alice, "placeBid", args({ playerId: "p4" }), "invalid");
  });

  it("rejects a second turn for the same round and player", () => {
    const data = world();
    run(data, alice, "placeBid", args());
    reject(data, alice, "placeBid", args({ turnId: "t10" }), "conflict");
    // Other players and other rounds are fine.
    run(data, alice, "placeBid", args({ turnId: "t11", playerId: "p1" }));
    run(data, alice, "placeBid", args({ turnId: "t12", roundId: "g1r1" }));
  });

  it("is a no-op when the same turn already exists", () => {
    const data = world();
    run(data, alice, "placeBid", args());
    expect(run(data, alice, "placeBid", args())).toEqual([]);
    expect(data.turns.size).toBe(1);
  });

  it("rejects reusing a turn id for a different round or player", () => {
    const data = world();
    run(data, alice, "placeBid", args());
    reject(data, alice, "placeBid", args({ roundId: "g1r1" }), "conflict");
    reject(data, alice, "placeBid", args({ playerId: "p1" }), "conflict");
  });
});

describe("setScore", () => {
  it("sets the score on a turn that has a bid", () => {
    const data = startedWorld();
    const ops = run(data, alice, "setScore", { turnId: "t1", score: 12 });
    expect(ops).toEqual([
      {
        op: "put",
        table: "turns",
        row: { id: "t1", roundId: "g1r0", playerId: "p1", bid: 2, score: 12 },
      },
    ]);
  });

  it("accepts 0 and 30 and rejects anything else", () => {
    const data = startedWorld();
    run(data, alice, "setScore", { turnId: "t1", score: 0 });
    run(data, alice, "setScore", { turnId: "t1", score: 30 });
    reject(data, alice, "setScore", { turnId: "t1", score: 31 }, "invalid");
    reject(data, alice, "setScore", { turnId: "t1", score: -1 }, "invalid");
    reject(data, alice, "setScore", { turnId: "t1", score: 2.5 }, "invalid");
    reject(
      data,
      alice,
      "setScore",
      { turnId: "t1", score: null as unknown as number },
      "invalid"
    );
  });

  it("rejects a turn without a bid", () => {
    const data = startedWorld();
    seed(data, "turns", {
      id: "t2",
      roundId: "g1r0",
      playerId: "p2",
      bid: null,
    });
    reject(data, alice, "setScore", { turnId: "t2", score: 1 }, "invalid");
  });

  it("only the creator may score", () => {
    const data = startedWorld();
    reject(data, bob, "setScore", { turnId: "t1", score: 1 }, "forbidden");
    reject(data, anon, "setScore", { turnId: "t1", score: 1 }, "not_signed_in");
  });

  it("rejects unknown turns", () => {
    reject(
      startedWorld(),
      alice,
      "setScore",
      { turnId: "nope", score: 1 },
      "not_found"
    );
  });
});

describe("clearScore", () => {
  it("sets the score to null", () => {
    const data = startedWorld();
    run(data, alice, "setScore", { turnId: "t1", score: 12 });
    run(data, alice, "clearScore", { turnId: "t1" });
    expect(row(data, "turns", "t1")).toEqual({
      id: "t1",
      roundId: "g1r0",
      playerId: "p1",
      bid: 2,
      score: null,
    });
  });

  it("only the creator may clear", () => {
    const data = startedWorld();
    reject(data, bob, "clearScore", { turnId: "t1" }, "forbidden");
    reject(data, anon, "clearScore", { turnId: "t1" }, "not_signed_in");
  });

  it("rejects unknown turns", () => {
    reject(
      startedWorld(),
      alice,
      "clearScore",
      { turnId: "nope" },
      "not_found"
    );
  });
});

describe("deleteTurn", () => {
  it("deletes the turn", () => {
    const data = startedWorld();
    const ops = run(data, alice, "deleteTurn", { turnId: "t1" });
    expect(ops).toEqual([{ op: "delete", table: "turns", id: "t1" }]);
    expect(data.turns.size).toBe(0);
  });

  it("unstarts the game once its last turn is gone", () => {
    const data = startedWorld();
    run(data, alice, "deleteTurn", { turnId: "t1" });
    run(data, alice, "setInitialDealer", { gameId: "g1", playerId: "p2" });
  });

  it("only the creator may delete", () => {
    const data = startedWorld();
    reject(data, bob, "deleteTurn", { turnId: "t1" }, "forbidden");
    reject(data, anon, "deleteTurn", { turnId: "t1" }, "not_signed_in");
  });

  it("does nothing when the turn is already gone", () => {
    expect(
      run(startedWorld(), alice, "deleteTurn", { turnId: "nope" })
    ).toEqual([]);
  });
});

describe("mergePlayers", () => {
  // p4 (Dan) is merged into p1 (Alice, claimed by alice). Dan has seat s4,
  // turn t4 and is initial dealer of g2; Alice is only in g1.
  const merge = { fromId: "p4", intoId: "p1" };

  it("does nothing when the player was already merged into the target", () => {
    const data = worldWithDan();
    run(data, alice, "mergePlayers", merge);
    expect(run(data, alice, "mergePlayers", merge)).toEqual([]);
  });

  it("moves seats, turns and dealer games to the target and logs it", () => {
    const data = worldWithDan();
    const before = snapshot(data);
    run(data, alice, "mergePlayers", merge);

    expect(row(data, "seats", "s4").playerId).toBe("p1");
    expect(row(data, "turns", "t4").playerId).toBe("p1");
    expect(row(data, "games", "g2").initialDealerId).toBe("p1");
    expect(row(data, "players", "p4")).toEqual({
      ...before.players.get("p4"),
      mergedInto: "p1",
      mergedAt: NOW,
      mergeLog: {
        into: "p1",
        seats: ["s4"],
        turns: ["t4"],
        dealerGames: ["g2"],
      },
    });
    // Nothing else changed.
    expect(row(data, "players", "p1")).toEqual(before.players.get("p1"));
    expect(row(data, "seats", "s1")).toEqual(before.seats.get("s1"));
    expect(row(data, "games", "g1")).toEqual(before.games.get("g1"));
  });

  it("lets the owner of the target merge even as a guest", () => {
    const data = worldWithDan();
    run(data, ctxFor("alice", true), "mergePlayers", merge);
    expect(row(data, "players", "p4").mergedInto).toBe("p1");
  });

  it("lets any non-guest user merge unowned players", () => {
    const data = worldWithDan();
    run(data, carol, "mergePlayers", { fromId: "p4", intoId: "p3" });
    expect(row(data, "players", "p4").mergedInto).toBe("p3");
  });

  it("rejects guests who don't own the target", () => {
    const data = worldWithDan();
    reject(
      data,
      guest,
      "mergePlayers",
      { fromId: "p4", intoId: "p3" },
      "forbidden"
    );
    reject(data, ctxFor("bob", true), "mergePlayers", merge, "forbidden");
  });

  it("rejects signed-out users", () => {
    reject(worldWithDan(), anon, "mergePlayers", merge, "not_signed_in");
  });

  it("rejects unknown players and merging a player into itself", () => {
    const data = worldWithDan();
    reject(
      data,
      alice,
      "mergePlayers",
      { fromId: "nope", intoId: "p1" },
      "not_found"
    );
    reject(
      data,
      alice,
      "mergePlayers",
      { fromId: "p4", intoId: "nope" },
      "not_found"
    );
    reject(
      data,
      alice,
      "mergePlayers",
      { fromId: "p1", intoId: "p1" },
      "invalid"
    );
  });

  it("rejects players that are already merged", () => {
    const data = worldWithDan();
    run(data, alice, "mergePlayers", merge);
    reject(
      data,
      alice,
      "mergePlayers",
      { fromId: "p4", intoId: "p3" },
      "merged"
    );
    reject(
      data,
      alice,
      "mergePlayers",
      { fromId: "p3", intoId: "p4" },
      "merged"
    );
  });

  it("rejects a claimed source", () => {
    const data = worldWithDan();
    reject(
      data,
      carol,
      "mergePlayers",
      { fromId: "p2", intoId: "p4" },
      "claimed"
    );
    // Even the user who claimed the source can't merge it away.
    reject(
      data,
      bob,
      "mergePlayers",
      { fromId: "p2", intoId: "p4" },
      "claimed"
    );
  });

  it("allows a claimed source only for ctx.internal.allowClaimedFrom", () => {
    const data = worldWithDan();
    const internal = (allowClaimedFrom?: string) =>
      ctxFor("bob", false, { allowClaimedFrom });
    const args = { fromId: "p2", intoId: "p4" };
    reject(data, internal("someone-else"), "mergePlayers", args, "claimed");
    reject(data, internal(undefined), "mergePlayers", args, "claimed");
    run(data, internal("bob"), "mergePlayers", args);
    expect(row(data, "players", "p2").mergedInto).toBe("p4");
  });

  it("an unclaimed source doesn't need allowClaimedFrom", () => {
    const data = worldWithDan();
    run(
      data,
      ctxFor("alice", false, { allowClaimedFrom: "other" }),
      "mergePlayers",
      merge
    );
  });

  it("rejects players who share a non-deleted game", () => {
    const data = world();
    reject(
      data,
      carol,
      "mergePlayers",
      { fromId: "p3", intoId: "p2" },
      "shared_game"
    );
  });

  it("allows players who only share a deleted game", () => {
    const data = world();
    run(data, alice, "deleteGame", { gameId: "g1" });
    run(data, carol, "mergePlayers", { fromId: "p3", intoId: "p2" });
    expect(row(data, "seats", "s3").playerId).toBe("p2");
  });
});

describe("undoMerge", () => {
  const merge = { fromId: "p4", intoId: "p1" };

  // Like worldWithDan, but Dan's row carries explicit null merge fields so a
  // merge + undo restores it exactly.
  function mergeFixture(): DataState {
    const data = worldWithDan();
    seed(data, "players", {
      ...row(data, "players", "p4"),
      mergedInto: null,
      mergedAt: null,
      mergeLog: null,
    });
    return data;
  }

  it("restores the exact original rows after a merge", () => {
    const data = mergeFixture();
    const before = snapshot(data);
    run(data, alice, "mergePlayers", merge);
    expect(data).not.toEqual(before);
    run(data, alice, "undoMerge", { fromId: "p4" });
    expect(data).toEqual(before);
  });

  it("only moves rows held by the merge target or its merge chain", () => {
    const data = mergeFixture();
    run(data, alice, "mergePlayers", merge);
    // Dan's seat and turn were handed to someone off the chain since.
    seed(data, "seats", { ...row(data, "seats", "s4"), playerId: "p3" });
    seed(data, "turns", { ...row(data, "turns", "t4"), playerId: "p3" });
    seed(data, "games", { ...row(data, "games", "g2"), initialDealerId: "p3" });
    expect(run(data, carol, "undoMerge", { fromId: "p4" })).toHaveLength(1);
    expect(row(data, "seats", "s4").playerId).toBe("p3");
    expect(row(data, "turns", "t4").playerId).toBe("p3");
    expect(row(data, "games", "g2").initialDealerId).toBe("p3");
    expect(row(data, "players", "p4").mergedInto).toBeNull();
  });

  it("also moves turns added to the target after the merge", () => {
    const data = mergeFixture();
    run(data, alice, "placeBid", {
      turnId: "t1",
      roundId: "g1r0",
      playerId: "p1",
      bid: 1,
    });
    run(data, alice, "mergePlayers", merge);
    // Alice (now holding Dan's seat in g2) bids in another round of g2.
    run(data, alice, "placeBid", {
      turnId: "t5",
      roundId: "g2r1",
      playerId: "p1",
      bid: 2,
    });
    run(data, alice, "undoMerge", { fromId: "p4" });
    expect(row(data, "turns", "t5").playerId).toBe("p4");
    expect(row(data, "turns", "t4").playerId).toBe("p4");
    // Her own turn in a different game stays with her.
    expect(row(data, "turns", "t1").playerId).toBe("p1");
    expect(row(data, "seats", "s4").playerId).toBe("p4");
  });

  it("restores the dealer only where the target is still the dealer", () => {
    const data = mergeFixture();
    run(data, alice, "mergePlayers", merge);
    run(data, alice, "undoMerge", { fromId: "p4" });
    expect(row(data, "games", "g2").initialDealerId).toBe("p4");
  });

  describe("chained merges", () => {
    // Three players, each hosting their own game with a bid and as dealer.
    function chain(): DataState {
      const data = createMemoryState();
      for (const [n, letter] of [
        ["a", "A"],
        ["b", "B"],
        ["c", "C"],
      ]) {
        run(data, alice, "createPlayer", { playerId: `p${n}`, name: letter });
        run(data, alice, "createGame", {
          gameId: `g${n}`,
          roundIds: roundIds(`g${n}`),
          seatId: `s${n}`,
          playerId: `p${n}`,
        });
        run(data, alice, "setInitialDealer", {
          gameId: `g${n}`,
          playerId: `p${n}`,
        });
        run(data, alice, "placeBid", {
          turnId: `t${n}`,
          roundId: `g${n}r0`,
          playerId: `p${n}`,
          bid: 1,
        });
      }
      for (const id of ["pa", "pb", "pc"]) {
        seed(data, "players", {
          ...row(data, "players", id),
          mergedInto: null,
          mergedAt: null,
          mergeLog: null,
        });
      }
      return data;
    }
    const mergeAB = { fromId: "pa", intoId: "pb" };
    const mergeBC = { fromId: "pb", intoId: "pc" };

    it("undoing A then B leaves A's history with A", () => {
      const data = chain();
      const before = snapshot(data);
      run(data, alice, "mergePlayers", mergeAB);
      run(data, alice, "mergePlayers", mergeBC);
      expect(row(data, "seats", "sa").playerId).toBe("pc");

      run(data, alice, "undoMerge", { fromId: "pa" });
      expect(row(data, "seats", "sa").playerId).toBe("pa");
      expect(row(data, "turns", "ta").playerId).toBe("pa");
      expect(row(data, "games", "ga").initialDealerId).toBe("pa");

      run(data, alice, "undoMerge", { fromId: "pb" });
      expect(row(data, "seats", "sa").playerId).toBe("pa");
      expect(row(data, "turns", "ta").playerId).toBe("pa");
      expect(row(data, "games", "ga").initialDealerId).toBe("pa");
      expect(data).toEqual(before);
    });

    it("undoing B then A also restores everything", () => {
      const data = chain();
      const before = snapshot(data);
      run(data, alice, "mergePlayers", mergeAB);
      run(data, alice, "mergePlayers", mergeBC);

      run(data, alice, "undoMerge", { fromId: "pb" });
      // B's log covers A's rows too, so they return to B for now.
      expect(row(data, "seats", "sa").playerId).toBe("pb");
      run(data, alice, "undoMerge", { fromId: "pa" });
      expect(row(data, "seats", "sa").playerId).toBe("pa");
      expect(data).toEqual(before);
    });

    it("works when the merged players were claimed by other users", () => {
      const data = chain();
      // A was a guest's player, B belongs to bob, C to dave.
      const claim = (id: string, userId: string) =>
        seed(data, "players", {
          ...row(data, "players", id),
          claimedBy: userId,
        });
      claim("pa", "guest-a");
      claim("pb", "bob");
      claim("pc", "dave");
      const before = snapshot(data);
      const withInternal = (userId: string, allow: string) =>
        ctxFor(userId, false, { allowClaimedFrom: allow });
      run(data, withInternal("bob", "guest-a"), "mergePlayers", mergeAB);
      run(data, withInternal("dave", "bob"), "mergePlayers", mergeBC);

      // A is claimed, so only the owner of its target (B -> bob) may undo it.
      reject(data, carol, "undoMerge", { fromId: "pa" }, "forbidden");
      reject(data, alice, "undoMerge", { fromId: "pa" }, "forbidden");
      run(data, bob, "undoMerge", { fromId: "pa" });
      expect(row(data, "seats", "sa").playerId).toBe("pa");
      expect(row(data, "turns", "tb").playerId).toBe("pc");

      // B is claimed too: only dave (owner of C) may undo.
      reject(data, bob, "undoMerge", { fromId: "pb" }, "forbidden");
      run(data, ctxFor("dave", true), "undoMerge", { fromId: "pb" });
      expect(row(data, "seats", "sa").playerId).toBe("pa");
      expect(row(data, "seats", "sb").playerId).toBe("pb");
      expect(data).toEqual(before);
    });

    it("stops following the chain at a cycle or a missing player", () => {
      const data = chain();
      run(data, alice, "mergePlayers", mergeAB);
      seed(data, "players", {
        ...row(data, "players", "pb"),
        mergedInto: "pa",
      });
      run(data, alice, "undoMerge", { fromId: "pa" });
      expect(row(data, "seats", "sa").playerId).toBe("pa");

      const lone = chain();
      run(lone, alice, "mergePlayers", mergeAB);
      lone.players.delete("pb");
      run(lone, alice, "undoMerge", { fromId: "pa" });
      expect(row(lone, "seats", "sa").playerId).toBe("pa");
    });
  });

  it("only the target's owner may undo when the player was claimed", () => {
    const data = mergeFixture();
    seed(data, "players", { ...row(data, "players", "p4"), claimedBy: "g1" });
    run(
      data,
      ctxFor("alice", false, { allowClaimedFrom: "g1" }),
      "mergePlayers",
      merge
    );
    reject(data, carol, "undoMerge", { fromId: "p4" }, "forbidden");
    run(data, alice, "undoMerge", { fromId: "p4" });
    expect(row(data, "players", "p4").mergedInto).toBeNull();
  });

  it("skips logged rows that no longer exist", () => {
    const data = mergeFixture();
    run(data, alice, "mergePlayers", merge);
    run(data, alice, "deleteTurn", { turnId: "t4" });
    run(data, alice, "removeSeat", { seatId: "s4" });
    run(data, alice, "undoMerge", { fromId: "p4" });
    expect(data.turns.has("t4")).toBe(false);
    expect(data.seats.has("s4")).toBe(false);
    expect(row(data, "players", "p4").mergeLog).toBeNull();
  });

  it("clears the merge fields", () => {
    const data = mergeFixture();
    run(data, alice, "mergePlayers", merge);
    run(data, alice, "undoMerge", { fromId: "p4" });
    const dan = row(data, "players", "p4");
    expect(dan.mergedInto).toBeNull();
    expect(dan.mergedAt).toBeNull();
    expect(dan.mergeLog).toBeNull();
  });

  it("lets any non-guest user undo", () => {
    const data = mergeFixture();
    run(data, alice, "mergePlayers", merge);
    run(data, carol, "undoMerge", { fromId: "p4" });
    expect(row(data, "players", "p4").mergedInto).toBeNull();
  });

  it("lets a guest undo only if they own the player it was merged into", () => {
    const data = mergeFixture();
    run(data, alice, "mergePlayers", merge);
    reject(data, guest, "undoMerge", { fromId: "p4" }, "forbidden");
    reject(
      data,
      ctxFor("bob", true),
      "undoMerge",
      { fromId: "p4" },
      "forbidden"
    );
    run(data, ctxFor("alice", true), "undoMerge", { fromId: "p4" });
    expect(row(data, "players", "p4").mergedInto).toBeNull();
  });

  it("does nothing for a player that isn't merged", () => {
    expect(run(mergeFixture(), alice, "undoMerge", { fromId: "p4" })).toEqual(
      []
    );
  });

  it("rejects unknown players and signed-out users", () => {
    const data = mergeFixture();
    reject(data, alice, "undoMerge", { fromId: "nope" }, "not_found");
    run(data, alice, "mergePlayers", merge);
    reject(data, anon, "undoMerge", { fromId: "p4" }, "not_signed_in");
  });
});

describe("importGame", () => {
  const stamp = "2026-02-01T10:00:00.000Z";
  // A finished-looking local game: p2 exists on the server, "n1" is new.
  const payload = (): ActionArgs["importGame"] => ({
    game: {
      id: "gi",
      createdAt: stamp,
      createdBy: "alice",
      initialDealerId: "n1",
    },
    newPlayers: [{ id: "n1", name: " Newbie " }],
    seats: [
      { id: "is1", gameId: "gi", playerId: "n1", orderNumber: 0 },
      { id: "is2", gameId: "gi", playerId: "p2", orderNumber: 1 },
    ],
    rounds: [
      { id: "ir0", gameId: "gi", roundNumber: 0 },
      { id: "ir1", gameId: "gi", roundNumber: 1 },
    ],
    turns: [
      { id: "it1", roundId: "ir0", playerId: "n1", bid: 3, score: 13 },
      { id: "it2", roundId: "ir0", playerId: "p2", bid: 0, score: null },
      { id: "it3", roundId: "ir1", playerId: "n1", bid: 6, score: 0 },
    ],
  });
  const change = (fn: (p: ActionArgs["importGame"]) => void) => {
    const p = payload();
    fn(p);
    return p;
  };

  it("creates the game, players, seats, rounds and turns", () => {
    const data = world();
    run(data, alice, "importGame", payload());
    expect(row(data, "players", "n1")).toEqual({
      id: "n1",
      name: "Newbie",
      createdAt: NOW,
    });
    expect(row(data, "games", "gi")).toEqual({
      id: "gi",
      createdAt: stamp,
      createdBy: "alice",
      initialDealerId: "n1",
    });
    expect(data.seats.get("is2")).toEqual({
      id: "is2",
      gameId: "gi",
      playerId: "p2",
      orderNumber: 1,
    });
    expect(row(data, "rounds", "ir1").roundNumber).toBe(1);
    expect(row(data, "turns", "it1")).toEqual({
      id: "it1",
      roundId: "ir0",
      playerId: "n1",
      bid: 3,
      score: 13,
    });
    expect(data.turns.size).toBe(3);
  });

  it("is a no-op when the same game was already imported", () => {
    const data = world();
    run(data, alice, "importGame", payload());
    expect(run(data, alice, "importGame", payload())).toEqual([]);
  });

  it("requires a signed-in user", () => {
    reject(world(), anon, "importGame", payload(), "not_signed_in");
  });

  it("only imports games created by the caller", () => {
    reject(world(), bob, "importGame", payload(), "forbidden");
    reject(
      world(),
      alice,
      "importGame",
      change((p) => (p.game.createdBy = "bob")),
      "forbidden"
    );
  });

  it("rejects a game id that is already in use", () => {
    const data = world();
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.game.id = "g1")),
      "conflict"
    );
    run(data, alice, "importGame", payload());
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.game.createdAt = "2020-01-01T00:00:00.000Z")),
      "conflict"
    );
  });

  it("rejects new players that clash with existing ones or have bad names", () => {
    const data = world();
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.newPlayers[0].id = "p1")),
      "conflict"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => p.newPlayers.push({ id: "n1", name: "Dup" })),
      "conflict"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.newPlayers[0].name = " ")),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.newPlayers[0].name = "x".repeat(41))),
      "invalid"
    );
  });

  it("rejects seats, rounds and turns that point at another game or round", () => {
    const data = world();
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.seats[0].gameId = "g1")),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.rounds[0].gameId = "g1")),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.turns[0].roundId = "g1r0")),
      "invalid"
    );
  });

  it("rejects references to unknown players", () => {
    const data = world();
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.seats[1].playerId = "nope")),
      "not_found"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.turns[0].playerId = "nope")),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.game.initialDealerId = "nope")),
      "invalid"
    );
  });

  it("rejects ids that already exist or repeat", () => {
    const data = world();
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.seats[0].id = "s1")),
      "conflict"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.rounds[0].id = "g1r0")),
      "conflict"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.turns[0].id = "it2")),
      "conflict"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.rounds[1].id = "ir0")),
      "conflict"
    );
  });

  it("rejects invalid rounds, seats, bids and scores", () => {
    const data = world();
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.rounds[0].roundNumber = 13)),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.rounds[1].roundNumber = 0)),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.seats[1].playerId = "n1")),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.turns[0].bid = 8)),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.turns[2].bid = 7)),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.turns[0].score = 31)),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) =>
        p.turns.push({ id: "it9", roundId: "ir0", playerId: "n1", bid: 1 })
      ),
      "invalid"
    );
  });

  it("leaves the state untouched when an import is rejected", () => {
    const data = world();
    const before = snapshot(data);
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.turns[2].score = 99)),
      "invalid"
    );
    expect(data).toEqual(before);
  });

  it("rejects existing players that have been merged", () => {
    const data = world();
    seed(data, "players", { id: "p4", name: "Dan", mergedInto: "p3" });
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.seats[1].playerId = "p4")),
      "merged"
    );
  });

  it("rejects turns and a dealer for players who aren't seated", () => {
    const data = world();
    reject(
      data,
      alice,
      "importGame",
      change((p) => {
        p.newPlayers.push({ id: "n2", name: "Unseated" });
        p.turns.push({ id: "it9", roundId: "ir1", playerId: "n2", bid: 1 });
      }),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.turns[1].playerId = "p1")),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.game.initialDealerId = "p1")),
      "invalid"
    );
  });

  it("rejects a score without a bid", () => {
    reject(
      world(),
      alice,
      "importGame",
      change((p) => (p.turns[1] = { ...p.turns[1], bid: null, score: 5 })),
      "invalid"
    );
  });

  it("validates the dates", () => {
    const data = world();
    const badDates = ["", "yesterday", "2026-13-45T99:99:99Z", "x".repeat(60)];
    for (const bad of [...badDates, 12345, {}, null]) {
      reject(
        data,
        alice,
        "importGame",
        change((p) => (p.game.createdAt = bad as string)),
        "invalid"
      );
    }
    for (const bad of [...badDates, 12345, {}]) {
      reject(
        data,
        alice,
        "importGame",
        change((p) => (p.game.deletedAt = bad as string)),
        "invalid"
      );
    }
    run(
      data,
      alice,
      "importGame",
      change((p) => (p.game.deletedAt = "2026-02-02T10:00:00Z"))
    );
    expect(row(data, "games", "gi").deletedAt).toBe("2026-02-02T10:00:00Z");
    const other = world();
    run(
      other,
      alice,
      "importGame",
      change((p) => (p.game.deletedAt = null))
    );
    expect(row(other, "games", "gi").deletedAt).toBeUndefined();
  });

  it("rejects non-object elements and non-array fields", () => {
    const data = world();
    const nulls = (key: "newPlayers" | "seats" | "rounds" | "turns") =>
      change((p) => ((p[key] as unknown[])[0] = null));
    for (const key of ["newPlayers", "seats", "rounds", "turns"] as const) {
      reject(data, alice, "importGame", nulls(key), "invalid");
      reject(
        data,
        alice,
        "importGame",
        change((p) => ((p[key] as unknown[])[0] = 5)),
        "invalid"
      );
      reject(
        data,
        alice,
        "importGame",
        change((p) => ((p as any)[key] = null)),
        "invalid"
      );
      reject(
        data,
        alice,
        "importGame",
        change((p) => ((p as any)[key] = {})),
        "invalid"
      );
    }
    reject(
      data,
      alice,
      "importGame",
      change((p) => ((p as any).game = null)),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => ((p as any).game = [])),
      "invalid"
    );
  });

  it("caps the size of the import", () => {
    const data = world();
    const manyPlayers = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `m${i}`, name: `M${i}` }));
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.newPlayers = manyPlayers(21))),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => {
        p.newPlayers = manyPlayers(21);
        p.seats = p.newPlayers.map((n, i) => ({
          id: `ms${i}`,
          gameId: "gi",
          playerId: n.id,
          orderNumber: i,
        }));
      }),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => {
        p.rounds = Array.from({ length: 14 }, (_, i) => ({
          id: `mr${i}`,
          gameId: "gi",
          roundNumber: i % 13,
        }));
      }),
      "invalid"
    );
    // 2 rounds x 2 seats allows 4 turns, not 5.
    reject(
      data,
      alice,
      "importGame",
      change((p) => {
        p.turns.push(
          { id: "x1", roundId: "ir1", playerId: "p2", bid: 1 },
          { id: "x2", roundId: "ir1", playerId: "p2", bid: 1 }
        );
      }),
      "invalid"
    );
    // The limits themselves are fine.
    const full = change((p) => {
      p.newPlayers = manyPlayers(20);
      p.seats = p.newPlayers.map((n, i) => ({
        id: `ms${i}`,
        gameId: "gi",
        playerId: n.id,
        orderNumber: i,
      }));
      p.rounds = Array.from({ length: 13 }, (_, i) => ({
        id: `mr${i}`,
        gameId: "gi",
        roundNumber: i,
      }));
      p.turns = [];
      p.game.initialDealerId = "m0";
    });
    run(data, alice, "importGame", full);
  });

  it("caps id length at 100 characters", () => {
    const data = world();
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.game.id = "x".repeat(101))),
      "invalid"
    );
    reject(
      data,
      alice,
      "importGame",
      change((p) => (p.newPlayers[0].id = "x".repeat(101))),
      "invalid"
    );
    reject(
      createMemoryState(),
      alice,
      "createPlayer",
      { playerId: "x".repeat(101), name: "Long" },
      "invalid"
    );
    run(createMemoryState(), alice, "createPlayer", {
      playerId: "x".repeat(100),
      name: "Long",
    });
  });
});

describe("storage failures", () => {
  it("re-throws StateError from ReadState instead of rejecting as invalid", async () => {
    const { StateError } = await import("./types");
    const failing = {
      get() {
        throw new StateError("database is locked");
      },
      where() {
        throw new StateError("database is locked");
      },
    };
    expect(() =>
      applyAction(
        failing as never,
        { id: "a1", name: "claimPlayer", args: { playerId: "p1" } },
        { userId: "u1", isGuest: false, now: "2026-01-01T00:00:00.000Z" }
      )
    ).toThrow(StateError);
  });
});
