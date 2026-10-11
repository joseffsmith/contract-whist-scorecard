import { describe, expect, it } from "vitest";
import {
  computeAwards,
  computeHeadToHead,
  computeOpponents,
  computePlayerStats,
  StatsGame,
  styleFor,
  tallyRate,
} from "./playerStats";

// ── Factory ─────────────────────────────────────────────────────────────
// Player ids are their names. A cell is [bid, tricks] (score derived like the
// app does it), [bid] (bid placed, tricks not entered yet) or null (no turn).

type Cell = readonly [number, number] | readonly [number] | null;

const score = (bid: number, tricks: number) =>
  bid === tricks ? tricks + 10 : tricks;

function game(
  id: string,
  createdAt: string,
  names: string[],
  rounds: Cell[][],
  opts: { dealer?: string; deletedAt?: string; merged?: string[] } = {}
): StatsGame {
  const player = (name: string) => ({
    id: name,
    name,
    mergedInto: opts.merged?.includes(name) ? "other" : null,
  });
  return {
    id,
    createdAt,
    deletedAt: opts.deletedAt,
    initialDealerId: opts.dealer,
    playersOrders: names.map((n, i) => ({
      orderNumber: i,
      player: player(n),
    })),
    rounds: rounds.map((cells, roundNumber) => ({
      roundNumber,
      turns: cells.flatMap((cell, i) =>
        cell
          ? [
              {
                playerId: names[i],
                player: { id: names[i] },
                bid: cell[0],
                score: cell.length === 2 ? score(cell[0], cell[1]) : null,
              },
            ]
          : []
      ),
    })),
  };
}

// All 13 rounds filled in by fn(round, playerIndex).
function full(
  id: string,
  createdAt: string,
  names: string[],
  fn: (r: number, p: number) => Cell,
  opts: Parameters<typeof game>[4] = {}
) {
  const rounds = Array.from({ length: 13 }, (_, r) =>
    names.map((_, p) => fn(r, p))
  );
  return game(id, createdAt, names, rounds, opts);
}

// Everyone bids 1 and takes 1 (scores 11 a round, 143 a game).
const allMade = (): Cell => [1, 1];

const day = (n: number) =>
  `2026-01-${String(n).padStart(2, "0")}T12:00:00.000Z`;

// ── computePlayerStats ──────────────────────────────────────────────────

