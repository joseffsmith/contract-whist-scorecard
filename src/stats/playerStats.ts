// Per-player and head-to-head statistics, computed from the games the sync
// engine hands the UI (selectHomeGames(view).games). Pure functions: no React,
// no clock, no randomness.
//
// Conventions
// - Deleted games are ignored.
// - A "completed round" for a player is a turn with a bid and a score. Bidding
//   stats use every completed round, including ones from unfinished games.
//   Game-result stats (wins, personal best, form, comebacks...) only use
//   finished games, as decided by summarizeGame so they agree with the board.
// - turn.score is points: tricks + 10 when the bid was hit exactly, otherwise
//   tricks. With at most 7 tricks, `made` is `score === bid + 10`.
// - Ratios with a zero denominator are null (the UI shows "—").
import { DEALS } from "../constants";
import { summarizeGame } from "../utils/gameStatus";
import { getDealerIdx } from "../utils/getDealerIdx";

// ── Input shape ─────────────────────────────────────────────────────────
// The part of a HomeGame this module reads, so tests can build tiny games.

type StatsPlayer = { id: string; name: string; mergedInto?: string | null };
export type StatsGame = {
  id: string;
  createdAt: string;
  deletedAt?: string | null;
  initialDealerId?: string | null;
  playersOrders: {
    orderNumber: number;
    player?: StatsPlayer | null;
  }[];
  rounds: {
    roundNumber: number;
    turns: {
      playerId: string;
      bid?: number | null;
      score?: number | null;
      player?: { id: string } | null;
    }[];
  }[];
};

// ── Tunables ────────────────────────────────────────────────────────────

export const BOLD_AT = 1.1;
export const CAUTIOUS_AT = 0.9;
// Round index (0-based) after which "who is leading" is judged: after 7 rounds.
const MID_GAME_ROUND = 6;
export const FORM_LENGTH = 5;
export const RECENT_SHARED_LENGTH = 5;
export const AWARD_MIN_ROUNDS = 30;
export const AWARD_MIN_FINISHED = 3;
export const AWARD_MIN_MISSES = 10;

// ── Result types ────────────────────────────────────────────────────────

export type Tally = { rounds: number; made: number };
export type BidStyle = "bold" | "balanced" | "cautious";

export type FormEntry = {
  gameId: string;
  date: string;
  // 1-based; ties share the better position.
  position: number;
  numPlayers: number;
  score: number;
  won: boolean;
};

export type PlayerStats = {
  rounds: number;
  made: number;
  hitRate: number | null;
  // Mean of bid / fair share, where fair share = cards / players at the table.
  aggression: number | null;
  style: BidStyle | null;
  bidCounts: Record<number, number>;
  mostCommonBid: number | null;
  zeroBids: { count: number; made: number };
  misses: {
    // More tricks than bid (too cautious).
    over: number;
    // Fewer tricks than bid (too greedy).
    under: number;
  };
  bySize: { small: Tally; medium: Tally; large: Tally };
  asDealer: Tally;
  notDealer: Tally;
  noTrump: Tally;
  trumps: Tally;
  games: number;
  finished: number;
  wins: number;
  winRate: number | null;
  expectedWins: number;
  winRatio: number | null;
  personalBest: { score: number; gameId: string; date: string } | null;
  averageScore: number | null;
  form: FormEntry[];
  longestMadeStreak: number;
  currentMadeStreak: number;
  comebacks: number;
  collapses: number;
};

export type HeadToHead = {
  // Finished games both played.
  games: number;
  aAhead: number;
  bAhead: number;
  draws: number;
  // Mean of (a's total - b's total); null with no shared finished games.
  avgMargin: number | null;
  biggestWinA: { margin: number; gameId: string; date: string } | null;
  biggestWinB: { margin: number; gameId: string; date: string } | null;
  // Over rounds where both completed their turn (any game they shared).
  sharedRounds: number;
  aHitRate: number | null;
  bHitRate: number | null;
  recent: {
    gameId: string;
    date: string;
    numPlayers: number;
    aScore: number;
    bScore: number;
  }[];
};

