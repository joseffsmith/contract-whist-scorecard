import { describe, expect, it } from "vitest";
import { autoFillZeroTricks, tricksFromScore } from "./autoFillZeroTricks";

describe("tricksFromScore", () => {
  it("reads a missed bid as the tricks and a made bid as score - 10", () => {
    expect(tricksFromScore(0)).toBe(0);
    expect(tricksFromScore(3)).toBe(3);
    expect(tricksFromScore(10)).toBe(0);
    expect(tricksFromScore(14)).toBe(4);
  });
});

describe("autoFillZeroTricks", () => {
  it("fills the rest with zero tricks once the cards are accounted for", () => {
    // 7 cards: A bid 3 and took 3 (13), B bid 1 and took 4 (4), C bid 0, D bid 2.
    const turns = [
      { id: "a", bid: 3, score: 13 },
      { id: "b", bid: 1, score: 4 },
      { id: "c", bid: 0, score: null },
      { id: "d", bid: 2 },
    ];
    expect(autoFillZeroTricks(turns, 7)).toEqual([
      { turnId: "c", score: 10 },
      { turnId: "d", score: 0 },
    ]);
  });

  it("keeps the order it was given", () => {
    const turns = [
      { id: "x", bid: 2, score: 7 },
      { id: "d", bid: 2, score: null },
      { id: "c", bid: 0, score: null },
    ];
    expect(autoFillZeroTricks(turns, 7).map((f) => f.turnId)).toEqual([
      "d",
      "c",
    ]);
  });

  it("does nothing while tricks are still missing", () => {
    const turns = [
      { id: "a", bid: 3, score: 13 },
      { id: "b", bid: 1, score: null },
    ];
    expect(autoFillZeroTricks(turns, 7)).toEqual([]);
  });

  it("does nothing if the entries add up to more than the cards", () => {
    const turns = [
      { id: "a", bid: 3, score: 5 },
      { id: "b", bid: 1, score: 4 },
      { id: "c", bid: 0, score: null },
    ];
    expect(autoFillZeroTricks(turns, 7)).toEqual([]);
  });

  it("does nothing when everyone already has a score", () => {
    const turns = [
      { id: "a", bid: 3, score: 13 },
      { id: "b", bid: 1, score: 4 },
    ];
    expect(autoFillZeroTricks(turns, 7)).toEqual([]);
  });
});