describe("computePlayerStats", () => {
  it("returns zeros and nulls for a player with no rounds", () => {
    const s = computePlayerStats([], "A");
    expect(s.rounds).toBe(0);
    expect(s.hitRate).toBeNull();
    expect(s.aggression).toBeNull();
    expect(s.style).toBeNull();
    expect(s.mostCommonBid).toBeNull();
    expect(s.bidCounts).toEqual({});
    expect(s.games).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.expectedWins).toBe(0);
    expect(s.winRatio).toBeNull();
    expect(s.personalBest).toBeNull();
    expect(s.averageScore).toBeNull();
    expect(s.form).toEqual([]);
    expect(s.longestMadeStreak).toBe(0);
    expect(s.currentMadeStreak).toBe(0);
    expect(tallyRate(s.asDealer)).toBeNull();
  });

  it("counts a seated player in a game with no rounds as a game, not a round", () => {
    const s = computePlayerStats([game("g", day(1), ["A", "B"], [])], "A");
    expect(s.games).toBe(1);
    expect(s.finished).toBe(0);
    expect(s.rounds).toBe(0);
  });

  it("reads made / missed from the score encoding", () => {
    // round 0 (7 cards): made 2, missed with 3 tricks on a bid of 2 (over),
    // missed with 1 trick on a bid of 2 (under), made a zero, missed a zero.
    const g = game(
      "g",
      day(1),
      ["A", "B"],
      [
        [[2, 2], null],
        [[2, 3], null],
        [[2, 1], null],
        [[0, 0], null],
        [[0, 2], null],
      ]
    );
    const s = computePlayerStats([g], "A");
    expect(s.rounds).toBe(5);
    expect(s.made).toBe(2);
    expect(s.hitRate).toBeCloseTo(0.4);
    expect(s.misses).toEqual({ over: 2, under: 1 });
    expect(s.zeroBids).toEqual({ count: 2, made: 1 });
  });

  it("ignores rounds that are not completed (no score or no bid)", () => {
    const g = game(
      "g",
      day(1),
      ["A", "B"],
      [
        [
          [1, 1],
          [1, 1],
        ],
        [[2], [3]], // bids in, no scores
        [
          [1, 1],
          [1, 1],
        ],
      ]
    );
    g.rounds[3] = {
      roundNumber: 3,
      turns: [{ playerId: "A", player: { id: "A" }, bid: null, score: 4 }],
    };
    expect(computePlayerStats([g], "A").rounds).toBe(2);
    expect(computePlayerStats([g], "B").rounds).toBe(2);
  });

  it("counts bids and picks the most common (lowest wins a tie)", () => {
    const g = game(
      "g",
      day(1),
      ["A", "B"],
      [
        [[1, 1], null],
        [[2, 2], null],
        [[2, 0], null],
        [[1, 1], null],
        [[3, 3], null],
      ]
    );
    const s = computePlayerStats([g], "A");
    expect(s.bidCounts).toEqual({ 1: 2, 2: 2, 3: 1 });
    expect(s.mostCommonBid).toBe(1);
  });

  describe("aggression and style", () => {
    // Two players: round 0 has 7 cards (fair share 3.5), round 6 has 1 card
    // (fair share 0.5).
    const rounds = (bids: number[]) => bids.map((b): Cell[] => [[b, b], null]);

    it("is the mean of bid / fair share", () => {
      // 7 cards -> 7/3.5 = 2; 6 cards -> 3/3 = 1; mean 1.5
      const g = game("g", day(1), ["A", "B"], rounds([7, 3]));
      const s = computePlayerStats([g], "A");
      expect(s.aggression).toBeCloseTo(1.5);
      expect(s.style).toBe("bold");
    });

    it("uses the number of players at that table", () => {
      // 3 players, 7 cards: fair share 7/3. Bid 7/3 would be 1.0; bid 3 -> 9/7.
      const g = game("g", day(1), ["A", "B", "C"], [[[3, 3], null, null]]);
      expect(computePlayerStats([g], "A").aggression).toBeCloseTo(9 / 7);
    });

    it("is balanced between the thresholds, inclusive at 1.1 / 0.9", () => {
      // 4 players, 7 cards -> fair 1.75: bid 2 is 1.14 (bold), bid 0 is 0.
      const four = ["A", "B", "C", "D"];
      const g = (b: number) =>
        game("g", day(1), four, [[[b, b], null, null, null]]);
      expect(computePlayerStats([g(2)], "A").style).toBe("bold");
      expect(computePlayerStats([g(0)], "A").style).toBe("cautious");
      // Round 0 (fair 1.75): bid 1; round 1 (6 cards, fair 1.5): bid 2.
      const mixed = game("g", day(1), four, [
        [[1, 1], null, null, null],
        [[2, 2], null, null, null],
      ]);
      const s = computePlayerStats([mixed], "A");
      expect(s.aggression).toBeCloseTo((1 / 1.75 + 2 / 1.5) / 2);
      expect(s.style).toBe("balanced");
    });

    it("treats exactly 1.1 as bold and exactly 0.9 as cautious", () => {
      expect(styleFor(1.1)).toBe("bold");
      expect(styleFor(1.0999)).toBe("balanced");
      expect(styleFor(0.9)).toBe("cautious");
      expect(styleFor(0.9001)).toBe("balanced");
      expect(styleFor(null)).toBeNull();
    });

    it("rounds from unfinished games count", () => {
      const s = computePlayerStats(
        [game("g", day(1), ["A", "B"], [[[2, 2], null]])],
        "A"
      );
      expect(s.rounds).toBe(1);
    });
  });

  it("groups hit rate by hand size, trumps and dealer", () => {
    // 2 players A,B; A made every round except 0 (7 cards) and 4 (3 cards,
    // no-trump).
    const g = full("g", day(1), ["A", "B"], (r, p) =>
      p === 0 ? (r === 0 || r === 4 ? [1, 2] : [1, 1]) : [1, 1]
    );
    const s = computePlayerStats([g], "A");
    // cards: 7,6,5,4,3,2,1,2,3,4,5,6,7
    // small (1-3): rounds 4,5,6,7,8 -> 5 rounds, miss at 4 -> 4 made
    expect(s.bySize.small).toEqual({ rounds: 5, made: 4 });
    // medium (4-5): rounds 2,3,9,10 -> 4 rounds all made
    expect(s.bySize.medium).toEqual({ rounds: 4, made: 4 });
    // large (6-7): rounds 0,1,11,12 -> 4 rounds, miss at 0
    expect(s.bySize.large).toEqual({ rounds: 4, made: 3 });
    // no-trump rounds are 4 and 9
    expect(s.noTrump).toEqual({ rounds: 2, made: 1 });
    expect(s.trumps).toEqual({ rounds: 11, made: 10 });
    expect(s.rounds).toBe(13);
  });

  describe("dealer", () => {
    // 3 players, A only plays/records; A misses in rounds 0,3,6,9,12.
    const missRounds = new Set([0, 3, 6, 9, 12]);
    const cells = (r: number): Cell[] => [
      missRounds.has(r) ? [1, 0] : [1, 1],
      null,
      null,
    ];
    const rounds = Array.from({ length: 13 }, (_, r) => cells(r));

    it("defaults to the last seat dealing round 0, then rotating", () => {
      // (r + 2) % 3 === 0 for r = 1,4,7,10 -> A deals 4 rounds, all made
      const s = computePlayerStats(
        [game("g", day(1), ["A", "B", "C"], rounds)],
        "A"
      );
      expect(s.asDealer).toEqual({ rounds: 4, made: 4 });
      expect(s.notDealer).toEqual({ rounds: 9, made: 4 });
    });

    it("honours initialDealerId", () => {
      // A deals r % 3 === 0: 0,3,6,9,12 -> exactly the rounds A misses
      const s = computePlayerStats(
        [game("g", day(1), ["A", "B", "C"], rounds, { dealer: "A" })],
        "A"
      );
      expect(s.asDealer).toEqual({ rounds: 5, made: 0 });
      expect(s.notDealer).toEqual({ rounds: 8, made: 8 });
    });

    it("falls back to the default when initialDealerId isn't seated", () => {
      const s = computePlayerStats(
        [game("g", day(1), ["A", "B", "C"], rounds, { dealer: "Z" })],
        "A"
      );
      expect(s.asDealer).toEqual({ rounds: 4, made: 4 });
    });

    it("follows seat order, not orderNumber gaps", () => {
      const g = game("g", day(1), ["A", "B", "C"], rounds, { dealer: "C" });
      g.playersOrders[1].orderNumber = 5;
      g.playersOrders[2].orderNumber = 9;
      // C is seat index 2 -> dealer for r = 0 is index 2; A (index 0) deals
      // when (r + 2) % 3 === 0, same as the default.
      expect(computePlayerStats([g], "A").asDealer.rounds).toBe(4);
    });
  });

  describe("results", () => {
    // A beats B every game by making all bids; scores 143 vs 0.
    const aWins = (id: string, d: number) =>
      full(id, day(d), ["A", "B"], (_, p) => (p === 0 ? [1, 1] : [1, 0]));

    it("counts wins, expected wins, win ratio, average, personal best", () => {
      const games = [
        aWins("g1", 1),
        aWins("g2", 2),
        full("g3", day(3), ["A", "B", "C"], (_, p) =>
          p === 2 ? [1, 1] : [1, 0]
        ), // C wins; A and B score 0
      ];
      const s = computePlayerStats(games, "A");
      expect(s.games).toBe(3);
      expect(s.finished).toBe(3);
      expect(s.wins).toBe(2);
      expect(s.winRate).toBeCloseTo(2 / 3);
      expect(s.expectedWins).toBeCloseTo(0.5 + 0.5 + 1 / 3);
      expect(s.winRatio).toBeCloseTo(2 / (4 / 3));
      expect(s.averageScore).toBeCloseTo((143 + 143 + 0) / 3);
      expect(s.personalBest).toEqual({
        score: 143,
        gameId: "g1",
        date: day(1),
      });
    });

    it("unfinished games count for bidding but not results", () => {
      const unfinished = game(
        "u",
        day(5),
        ["A", "B"],
        [
          [
            [1, 1],
            [1, 1],
          ],
          [
            [2, 2],
            [2, 2],
          ],
        ]
      );
      const s = computePlayerStats([aWins("g1", 1), unfinished], "A");
      expect(s.games).toBe(2);
      expect(s.finished).toBe(1);
      expect(s.wins).toBe(1);
      expect(s.rounds).toBe(15);
      expect(s.expectedWins).toBeCloseTo(0.5);
      expect(s.form).toHaveLength(1);
      expect(s.averageScore).toBe(143);
    });

    it("a round with a missing score makes the game unfinished", () => {
      const g = aWins("g1", 1);
      g.rounds[12].turns[1].score = null;
      const s = computePlayerStats([g], "A");
      expect(s.finished).toBe(0);
      expect(s.wins).toBe(0);
      expect(s.rounds).toBe(13);
    });

    it("ignores deleted games entirely", () => {
      const del = full("d", day(2), ["A", "B"], allMade, {
        deletedAt: day(3),
      });
      const s = computePlayerStats([aWins("g1", 1), del], "A");
      expect(s.games).toBe(1);
      expect(s.rounds).toBe(13);
    });

    it("gives a tied top score to the first seat, like the board", () => {
      const tie = (id: string, names: string[]) =>
        full(id, day(1), names, allMade);
      const a = computePlayerStats([tie("g", ["A", "B"])], "A");
      const b = computePlayerStats([tie("g", ["A", "B"])], "B");
      expect(a.wins).toBe(1);
      expect(b.wins).toBe(0);
      // ...but both share first place in the form line
      expect(a.form[0].position).toBe(1);
      expect(b.form[0].position).toBe(1);
      expect(b.form[0].won).toBe(false);
    });

    it("records the earliest game for a tied personal best", () => {
      const s = computePlayerStats(
        [
          full("late", day(9), ["A", "B"], allMade),
          full("early", day(2), ["A", "B"], allMade),
        ],
        "A"
      );
      expect(s.personalBest?.gameId).toBe("early");
    });

    it("ignores players with no seat", () => {
      const s = computePlayerStats([aWins("g1", 1)], "Nobody");
      expect(s.games).toBe(0);
      expect(s.rounds).toBe(0);
    });
  });

  describe("form", () => {
    it("is the last five finished games, newest first, with positions", () => {
      // A's score steps up each game; with C seated, positions vary.
      const games = Array.from({ length: 7 }, (_, i) =>
        full(`g${i + 1}`, day(i + 1), ["A", "B", "C"], (r, p) => {
          if (p === 0) return r < i ? [1, 0] : [1, 1]; // misses first i rounds
          if (p === 1) return [1, 1];
          return [1, 0];
        })
      );
      const s = computePlayerStats(games, "A");
      expect(s.form.map((f) => f.gameId)).toEqual([
        "g7",
        "g6",
        "g5",
        "g4",
        "g3",
      ]);
      // g7: A misses the first 6 rounds (0 pts) and makes 7 (77); B has 143
      expect(s.form[0]).toMatchObject({
        gameId: "g7",
        numPlayers: 3,
        score: 77,
        position: 2,
        won: false,
      });
      // g1: A made all rounds (143) ties B (143) -> shares first, B isn't a
      // winner but A is the first seat. Not in the last five.
      expect(s.form).toHaveLength(5);
    });

    it("includes the game date and breaks nothing when there are no games", () => {
      const s = computePlayerStats(
        [full("g", day(4), ["A", "B"], allMade)],
        "A"
      );
      expect(s.form[0].date).toBe(day(4));
      expect(s.form[0].won).toBe(true);
    });

    it("orders by game date, not input order", () => {
      const s = computePlayerStats(
        [
          full("new", day(8), ["A", "B"], allMade),
          full("old", day(1), ["A", "B"], allMade),
        ],
        "A"
      );
      expect(s.form.map((f) => f.gameId)).toEqual(["new", "old"]);
    });
  });

  describe("streaks", () => {
    it("tracks the longest and current run of made bids", () => {
      // made, made, miss, made, made, made
      const pattern = [true, true, false, true, true, true];
      const g = game(
        "g",
        day(1),
        ["A", "B"],
        pattern.map((m): Cell[] => [m ? [1, 1] : [1, 0], null])
      );
      const s = computePlayerStats([g], "A");
      expect(s.longestMadeStreak).toBe(3);
      expect(s.currentMadeStreak).toBe(3);
    });

    it("current streak is 0 after a miss", () => {
      const g = game(
        "g",
        day(1),
        ["A", "B"],
        [
          [[1, 1], null],
          [[1, 1], null],
          [[1, 0], null],
        ]
      );
      const s = computePlayerStats([g], "A");
      expect(s.longestMadeStreak).toBe(2);
      expect(s.currentMadeStreak).toBe(0);
    });

    it("runs across games in date order, whatever the input order", () => {
      const first = game(
        "g1",
        day(1),
        ["A", "B"],
        [
          [[1, 0], null],
          [[1, 1], null],
          [[1, 1], null],
        ]
      );
      const second = game(
        "g2",
        day(2),
        ["A", "B"],
        [
          [[1, 1], null],
          [[1, 1], null],
          [[1, 0], null],
        ]
      );
      const s = computePlayerStats([second, first], "A");
      expect(s.longestMadeStreak).toBe(4); // 2 at the end of g1 + 2 at start of g2
      expect(s.currentMadeStreak).toBe(0);
    });

    it("skips unscored rounds instead of breaking the streak", () => {
      const g = game(
        "g",
        day(1),
        ["A", "B"],
        [
          [[1, 1], null],
          [[1], null],
          [[1, 1], null],
        ]
      );
      expect(computePlayerStats([g], "A").longestMadeStreak).toBe(2);
    });
  });

  describe("comebacks and collapses", () => {
    // After 7 rounds (0-6) A has 7 and B has 77 (A bid 1 and took 1 less).
    // Rounds 7-12: A makes 2s (12 each = 72) -> A 79; B scores 0 -> 77.
    const swing = full("swing", day(1), ["A", "B"], (r, p) => {
      if (r <= 6) return p === 0 ? [0, 1] : [1, 1];
      return p === 0 ? [2, 2] : [1, 0];
    });

    it("A came from behind to win; B collapsed", () => {
      const a = computePlayerStats([swing], "A");
      const b = computePlayerStats([swing], "B");
      expect(a.wins).toBe(1);
      expect(a.comebacks).toBe(1);
      expect(a.collapses).toBe(0);
      expect(b.wins).toBe(0);
      expect(b.comebacks).toBe(0);
      expect(b.collapses).toBe(1);
    });

    it("doesn't count a win from the front, or a loss from behind", () => {
      const wire = full("wire", day(1), ["A", "B"], (_, p) =>
        p === 0 ? [1, 1] : [1, 0]
      );
      const a = computePlayerStats([wire], "A");
      const b = computePlayerStats([wire], "B");
      expect(a.comebacks).toBe(0);
      expect(a.collapses).toBe(0);
      expect(b.comebacks).toBe(0);
      expect(b.collapses).toBe(0);
    });

    it("tied for the lead after seven rounds is neither", () => {
      // identical first seven rounds, then A pulls ahead
      const g = full("g", day(1), ["A", "B"], (r, p) =>
        r <= 6 || p === 0 ? [1, 1] : [1, 0]
      );
      expect(computePlayerStats([g], "A").comebacks).toBe(0);
      expect(computePlayerStats([g], "B").collapses).toBe(0);
    });

    it("ignores unfinished games", () => {
      const g = game(
        "g",
        day(1),
        ["A", "B"],
        Array.from({ length: 10 }, (_, r): Cell[] =>
          r <= 6
            ? [
                [0, 1],
                [1, 1],
              ]
            : [
                [2, 2],
                [1, 0],
              ]
        )
      );
      const a = computePlayerStats([g], "A");
      expect(a.comebacks).toBe(0);
      expect(computePlayerStats([g], "B").collapses).toBe(0);
    });
  });
});