export type Award = {
  key: string;
  title: string;
  playerId: string;
  name: string;
  detail: string;
};

export type Opponent = { playerId: string; name: string; games: number };

// ── Preparation ─────────────────────────────────────────────────────────
// Each game is digested once (and cached per games array).

type PTurn = { bid: number; score: number; made: boolean; tricks: number };
type PRound = {
  roundNumber: number;
  cards: number;
  noTrump: boolean;
  dealerId: string;
  // Completed turns only.
  turns: Map<string, PTurn>;
};
type PGame = {
  id: string;
  createdAt: string;
  seatIds: string[];
  names: Map<string, string>;
  merged: Set<string>;
  numPlayers: number;
  finished: boolean;
  totals: Map<string, number>;
  winnerId: string | null;
  // Running totals after MID_GAME_ROUND + 1 rounds (null if not that far).
  midTotals: Map<string, number> | null;
  rounds: PRound[];
};

const preparedCache = new WeakMap<readonly StatsGame[], PGame[]>();

function prepareGame(g: StatsGame): PGame {
  const seats = [...g.playersOrders]
    .sort((a, b) => a.orderNumber - b.orderNumber)
    .filter((po) => po.player);
  const seatIds = seats.map((po) => po.player!.id);
  const numPlayers = seatIds.length;
  const summary = summarizeGame(g.playersOrders, g.rounds);
  const totals = new Map(summary.totals.map((x) => [x.id, x.score]));
  const winnerId =
    summary.isFinished && summary.winnerIdx >= 0
      ? summary.totals[summary.winnerIdx].id
      : null;

  const dealerSeat = g.initialDealerId
    ? seatIds.indexOf(g.initialDealerId)
    : -1;
  const initialDealerIdx = dealerSeat === -1 ? null : dealerSeat;

  const sorted = [...g.rounds].sort((a, b) => a.roundNumber - b.roundNumber);
  const seated = new Set(seatIds);
  const rounds: PRound[] = [];
  const mid = new Map(seatIds.map((id) => [id, 0]));
  let reachedMid = false;
  for (const r of sorted) {
    const deal = DEALS[r.roundNumber] as (typeof DEALS)[number] | undefined;
    if (!deal || numPlayers === 0) continue;
    const turns = new Map<string, PTurn>();
    for (const turn of r.turns) {
      const pid = turn.playerId;
      if (r.roundNumber <= MID_GAME_ROUND && seated.has(pid)) {
        mid.set(pid, (mid.get(pid) ?? 0) + (turn.score ?? 0));
      }
      if (turn.bid == null || turn.score == null) continue;
      const made = turn.score === turn.bid + 10;
      turns.set(pid, {
        bid: turn.bid,
        score: turn.score,
        made,
        tricks: made ? turn.bid : turn.score,
      });
    }
    if (r.roundNumber === MID_GAME_ROUND) reachedMid = true;
    rounds.push({
      roundNumber: r.roundNumber,
      cards: deal.num_cards,
      noTrump: deal.suit === "🚫",
      dealerId:
        seatIds[getDealerIdx(r.roundNumber, numPlayers, initialDealerIdx)],
      turns,
    });
  }

  return {
    id: g.id,
    createdAt: g.createdAt,
    seatIds,
    names: new Map(seats.map((po) => [po.player!.id, po.player!.name])),
    merged: new Set(
      seats.filter((po) => po.player!.mergedInto).map((po) => po.player!.id)
    ),
    numPlayers,
    finished: summary.isFinished,
    totals,
    winnerId,
    midTotals: reachedMid ? mid : null,
    rounds,
  };
}

