import { describe, expect, it } from "vitest";
import { autoFillTricks, tricksFromScore } from "./autoFillTricks";

describe("tricksFromScore", () => {
  it("reads a missed bid as the tricks and a made bid as score - 10", () => {
    expect(tricksFromScore(0)).toBe(0);
    expect(tricksFromScore(3)).toBe(3);
    expect(tricksFromScore(10)).toBe(0);
    expect(tricksFromScore(14)).toBe(4);
  });
});

describe("autoFillTricks", () => {
  it("fills the rest with zero tricks once the cards are accounted for", () => {
    // 7 cards: A bid 3 and took 3 (13), B bid 1 and took 4 (4), C bid 0, D bid 2.
    const turns = [
      { id: "c", bid: 0, score: null },
      { id: "d", bid: 2 },
      { id: "a", bid: 3, score: 13 },
      { id: "b", bid: 1, score: 4 },
    ];
    expect(autoFillTricks(turns, 7)).toEqual([
      { turnId: "c", score: 10 },
      { turnId: "d", score: 0 },
    ]);
  });

  it("gives the last player the leftover tricks (bid made)", () => {
    // 7 cards: 2 + 3 + 1 entered, so the last player (bid 1) took 1.
    const turns = [
      { id: "a", bid: 2, score: 12 },
      { id: "b", bid: 3, score: 13 },
      { id: "c", bid: 1, score: 11 },
      { id: "d", bid: 1, score: null },
    ];
    expect(autoFillTricks(turns, 7)).toEqual([{ turnId: "d", score: 11 }]);
  });

  it("gives the last player the leftover tricks (bid missed)", () => {
    // Bid 0 but 1 trick left over: misses, scores just the trick.
    const turns = [
      { id: "a", bid: 2, score: 12 },
      { id: "b", bid: 3, score: 13 },
      { id: "c", bid: 1, score: 11 },
      { id: "d", bid: 0 },
    ];
    expect(autoFillTricks(turns, 7)).toEqual([{ turnId: "d", score: 1 }]);
  });

  it("scores a bid of 0 as made when the leftover is 0", () => {
    const turns = [
      { id: "a", bid: 4, score: 14 },
      { id: "b", bid: 3, score: 13 },
      { id: "c", bid: 0, score: null },
    ];
    expect(autoFillTricks(turns, 7)).toEqual([{ turnId: "c", score: 10 }]);
  });

  it("does nothing while more than one player is left and tricks are missing", () => {
    const turns = [
      { id: "a", bid: 3, score: 13 },
      { id: "b", bid: 1, score: null },
      { id: "c", bid: 1, score: null },
    ];
    expect(autoFillTricks(turns, 7)).toEqual([]);
  });

  it("does nothing if the entries add up to more than the cards", () => {
    const turns = [
      { id: "a", bid: 3, score: 5 },
      { id: "b", bid: 1, score: 4 },
      { id: "c", bid: 0, score: null },
    ];
    expect(autoFillTricks(turns, 7)).toEqual([]);
  });

  it("does nothing when everyone already has a score", () => {
    const turns = [
      { id: "a", bid: 3, score: 13 },
      { id: "b", bid: 1, score: 4 },
    ];
    expect(autoFillTricks(turns, 7)).toEqual([]);
  });
});