// ── computeHeadToHead ───────────────────────────────────────────────────

describe("computeHeadToHead", () => {
  // A beats B by 143 in g1; B beats A by 143 in g2; g3 is a draw.
  const g1 = full("g1", day(1), ["A", "B"], (_, p) =>
    p === 0 ? [1, 1] : [1, 0]
  );
  const g2 = full("g2", day(2), ["A", "B"], (_, p) =>
    p === 0 ? [1, 0] : [1, 1]
  );
  const g3 = full("g3", day(3), ["A", "B"], allMade);

  it("tallies who finished higher, with draws", () => {
    const h = computeHeadToHead([g1, g2, g3], "A", "B");
    expect(h.games).toBe(3);
    expect(h.aAhead).toBe(1);
    expect(h.bAhead).toBe(1);
    expect(h.draws).toBe(1);
    expect(h.avgMargin).toBeCloseTo(0);
  });

  it("is symmetric under swapping the players", () => {
    // g1 (A by 143), g2 (B by 143), g3 (draw), asked from B's side
    const h = computeHeadToHead([g1, g2, g3], "B", "A");
    expect(h.aAhead).toBe(1);
    expect(h.bAhead).toBe(1);
    expect(h.draws).toBe(1);
    expect(h.biggestWinA?.gameId).toBe("g2");
    expect(h.biggestWinB?.gameId).toBe("g1");
    const lopsided = computeHeadToHead([g1, g1, g3], "B", "A");
    expect(lopsided.bAhead).toBe(2);
    expect(lopsided.avgMargin).toBeCloseTo(-286 / 3);
  });

  it("finds each side's biggest win", () => {
    const small = full("small", day(4), ["A", "B"], (r, p) =>
      p === 0 ? [1, 1] : r === 0 ? [1, 0] : [1, 1]
    ); // A ahead by 11
    const h = computeHeadToHead([small, g1, g2], "A", "B");
    expect(h.biggestWinA).toEqual({ margin: 143, gameId: "g1", date: day(1) });
    expect(h.biggestWinB).toEqual({ margin: 143, gameId: "g2", date: day(2) });
    const onlySmall = computeHeadToHead([small], "A", "B");
    expect(onlySmall.biggestWinA?.margin).toBe(11);
    expect(onlySmall.biggestWinB).toBeNull();
  });

  it("only compares finished games for results but all shared rounds for hit rates", () => {
    const unfinished = game(
      "u",
      day(5),
      ["A", "B"],
      [
        [
          [1, 1],
          [1, 0],
        ],
        [
          [1, 1],
          [1, 1],
        ],
      ]
    );
    const h = computeHeadToHead([g1, unfinished], "A", "B");
    expect(h.games).toBe(1);
    expect(h.sharedRounds).toBe(15);
    expect(h.aHitRate).toBeCloseTo(1);
    expect(h.bHitRate).toBeCloseTo(1 / 15);
  });

  it("uses only rounds both completed for the hit rate", () => {
    const g = game(
      "g",
      day(1),
      ["A", "B"],
      [
        [
          [1, 1],
          [1, 0],
        ],
        [[1, 1], [1]], // B has no score yet
        [
          [1, 0],
          [1, 1],
        ],
      ]
    );
    const h = computeHeadToHead([g], "A", "B");
    expect(h.sharedRounds).toBe(2);
    expect(h.aHitRate).toBeCloseTo(0.5);
    expect(h.bHitRate).toBeCloseTo(0.5);
  });

  it("ignores games where only one of them played", () => {
    const withC = full("c", day(6), ["A", "C"], allMade);
    const h = computeHeadToHead([withC], "A", "B");
    expect(h.games).toBe(0);
    expect(h.sharedRounds).toBe(0);
    expect(h.avgMargin).toBeNull();
    expect(h.aHitRate).toBeNull();
    expect(h.bHitRate).toBeNull();
    expect(h.biggestWinA).toBeNull();
    expect(h.recent).toEqual([]);
  });

  it("ignores deleted games", () => {
    const del = full("d", day(7), ["A", "B"], allMade, { deletedAt: day(8) });
    expect(computeHeadToHead([del], "A", "B").games).toBe(0);
  });

  it("lists the last five shared finished games, newest first", () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      full(`m${i + 1}`, day(i + 10), ["A", "B", "C"], (_, p) =>
        p === 0 ? [1, 1] : [1, 0]
      )
    );
    const h = computeHeadToHead(many, "B", "A");
    expect(h.recent.map((r) => r.gameId)).toEqual([
      "m7",
      "m6",
      "m5",
      "m4",
      "m3",
    ]);
    expect(h.recent[0]).toEqual({
      gameId: "m7",
      date: day(16),
      numPlayers: 3,
      aScore: 0,
      bScore: 143,
    });
  });

  it("works in games with more than two players", () => {
    const g = full("g", day(1), ["A", "B", "C"], (_, p) =>
      p === 2 ? [1, 1] : p === 0 ? [1, 1] : [1, 0]
    );
    const h = computeHeadToHead([g], "A", "B");
    expect(h.games).toBe(1);
    expect(h.aAhead).toBe(1);
  });
});