// Live games, oldest first (ties broken by id so the order is stable).
function prepare(games: readonly StatsGame[]): PGame[] {
  let out = preparedCache.get(games);
  if (!out) {
    out = games
      .filter((g) => !g.deletedAt)
      .map(prepareGame)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
      );
    preparedCache.set(games, out);
  }
  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const ratio = (num: number, den: number): number | null =>
  den > 0 ? num / den : null;

export const tallyRate = (t: Tally): number | null => ratio(t.made, t.rounds);

const emptyTally = (): Tally => ({ rounds: 0, made: 0 });
const addTo = (t: Tally, made: boolean) => {
  t.rounds += 1;
  if (made) t.made += 1;
};

export const styleFor = (aggression: number | null): BidStyle | null =>
  aggression === null
    ? null
    : aggression >= BOLD_AT
    ? "bold"
    : aggression <= CAUTIOUS_AT
    ? "cautious"
    : "balanced";

const sizeOf = (cards: number): "small" | "medium" | "large" =>
  cards <= 3 ? "small" : cards <= 5 ? "medium" : "large";

// 1-based position; ties share the better one.
const positionOf = (g: PGame, playerId: string): number => {
  const mine = g.totals.get(playerId) ?? 0;
  let ahead = 0;
  for (const s of g.totals.values()) if (s > mine) ahead += 1;
  return ahead + 1;
};

// ── Player stats ────────────────────────────────────────────────────────

function statsFor(all: PGame[], playerId: string): PlayerStats {
  const bySize = {
    small: emptyTally(),
    medium: emptyTally(),
    large: emptyTally(),
  };
  const asDealer = emptyTally();
  const notDealer = emptyTally();
  const noTrump = emptyTally();
  const trumps = emptyTally();
  const bidCounts: Record<number, number> = {};
  const zeroBids = { count: 0, made: 0 };
  const misses = { over: 0, under: 0 };
  let rounds = 0;
  let made = 0;
  let aggressionSum = 0;

  let games = 0;
  let finished = 0;
  let wins = 0;
  let expectedWins = 0;
  let scoreSum = 0;
  let personalBest: PlayerStats["personalBest"] = null;
  const finishedGames: { g: PGame; score: number }[] = [];
  let comebacks = 0;
  let collapses = 0;
  let longest = 0;
  let current = 0;

  for (const g of all) {
    if (!g.seatIds.includes(playerId)) continue;
    games += 1;

    for (const r of g.rounds) {
      const turn = r.turns.get(playerId);
      if (!turn) continue;
      rounds += 1;
      if (turn.made) made += 1;
      aggressionSum += turn.bid / (r.cards / g.numPlayers);
      bidCounts[turn.bid] = (bidCounts[turn.bid] ?? 0) + 1;
      if (turn.bid === 0) {
        zeroBids.count += 1;
        if (turn.made) zeroBids.made += 1;
      }
      if (!turn.made) {
        if (turn.tricks > turn.bid) misses.over += 1;
        else misses.under += 1;
      }
      addTo(bySize[sizeOf(r.cards)], turn.made);
      addTo(r.dealerId === playerId ? asDealer : notDealer, turn.made);
      addTo(r.noTrump ? noTrump : trumps, turn.made);
      if (turn.made) {
        current += 1;
        if (current > longest) longest = current;
      } else {
        current = 0;
      }
    }

    if (!g.finished) continue;
    const score = g.totals.get(playerId) ?? 0;
    finished += 1;
    scoreSum += score;
    expectedWins += 1 / g.numPlayers;
    finishedGames.push({ g, score });
    const won = g.winnerId === playerId;
    if (won) wins += 1;
    if (!personalBest || score > personalBest.score) {
      personalBest = { score, gameId: g.id, date: g.createdAt };
    }
    if (g.midTotals) {
      const mine = g.midTotals.get(playerId) ?? 0;
      const others = [...g.midTotals.entries()]
        .filter(([id]) => id !== playerId)
        .map(([, s]) => s);
      if (won && others.some((s) => s > mine)) comebacks += 1;
      if (!won && others.every((s) => s < mine)) collapses += 1;
    }
  }

  let mostCommonBid: number | null = null;
  for (const [bid, count] of Object.entries(bidCounts)) {
    if (mostCommonBid === null || count > bidCounts[mostCommonBid]) {
      mostCommonBid = Number(bid);
    }
  }

  const aggression = rounds > 0 ? aggressionSum / rounds : null;
  const style = styleFor(aggression);

  const form: FormEntry[] = finishedGames
    .slice(-FORM_LENGTH)
    .reverse()
    .map(({ g, score }) => ({
      gameId: g.id,
      date: g.createdAt,
      position: positionOf(g, playerId),
      numPlayers: g.numPlayers,
      score,
      won: g.winnerId === playerId,
    }));

  return {
    rounds,
    made,
    hitRate: ratio(made, rounds),
    aggression,
    style,
    bidCounts,
    mostCommonBid,
    zeroBids,
    misses,
    bySize,
    asDealer,
    notDealer,
    noTrump,
    trumps,
    games,
    finished,
    wins,
    winRate: ratio(wins, finished),
    expectedWins,
    winRatio: ratio(wins, expectedWins),
    personalBest,
    averageScore: ratio(scoreSum, finished),
    form,
    longestMadeStreak: longest,
    currentMadeStreak: current,
    comebacks,
    collapses,
  };
}

