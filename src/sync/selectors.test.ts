import { describe, expect, it } from "vitest";
import { createMemoryState } from "../../shared/actions";
import {
  selectActivePlayers,
  selectGame,
  selectHomeGames,
  selectPlayersByClaim,
} from "./selectors";

function fixture() {
  const view = createMemoryState();
  const ann = { id: "p1", name: "Ann", claimedBy: "u1" };
  const bob = { id: "p2", name: "Bob" };
  const old = {
    id: "p3",
    name: "Ann (old)",
    claimedBy: "u1",
    mergedInto: "p1",
  };
  for (const p of [bob, ann, old]) view.players.set(p.id, p);
  view.games.set("g1", {
    id: "g1",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "u1",
  });
  view.games.set("g2", {
    id: "g2",
    createdAt: "2026-01-02T00:00:00.000Z",
    createdBy: "u1",
    deletedAt: "2026-01-03T00:00:00.000Z",
  });
  view.seats.set("s2", {
    id: "s2",
    gameId: "g1",
    playerId: "p2",
    orderNumber: 1,
  });
  view.seats.set("s1", {
    id: "s1",
    gameId: "g1",
    playerId: "p1",
    orderNumber: 0,
  });
  view.seats.set("s3", {
    id: "s3",
    gameId: "g1",
    playerId: "gone",
    orderNumber: 2,
  });
  view.rounds.set("r1", { id: "r1", gameId: "g1", roundNumber: 1 });
  view.rounds.set("r0", { id: "r0", gameId: "g1", roundNumber: 0 });
  view.turns.set("t1", {
    id: "t1",
    roundId: "r0",
    playerId: "p1",
    bid: 2,
    score: 5,
  });
  view.turns.set("t2", { id: "t2", roundId: "r0", playerId: "p2", bid: 0 });
  return { view, ann, bob };
}

describe("selectHomeGames", () => {
  it("returns games with seats, rounds and turns in the old query shape", () => {
    const { view, ann, bob } = fixture();
    const { games } = selectHomeGames(view);
    expect(games.map((g) => g.id)).toEqual(["g1", "g2"]);

    const [g1, g2] = games;
    expect(g1).toMatchObject({ id: "g1", createdBy: "u1" });
    // Seats by orderNumber, with the player attached when known.
    expect(g1.playersOrders.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(g1.playersOrders[0]).toEqual({
      id: "s1",
      gameId: "g1",
      playerId: "p1",
      orderNumber: 0,
      player: ann,
    });
    expect(g1.playersOrders[1].player).toBe(bob);
    expect("player" in g1.playersOrders[2]).toBe(false);
    // Rounds by roundNumber, each with its turns and their players.
    expect(g1.rounds.map((r) => r.roundNumber)).toEqual([0, 1]);
    expect(g1.rounds[0].turns).toEqual([
      {
        id: "t1",
        roundId: "r0",
        playerId: "p1",
        bid: 2,
        score: 5,
        player: ann,
      },
      { id: "t2", roundId: "r0", playerId: "p2", bid: 0, player: bob },
    ]);
    expect(g1.rounds[1].turns).toEqual([]);
    // Deleted games are included; the UI filters them.
    expect(g2.deletedAt).toBe("2026-01-03T00:00:00.000Z");
    expect(g2.playersOrders).toEqual([]);
    expect(g2.rounds).toEqual([]);
  });

  it("is cached per view", () => {
    const { view } = fixture();
    const first = selectHomeGames(view);
    expect(selectHomeGames(view)).toBe(first);
    expect(selectHomeGames({ ...view })).not.toBe(first);
    expect(selectGame(view, "g1")).toBe(first.games[0]);
    expect(selectGame(view, "nope")).toBeUndefined();
    expect(selectGame(view, undefined)).toBeUndefined();
  });
});

describe("player selectors", () => {
  it("finds the players a user has claimed, skipping merged ones", () => {
    const { view, ann } = fixture();
    expect(selectPlayersByClaim(view, "u1")).toEqual([ann]);
    expect(selectPlayersByClaim(view, "u1")).toBe(
      selectPlayersByClaim(view, "u1")
    );
    expect(selectPlayersByClaim(view, "u2")).toEqual([]);
  });

  it("lists active players by name", () => {
    const { view } = fixture();
    expect(selectActivePlayers(view).map((p) => p.name)).toEqual([
      "Ann",
      "Bob",
    ]);
  });
});

describe("sharing between views", () => {
  const copy = (view: ReturnType<typeof fixture>["view"]) => ({
    players: new Map(view.players),
    games: new Map(view.games),
    seats: new Map(view.seats),
    rounds: new Map(view.rounds),
    turns: new Map(view.turns),
  });

  it("reuses games whose rows didn't change", () => {
    const { view } = fixture();
    // A second game that stays the same.
    view.games.set("g3", {
      id: "g3",
      createdAt: "2026-02-01T00:00:00.000Z",
      createdBy: "u1",
    });
    view.rounds.set("g3r", { id: "g3r", gameId: "g3", roundNumber: 0 });
    view.turns.set("g3t", {
      id: "g3t",
      roundId: "g3r",
      playerId: "p1",
      bid: 1,
    });
    const before = selectHomeGames(view);

    const next = copy(view);
    next.turns.set("t1", { ...view.turns.get("t1")!, score: 9 });
    const after = selectHomeGames(next);
    expect(after).not.toBe(before);
    const byId = (r: typeof before, id: string) =>
      r.games.find((g) => g.id === id);
    expect(byId(after, "g3")).toBe(byId(before, "g3"));
    expect(byId(after, "g2")).toBe(byId(before, "g2"));
    expect(byId(after, "g1")).not.toBe(byId(before, "g1"));
    expect(byId(after, "g1")!.rounds[0].turns[0].score).toBe(9);
  });

  it("rebuilds a game when a player it shows changes", () => {
    const { view } = fixture();
    const before = selectHomeGames(view);
    const next = copy(view);
    next.players.set("p1", { ...view.players.get("p1")!, name: "Annie" });
    const after = selectHomeGames(next);
    expect(after.games[0]).not.toBe(before.games[0]);
    expect(after.games[0].playersOrders[0].player?.name).toBe("Annie");
  });
});