describe("computeOpponents", () => {
  it("lists people who shared finished games, most games first", () => {
    const games = [
      full("g1", day(1), ["A", "B", "C"], allMade),
      full("g2", day(2), ["A", "B"], allMade),
      full("g3", day(3), ["A", "D"], allMade, { deletedAt: day(4) }),
      game(
        "g4",
        day(5),
        ["A", "E"],
        [
          [
            [1, 1],
            [1, 1],
          ],
        ]
      ), // unfinished
      full("g5", day(6), ["B", "C"], allMade), // A not seated
    ];
    expect(computeOpponents(games, "A")).toEqual([
      { playerId: "B", name: "B", games: 2 },
      { playerId: "C", name: "C", games: 1 },
    ]);
  });

  it("leaves out merged-away players", () => {
    const g = full("g", day(1), ["A", "B"], allMade, { merged: ["B"] });
    expect(computeOpponents([g], "A")).toEqual([]);
  });

  it("is empty for a player with no games", () => {
    expect(computeOpponents([], "A")).toEqual([]);
  });
});

// ── computeAwards ───────────────────────────────────────────────────────

describe("computeAwards", () => {
  const find = (awards: ReturnType<typeof computeAwards>, key: string) =>
    awards.find((a) => a.key === key);

  it("returns nothing when nobody has enough rounds", () => {
    const g = game(
      "g",
      day(1),
      ["A", "B"],
      [
        [
          [1, 1],
          [1, 1],
        ],
      ]
    );
    expect(computeAwards([g])).toEqual([]);
    expect(computeAwards([])).toEqual([]);
  });

  it("requires 30 completed rounds (2 full games, not 29)", () => {
    const one = full("g1", day(1), ["A", "B"], allMade); // 13 rounds each
    const two = full("g2", day(2), ["A", "B"], allMade); // 26
    expect(computeAwards([one, two])).toEqual([]);
    const three = full("g3", day(3), ["A", "B"], allMade); // 39
    expect(computeAwards([one, two, three]).length).toBeGreaterThan(0);
  });

  // A: bids high (4) and always takes 1 -> all misses are "under";
  // B: always bids 0 and takes 0 -> made every zero;
  // C: bids 1 and takes 1, made everything but with bids near fair share.
  const games = [1, 2, 3].map((i) =>
    full(`g${i}`, day(i), ["A", "B", "C"], (r, p) => {
      const cards = [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7][r];
      if (p === 0) return [Math.min(cards, 4), 0]; // too greedy (misses)
      if (p === 1) return [0, 0];
      return [1, 1];
    })
  );

  it("hands out the awards with names and details", () => {
    const awards = computeAwards(games);
    const greedy = find(awards, "greediest");
    expect(greedy).toMatchObject({
      title: "Greediest",
      playerId: "A",
      name: "A",
      detail: "100% of misses too greedy",
    });
    expect(find(awards, "mr-zero")).toMatchObject({
      playerId: "B",
      detail: "100% of rounds",
    });
    // B and C both hit 100%; tie goes to the name that sorts first
    expect(find(awards, "sharpshooter")).toMatchObject({
      playerId: "B",
      detail: "100% of bids made",
    });
    expect(find(awards, "boldest")?.playerId).toBe("A");
    expect(find(awards, "careful")?.playerId).toBe("B");
    expect(find(awards, "comeback-king")).toBeUndefined();
  });

  it("is independent of input order", () => {
    expect(computeAwards([...games].reverse())).toEqual(computeAwards(games));
  });

  it("needs 10 misses for Greediest", () => {
    // A misses only 3 times
    const few = [1, 2, 3].map((i) =>
      full(`f${i}`, day(i), ["A", "B"], (r, p) =>
        p === 0 && i === 1 && r < 3 ? [4, 0] : [1, 1]
      )
    );
    expect(find(computeAwards(few), "greediest")).toBeUndefined();
  });

  it("skips Mr Zero when nobody bids zero", () => {
    const g = [1, 2, 3].map((i) => full(`g${i}`, day(i), ["A", "B"], allMade));
    expect(find(computeAwards(g), "mr-zero")).toBeUndefined();
  });

  it("doesn't give one lone player both Boldest and Most careful", () => {
    const solo = [1, 2, 3].map((i) =>
      game(
        `s${i}`,
        day(i),
        ["A", "B"],
        Array.from({ length: 13 }, (): Cell[] => [[1, 1], null])
      )
    );
    const awards = computeAwards(solo);
    expect(find(awards, "boldest")?.playerId).toBe("A");
    expect(find(awards, "careful")).toBeUndefined();
  });

  it("gives Comeback king to the most comebacks (needs 3 finished games)", () => {
    const swing = (id: string, d: number) =>
      full(id, day(d), ["A", "B"], (r, p) => {
        if (r <= 6) return p === 0 ? [0, 1] : [1, 1];
        return p === 0 ? [2, 2] : [1, 0];
      });
    const awards = computeAwards([
      swing("s1", 1),
      swing("s2", 2),
      swing("s3", 3),
    ]);
    expect(find(awards, "comeback-king")).toMatchObject({
      playerId: "A",
      detail: "3 comebacks",
    });
    expect(computeAwards([swing("s1", 1), swing("s2", 2)])).not.toContainEqual(
      expect.objectContaining({ key: "comeback-king" })
    );
  });

  it("leaves out merged-away players", () => {
    const withMerged = [1, 2, 3].map((i) =>
      full(
        `g${i}`,
        day(i),
        ["A", "B", "C"],
        (_, p) => (p === 0 ? [1, 1] : [1, 0]),
        {
          merged: ["A"],
        }
      )
    );
    const awards = computeAwards(withMerged);
    expect(awards.some((a) => a.playerId === "A")).toBe(false);
  });
});