export function computePlayerStats(
  games: readonly StatsGame[],
  playerId: string
): PlayerStats {
  return statsFor(prepare(games), playerId);
}

// ── Head to head ────────────────────────────────────────────────────────

export function computeHeadToHead(
  games: readonly StatsGame[],
  aId: string,
  bId: string
): HeadToHead {
  const shared = prepare(games).filter(
    (g) => g.seatIds.includes(aId) && g.seatIds.includes(bId)
  );
  let aAhead = 0;
  let bAhead = 0;
  let draws = 0;
  let marginSum = 0;
  let biggestWinA: HeadToHead["biggestWinA"] = null;
  let biggestWinB: HeadToHead["biggestWinB"] = null;
  const finished: { g: PGame; a: number; b: number }[] = [];
  let sharedRounds = 0;
  let aMade = 0;
  let bMade = 0;

  for (const g of shared) {
    for (const r of g.rounds) {
      const a = r.turns.get(aId);
      const b = r.turns.get(bId);
      if (!a || !b) continue;
      sharedRounds += 1;
      if (a.made) aMade += 1;
      if (b.made) bMade += 1;
    }
    if (!g.finished) continue;
    const a = g.totals.get(aId) ?? 0;
    const b = g.totals.get(bId) ?? 0;
    finished.push({ g, a, b });
    marginSum += a - b;
    if (a > b) {
      aAhead += 1;
      if (!biggestWinA || a - b > biggestWinA.margin) {
        biggestWinA = { margin: a - b, gameId: g.id, date: g.createdAt };
      }
    } else if (b > a) {
      bAhead += 1;
      if (!biggestWinB || b - a > biggestWinB.margin) {
        biggestWinB = { margin: b - a, gameId: g.id, date: g.createdAt };
      }
    } else {
      draws += 1;
    }
  }

  return {
    games: finished.length,
    aAhead,
    bAhead,
    draws,
    avgMargin: ratio(marginSum, finished.length),
    biggestWinA,
    biggestWinB,
    sharedRounds,
    aHitRate: ratio(aMade, sharedRounds),
    bHitRate: ratio(bMade, sharedRounds),
    recent: finished
      .slice(-RECENT_SHARED_LENGTH)
      .reverse()
      .map(({ g, a, b }) => ({
        gameId: g.id,
        date: g.createdAt,
        numPlayers: g.numPlayers,
        aScore: a,
        bScore: b,
      })),
  };
}