// ── Boundaries and robustness ───────────────────────────────────────────

// Two players. Through round 5 B leads 6-0. In round `change` A moves ahead
// (A needs 7+ more than B in that round, so the lead flips exactly there).
// From round 7 on A scores 11 a round to B's 0, so A always wins.
const leadChange = (change: 6 | 7) =>
  full("lc" + change, day(1), ["A", "B"], (r, p): Cell => {
    if (r <= 5) return p === 0 ? [1, 0] : [0, 1]; // A 0, B 1
    if (r === 6) {
      if (change === 6) return p === 0 ? [1, 1] : [1, 0]; // A 11, B 0
      return [1, 0]; // both 0
    }
    if (r === 7 && change === 7) return p === 0 ? [2, 2] : [1, 0]; // A 12
    return p === 0 ? [1, 1] : [1, 0];
  });

describe("comeback / collapse mid-game boundary", () => {
  it("a lead taken in round index 6 counts as leading after 7 rounds", () => {
    const g = leadChange(6);
    expect(computePlayerStats([g], "A").wins).toBe(1);
    expect(computePlayerStats([g], "A").comebacks).toBe(0);
    expect(computePlayerStats([g], "B").collapses).toBe(0);
  });

  it("a lead taken in round index 7 is a comeback (and a collapse)", () => {
    const g = leadChange(7);
    expect(computePlayerStats([g], "A").comebacks).toBe(1);
    expect(computePlayerStats([g], "B").collapses).toBe(1);
  });

  it("is not a collapse when the leader was tied for first at the end", () => {
    // B leads 77-7 after seven rounds, then A claws back to an exact tie.
    // A is first seat, so A "wins" the tie-break; B didn't collapse.
    const g = full("tie", day(1), ["A", "B"], (r, p): Cell => {
      if (r <= 6) return p === 0 ? [0, 1] : [1, 1]; // A 7, B 77
      // A needs 70 over the last six rounds while B scores 0: 10 + 5 x 12
      if (r === 7) return p === 0 ? [0, 0] : [1, 0];
      return p === 0 ? [2, 2] : [1, 0];
    });
    expect(computePlayerStats([g], "A").wins).toBe(1);
    expect(computePlayerStats([g], "B").wins).toBe(0);
    expect(computePlayerStats([g], "B").form[0].position).toBe(1);
    expect(computePlayerStats([g], "B").collapses).toBe(0);
  });
});