// Players who have shared a finished game with `playerId`, most games first.
export function computeOpponents(
  games: readonly StatsGame[],
  playerId: string
): Opponent[] {
  const counts = new Map<string, Opponent>();
  for (const g of prepare(games)) {
    if (!g.finished || !g.seatIds.includes(playerId)) continue;
    for (const id of g.seatIds) {
      if (id === playerId || g.merged.has(id)) continue;
      const o = counts.get(id) ?? {
        playerId: id,
        name: g.names.get(id) ?? "?",
        games: 0,
      };
      o.games += 1;
      counts.set(id, o);
    }
  }
  return [...counts.values()].sort(
    (a, b) =>
      b.games - a.games ||
      a.name.localeCompare(b.name) ||
      a.playerId.localeCompare(b.playerId)
  );
}

// ── Awards ──────────────────────────────────────────────────────────────

type Candidate = {
  playerId: string;
  name: string;
  rounds: number;
  s: PlayerStats;
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function computeAwards(games: readonly StatsGame[]): Award[] {
  const all = prepare(games);
  const names = new Map<string, string>();
  const merged = new Set<string>();
  for (const g of all) {
    for (const [id, name] of g.names) names.set(id, name);
    for (const id of g.merged) merged.add(id);
  }

  const pool: Candidate[] = [];
  for (const [playerId, name] of names) {
    if (merged.has(playerId)) continue;
    const s = statsFor(all, playerId);
    if (s.rounds >= AWARD_MIN_ROUNDS) {
      pool.push({ playerId, name, rounds: s.rounds, s });
    }
  }

  // Highest `value` wins (negate it to look for the lowest). Ties go to the
  // bigger sample, then name, so the result never depends on input order.
  const best = (
    pick: (c: Candidate) => number | null,
    sign: 1 | -1 = 1
  ): { c: Candidate; value: number } | null => {
    let top: { c: Candidate; value: number } | null = null;
    for (const c of pool) {
      const value = pick(c);
      if (value === null) continue;
      const better =
        !top ||
        (value - top.value) * sign > 0 ||
        (value === top.value &&
          (c.rounds - top.c.rounds ||
            top.c.name.localeCompare(c.name) ||
            top.c.playerId.localeCompare(c.playerId)) > 0);
      if (better) top = { c, value };
    }
    return top;
  };

  const awards: Award[] = [];
  const give = (
    key: string,
    title: string,
    found: { c: Candidate; value: number } | null,
    detail: (value: number) => string
  ) => {
    if (found) {
      awards.push({
        key,
        title,
        playerId: found.c.playerId,
        name: found.c.name,
        detail: detail(found.value),
      });
    }
  };

  give(
    "greediest",
    "Greediest",
    best((c) => {
      const n = c.s.misses.over + c.s.misses.under;
      return n >= AWARD_MIN_MISSES ? c.s.misses.under / n : null;
    }),
    (v) => `${pct(v)} of misses too greedy`
  );
  give(
    "mr-zero",
    "Mr Zero",
    best((c) => {
      const v = c.s.zeroBids.count / c.s.rounds;
      return v > 0 ? v : null;
    }),
    (v) => `${pct(v)} of rounds`
  );
  give(
    "sharpshooter",
    "Sharpshooter",
    best((c) => c.s.hitRate),
    (v) => `${pct(v)} of rounds`
  );
  give(
    "comeback-king",
    "Comeback king",
    best((c) =>
      c.s.finished >= AWARD_MIN_FINISHED && c.s.comebacks >= 1
        ? c.s.comebacks
        : null
    ),
    (v) => `${v} comeback${v === 1 ? "" : "s"}`
  );
  const bold = best((c) => c.s.aggression);
  give("boldest", "Boldest bidder", bold, (v) => `${v.toFixed(2)}× fair share`);
  const careful = best((c) => c.s.aggression, -1);
  // With one qualifier the same person would be both boldest and most careful.
  if (careful && careful.c.playerId !== bold?.c.playerId) {
    give(
      "careful",
      "Most careful",
      careful,
      (v) => `${v.toFixed(2)}× fair share`
    );
  }
  return awards;
}