describe("award thresholds", () => {
  const awardKeys = (gs: StatsGame[]) => computeAwards(gs).map((a) => a.key);
  const base = [1, 2].map((i) => full(`b${i}`, day(i), ["A", "B"], allMade)); // 26 rounds
  const partial = (n: number) =>
    game(
      "partial",
      day(5),
      ["A", "B"],
      Array.from({ length: n }, (): Cell[] => [
        [1, 1],
        [1, 1],
      ])
    );

  it("needs exactly 30 completed rounds: 29 is not enough", () => {
    expect(awardKeys([...base, partial(3)])).toEqual([]);
    expect(awardKeys([...base, partial(4)])).toContain("sharpshooter");
  });

  it("counts rounds from unfinished games but needs 3 finished games for Comeback king", () => {
    const swing = (id: string, d: number, rounds: number) =>
      game(
        id,
        day(d),
        ["A", "B"],
        Array.from({ length: rounds }, (_, r): Cell[] => {
          if (r <= 6)
            return [
              [0, 1],
              [1, 1],
            ];
          return [
            [2, 2],
            [1, 0],
          ];
        })
      );
    const two = [swing("s1", 1, 13), swing("s2", 2, 13)];
    const unfinished = swing("u", 3, 10); // 36 rounds in total
    const awards = computeAwards([...two, unfinished]);
    expect(awards.map((a) => a.key)).toContain("sharpshooter");
    expect(awards.map((a) => a.key)).not.toContain("comeback-king");
    // a third *finished* game unlocks it
    const three = computeAwards([...two, swing("s3", 3, 13)]);
    expect(three.find((a) => a.key === "comeback-king")?.detail).toBe(
      "3 comebacks"
    );
  });

  describe("Greediest", () => {
    // A bids 2 and takes 0 (a greedy miss) `under` times, takes 3 (a
    // cautious miss) `over` times, otherwise makes it. 39 rounds.
    const greedy = (under: number, over: number) =>
      [0, 1, 2].map((i) =>
        full(`gr${i}`, day(i + 1), ["A", "B"], (r, p): Cell => {
          if (p === 1) return [1, 1];
          const n = i * 13 + r;
          if (n < under) return [2, 0];
          if (n < under + over) return [2, 3];
          return [2, 2];
        })
      );

    it("needs 10 misses: 9 is not enough, 10 is", () => {
      expect(awardKeys(greedy(9, 0))).not.toContain("greediest");
      expect(awardKeys(greedy(10, 0))).toContain("greediest");
      expect(awardKeys(greedy(5, 4))).not.toContain("greediest");
      expect(awardKeys(greedy(5, 5))).toContain("greediest");
    });

    it("is not given at 0% (all misses too cautious)", () => {
      expect(awardKeys(greedy(0, 12))).not.toContain("greediest");
    });
  });

  it("Sharpshooter isn't given for a 0% hit rate", () => {
    const never = [1, 2, 3].map((i) =>
      full(`n${i}`, day(i), ["A", "B"], (): Cell => [1, 0])
    );
    expect(awardKeys(never)).not.toContain("sharpshooter");
  });
});

describe("seats and table size", () => {
  it("skips an unloaded seat before the player when sizing the table and dealing", () => {
    const g = full("g", day(1), ["A", "B"], allMade);
    g.playersOrders.unshift({ orderNumber: -1, player: undefined });
    const s = computePlayerStats([g], "A");
    // Two real players: B deals round 0, A deals the odd rounds (6 of 13).
    expect(s.asDealer.rounds).toBe(6);
    expect(s.notDealer.rounds).toBe(7);
    expect(s.finished).toBe(1);
    expect(s.expectedWins).toBeCloseTo(0.5);
    // fair share uses 2 players: round 0 is 7 cards -> bid 1 / 3.5
    const once = full("g2", day(1), ["A", "B"], allMade);
    expect(computePlayerStats([once], "A").aggression).toBeCloseTo(
      s.aggression!
    );
    expect(computePlayerStats([g], "B").asDealer.rounds).toBe(7);
  });

  it("initialDealerId indexes among the loaded seats only", () => {
    const g = full("g", day(1), ["A", "B"], allMade, { dealer: "A" });
    g.playersOrders.unshift({ orderNumber: -1, player: undefined });
    // A is loaded seat 0 -> deals even rounds: 0,2,...,12 = 7
    expect(computePlayerStats([g], "A").asDealer.rounds).toBe(7);
  });

  it("counts a player seated twice once", () => {
    const g = full("g", day(1), ["A", "B"], allMade);
    g.playersOrders.push({
      orderNumber: 5,
      player: { id: "B", name: "B" },
    });
    const a = computePlayerStats([g], "A");
    expect(a.expectedWins).toBeCloseTo(0.5);
    expect(a.finished).toBe(1);
    expect(computeOpponents([g], "A")).toEqual([
      { playerId: "B", name: "B", games: 1 },
    ]);
    expect(computePlayerStats([g], "B").games).toBe(1);
  });

  it("two players tied for second share the position", () => {
    const g = full("g", day(1), ["A", "B", "C", "D"], (_, p): Cell => {
      if (p === 0) return [1, 1]; // 143
      if (p === 3) return [1, 0]; // 0
      return [0, 1]; // 13
    });
    const pos = (id: string) => computePlayerStats([g], id).form[0].position;
    expect([pos("A"), pos("B"), pos("C"), pos("D")]).toEqual([1, 2, 2, 4]);
  });
});

describe("caching", () => {
  it("gives the same answers for a new array of the same game objects", () => {
    const a = full("a", day(1), ["A", "B"], allMade);
    const b = full("b", day(2), ["A", "B"], allMade);
    const first = computePlayerStats([a, b], "A");
    expect(computePlayerStats([b, a], "A")).toEqual(first);
    // a replaced game object is digested afresh
    const b2 = full(
      "b",
      day(2),
      ["A", "B"],
      (_, p): Cell => (p === 0 ? [1, 0] : [1, 1])
    );
    expect(computePlayerStats([a, b2], "A").made).toBe(13);
  });
});

describe("computeHeadToHead sharedGames", () => {
  it("counts unfinished shared games separately from finished ones", () => {
    const unfinished = game("u", day(1), ["A", "B"], []);
    const h = computeHeadToHead([unfinished], "A", "B");
    expect(h.sharedGames).toBe(1);
    expect(h.games).toBe(0);
    expect(h.sharedRounds).toBe(0);
    const done = full("d", day(2), ["A", "B"], allMade);
    expect(computeHeadToHead([unfinished, done], "A", "B").sharedGames).toBe(2);
    expect(computeHeadToHead([], "A", "B").sharedGames).toBe(0);
  });
});
