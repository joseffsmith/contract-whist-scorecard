// Every write in the app, as a pure function of (state, action, context).
// Runs optimistically in the browser and authoritatively on the server.
// See docs/backend/SPEC.md ("Actions").

import { ActionError } from "./types";
import type {
  Action,
  ActionArgs,
  ActionContext,
  DataState,
  GameRow,
  PlayerRow,
  ReadState,
  RoundRow,
  RowOp,
  SeatRow,
  TableName,
  Tables,
  TurnRow,
} from "./types";

export const DEALS_NUM_CARDS = [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7];

const MAX_NAME_LENGTH = 40;
const MAX_SCORE = 30;
const MAX_ID_LENGTH = 100;
const MAX_IMPORT_SEATS = 20;
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$/;

// ── In-memory state (tests and the browser engine) ──────────────────────

export function createMemoryState(): DataState {
  return {
    players: new Map(),
    games: new Map(),
    seats: new Map(),
    rounds: new Map(),
    turns: new Map(),
  };
}

export function memoryReadState(data: DataState): ReadState {
  return {
    get: (table, id) => data[table].get(id) as Tables[typeof table] | undefined,
    where: (table, field, value) => {
      const found: Tables[typeof table][] = [];
      for (const row of data[table].values()) {
        if (row[field as keyof typeof row] === value)
          found.push(row as Tables[typeof table]);
      }
      return found;
    },
  };
}

// Mutates `data`. Rows are stored as given, so callers must not mutate them.
export function applyOps(data: DataState, ops: RowOp[]): void {
  for (const op of ops) {
    const rows = data[op.table] as Map<string, Tables[TableName]>;
    if (op.op === "put") rows.set(op.row.id, op.row);
    else rows.delete(op.id);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

const put = <T extends TableName>(table: T, row: Tables[T]): RowOp => ({
  op: "put",
  table,
  row,
});
const del = (table: TableName, id: string): RowOp => ({
  op: "delete",
  table,
  id,
});

function requireUser(ctx: ActionContext): string {
  if (!ctx.userId)
    throw new ActionError("Sign in to do that.", "not_signed_in");
  return ctx.userId;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "" || value.length > MAX_ID_LENGTH)
    throw new ActionError(`Missing ${label}.`, "invalid");
  return value;
}

function requireDate(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !ISO_DATE.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw new ActionError(`Invalid ${label}.`, "invalid");
  return value;
}

// An array of at most `max` plain objects (rows from the client).
function requireRows<T>(value: unknown, max: number, label: string): T[] {
  if (!Array.isArray(value) || value.length > max)
    throw new ActionError(`Invalid ${label}.`, "invalid");
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item))
      throw new ActionError(`Invalid ${label}.`, "invalid");
  }
  return value as T[];
}

// Sorted copy, so ops never depend on the order the store returns rows in.
function byId<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function requireInt(
  value: unknown,
  min: number,
  max: number,
  message: string
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new ActionError(message, "invalid");
  }
  return value;
}

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1) throw new ActionError("Enter a name.", "invalid");
  if (name.length > MAX_NAME_LENGTH) {
    throw new ActionError(
      `Names can be at most ${MAX_NAME_LENGTH} characters.`,
      "invalid"
    );
  }
  return name;
}

function getPlayer(state: ReadState, id: string): PlayerRow {
  const player = state.get("players", id);
  if (!player) throw new ActionError("Player not found.", "not_found");
  return player;
}

// Exists and has not been merged into another player.
function getActivePlayer(state: ReadState, id: string): PlayerRow {
  const player = getPlayer(state, id);
  if (player.mergedInto)
    throw new ActionError(
      `${player.name} has been merged into another player.`,
      "merged"
    );
  return player;
}

function getGame(state: ReadState, id: string): GameRow {
  const game = state.get("games", id);
  if (!game) throw new ActionError("Game not found.", "not_found");
  return game;
}

function getRound(state: ReadState, id: string): RoundRow {
  const round = state.get("rounds", id);
  if (!round) throw new ActionError("Round not found.", "not_found");
  return round;
}

function getTurn(state: ReadState, id: string): TurnRow {
  const turn = state.get("turns", id);
  if (!turn) throw new ActionError("Turn not found.", "not_found");
  return turn;
}

function requireCreator(game: GameRow, userId: string): void {
  if (game.createdBy !== userId) {
    throw new ActionError(
      "Only the person who created the game can do that.",
      "forbidden"
    );
  }
}

function requireNotDeleted(game: GameRow): void {
  if (game.deletedAt)
    throw new ActionError("That game has been deleted.", "not_found");
}

function isSeated(state: ReadState, gameId: string, playerId: string): boolean {
  return state
    .where("seats", "gameId", gameId)
    .some((seat) => seat.playerId === playerId);
}

// A game has started once any of its rounds has a turn.
function gameStarted(state: ReadState, gameId: string): boolean {
  return state
    .where("rounds", "gameId", gameId)
    .some((round) => state.where("turns", "roundId", round.id).length > 0);
}

// The turn's game, for permission checks. Turn -> round -> game.
function gameOfTurn(state: ReadState, turn: TurnRow): GameRow {
  return getGame(state, getRound(state, turn.roundId).gameId);
}

// ── Players ─────────────────────────────────────────────────────────────

function createPlayer(
  state: ReadState,
  args: ActionArgs["createPlayer"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const playerId = requireId(args.playerId, "player id");
  const name = cleanName(args.name);
  const existing = state.get("players", playerId);
  if (existing) {
    if (existing.name === name) return [];
    throw new ActionError("That player id is already in use.", "conflict");
  }
  const player: PlayerRow = { id: playerId, name, createdAt: ctx.now };
  if (args.claim === true) player.claimedBy = userId;
  return [put("players", player)];
}

function claimPlayer(
  state: ReadState,
  args: ActionArgs["claimPlayer"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const player = getActivePlayer(state, requireId(args.playerId, "player id"));
  if (player.claimedBy && player.claimedBy !== userId) {
    throw new ActionError(
      `${player.name} has already been claimed by someone else.`,
      "claimed"
    );
  }
  if (player.claimedBy === userId) return [];
  return [put("players", { ...player, claimedBy: userId })];
}

function unclaimPlayer(
  state: ReadState,
  args: ActionArgs["unclaimPlayer"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const player = getPlayer(state, requireId(args.playerId, "player id"));
  if (!player.claimedBy) return [];
  if (player.claimedBy !== userId)
    throw new ActionError("You haven't claimed this player.", "forbidden");
  return [put("players", { ...player, claimedBy: null })];
}

// ── Games ───────────────────────────────────────────────────────────────

function createGame(
  state: ReadState,
  args: ActionArgs["createGame"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const gameId = requireId(args.gameId, "game id");
  const seatId = requireId(args.seatId, "seat id");
  const playerId = requireId(args.playerId, "player id");
  const roundIds = args.roundIds;
  if (!Array.isArray(roundIds) || roundIds.length !== DEALS_NUM_CARDS.length) {
    throw new ActionError(
      `A game needs ${DEALS_NUM_CARDS.length} rounds.`,
      "invalid"
    );
  }
  roundIds.forEach((id) => requireId(id, "round id"));
  if (new Set(roundIds).size !== roundIds.length)
    throw new ActionError("Round ids must be unique.", "invalid");

  const existing = state.get("games", gameId);
  if (existing) {
    if (existing.createdBy === userId) return [];
    throw new ActionError("That game id is already in use.", "conflict");
  }
  getActivePlayer(state, playerId);
  if (
    state.get("seats", seatId) ||
    roundIds.some((id) => state.get("rounds", id))
  ) {
    throw new ActionError("That game id is already in use.", "conflict");
  }

  const game: GameRow = { id: gameId, createdAt: ctx.now, createdBy: userId };
  const rounds = roundIds.map(
    (id, roundNumber): RoundRow => ({ id, gameId, roundNumber })
  );
  const seat: SeatRow = { id: seatId, gameId, playerId, orderNumber: 0 };
  return [
    put("games", game),
    ...rounds.map((round) => put("rounds", round)),
    put("seats", seat),
  ];
}

function deleteGame(
  state: ReadState,
  args: ActionArgs["deleteGame"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const game = getGame(state, requireId(args.gameId, "game id"));
  requireCreator(game, userId);
  if (game.deletedAt) return [];
  return [put("games", { ...game, deletedAt: ctx.now })];
}

// ── Seats ───────────────────────────────────────────────────────────────

function addSeat(
  state: ReadState,
  args: ActionArgs["addSeat"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const seatId = requireId(args.seatId, "seat id");
  const gameId = requireId(args.gameId, "game id");
  const playerId = requireId(args.playerId, "player id");
  const orderNumber = requireInt(
    args.orderNumber,
    0,
    Number.MAX_SAFE_INTEGER,
    "Invalid seat position."
  );

  const game = getGame(state, gameId);
  const existing = state.get("seats", seatId);
  if (existing) {
    if (existing.gameId === gameId && existing.playerId === playerId) return [];
    throw new ActionError("That seat id is already in use.", "conflict");
  }
  const player = getPlayer(state, playerId);
  if (game.createdBy !== userId) {
    // Others may only seat a player they've claimed, before play begins.
    if (player.claimedBy !== userId) {
      throw new ActionError(
        "Only the person who created the game can add players.",
        "forbidden"
      );
    }
    if (gameStarted(state, gameId)) {
      throw new ActionError(
        "The game has already started, so players can't join now.",
        "started"
      );
    }
  }
  requireNotDeleted(game);
  getActivePlayer(state, playerId);
  if (isSeated(state, gameId, playerId)) {
    throw new ActionError(
      `${player.name} is already in this game.`,
      "conflict"
    );
  }
  return [put("seats", { id: seatId, gameId, playerId, orderNumber })];
}

function removeSeat(
  state: ReadState,
  args: ActionArgs["removeSeat"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const seat = state.get("seats", requireId(args.seatId, "seat id"));
  if (!seat) return [];
  requireCreator(getGame(state, seat.gameId), userId);
  const hasTurns = state
    .where("turns", "playerId", seat.playerId)
    .some((turn) => {
      return state.get("rounds", turn.roundId)?.gameId === seat.gameId;
    });
  if (hasTurns)
    throw new ActionError(
      "This player has already played in the game, so can't be removed.",
      "has_turns"
    );
  return [del("seats", seat.id)];
}

function reorderSeats(
  state: ReadState,
  args: ActionArgs["reorderSeats"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const game = getGame(state, requireId(args.gameId, "game id"));
  requireCreator(game, userId);
  const seats = state.where("seats", "gameId", game.id);
  const ids = args.seatIds;
  const sameSeats =
    Array.isArray(ids) &&
    ids.length === seats.length &&
    new Set(ids).size === ids.length &&
    ids.every((id) => seats.some((seat) => seat.id === id));
  if (!sameSeats)
    throw new ActionError(
      "The new order must include every player exactly once.",
      "invalid"
    );
  const ops: RowOp[] = [];
  ids.forEach((id, orderNumber) => {
    const seat = state.get("seats", id) as SeatRow;
    if (seat.orderNumber !== orderNumber)
      ops.push(put("seats", { ...seat, orderNumber }));
  });
  return ops;
}

function setInitialDealer(
  state: ReadState,
  args: ActionArgs["setInitialDealer"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const game = getGame(state, requireId(args.gameId, "game id"));
  const playerId = requireId(args.playerId, "player id");
  requireCreator(game, userId);
  if (game.initialDealerId === playerId) return [];
  if (gameStarted(state, game.id)) {
    throw new ActionError(
      "The game has already started, so the dealer can't change.",
      "started"
    );
  }
  if (!isSeated(state, game.id, playerId))
    throw new ActionError("That player isn't in this game.", "invalid");
  return [put("games", { ...game, initialDealerId: playerId })];
}

// ── Turns ───────────────────────────────────────────────────────────────

function placeBid(
  state: ReadState,
  args: ActionArgs["placeBid"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const turnId = requireId(args.turnId, "turn id");
  const playerId = requireId(args.playerId, "player id");
  const round = getRound(state, requireId(args.roundId, "round id"));
  const game = getGame(state, round.gameId);
  requireCreator(game, userId);

  const turns = state
    .where("turns", "roundId", round.id)
    .filter((turn) => turn.playerId === playerId);
  if (turns.some((turn) => turn.id === turnId)) return [];
  requireNotDeleted(game);
  if (!isSeated(state, game.id, playerId))
    throw new ActionError("That player isn't in this game.", "invalid");
  const numCards = DEALS_NUM_CARDS[round.roundNumber];
  if (numCards === undefined)
    throw new ActionError("Invalid round.", "invalid");
  requireInt(
    args.bid,
    0,
    numCards,
    `Bid must be a whole number from 0 to ${numCards}.`
  );
  if (turns.length > 0)
    throw new ActionError(
      "That player has already bid this round.",
      "conflict"
    );
  if (state.get("turns", turnId))
    throw new ActionError("That turn id is already in use.", "conflict");

  return [
    put("turns", {
      id: turnId,
      roundId: round.id,
      playerId,
      bid: args.bid,
      score: null,
    }),
  ];
}

function setScore(
  state: ReadState,
  args: ActionArgs["setScore"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const turn = getTurn(state, requireId(args.turnId, "turn id"));
  requireCreator(gameOfTurn(state, turn), userId);
  if (turn.bid == null)
    throw new ActionError("Place a bid before entering a score.", "invalid");
  requireInt(
    args.score,
    0,
    MAX_SCORE,
    `Score must be a whole number from 0 to ${MAX_SCORE}.`
  );
  if (turn.score === args.score) return [];
  return [put("turns", { ...turn, score: args.score })];
}

function clearScore(
  state: ReadState,
  args: ActionArgs["clearScore"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const turn = getTurn(state, requireId(args.turnId, "turn id"));
  requireCreator(gameOfTurn(state, turn), userId);
  if (turn.score == null) return [];
  return [put("turns", { ...turn, score: null })];
}

function deleteTurn(
  state: ReadState,
  args: ActionArgs["deleteTurn"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const turn = state.get("turns", requireId(args.turnId, "turn id"));
  if (!turn) return [];
  requireCreator(gameOfTurn(state, turn), userId);
  return [del("turns", turn.id)];
}

// ── Merging ─────────────────────────────────────────────────────────────

function mergePlayers(
  state: ReadState,
  args: ActionArgs["mergePlayers"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const from = getPlayer(state, requireId(args.fromId, "player id"));
  const into = getPlayer(state, requireId(args.intoId, "player id"));
  if (from.id === into.id)
    throw new ActionError("Pick two different players to merge.", "invalid");
  if (from.mergedInto === into.id) return [];
  if (into.claimedBy !== userId && ctx.isGuest) {
    throw new ActionError(
      "Sign in to an account to merge players.",
      "forbidden"
    );
  }
  if (from.mergedInto || into.mergedInto) {
    throw new ActionError(
      "One of those players has already been merged.",
      "merged"
    );
  }
  if (from.claimedBy && from.claimedBy !== ctx.internal?.allowClaimedFrom) {
    throw new ActionError(
      `${from.name} belongs to someone else, so can't be merged.`,
      "claimed"
    );
  }

  // Merging two players who appear in the same live game would double them up.
  const liveGames = new Set<string>();
  for (const seat of state.where("seats", "playerId", from.id)) {
    const game = state.get("games", seat.gameId);
    if (game && !game.deletedAt) liveGames.add(game.id);
  }
  if (
    state
      .where("seats", "playerId", into.id)
      .some((seat) => liveGames.has(seat.gameId))
  ) {
    throw new ActionError(
      "Those players have played in the same game, so can't be merged.",
      "shared_game"
    );
  }

  const seats = byId(state.where("seats", "playerId", from.id));
  const turns = byId(state.where("turns", "playerId", from.id));
  const dealerGames = byId(state.where("games", "initialDealerId", from.id));
  const mergeLog = {
    into: into.id,
    seats: seats.map((seat) => seat.id),
    turns: turns.map((turn) => turn.id),
    dealerGames: dealerGames.map((game) => game.id),
  };
  return [
    ...seats.map((seat) => put("seats", { ...seat, playerId: into.id })),
    ...turns.map((turn) => put("turns", { ...turn, playerId: into.id })),
    ...dealerGames.map((game) =>
      put("games", { ...game, initialDealerId: into.id })
    ),
    put("players", {
      ...from,
      mergedInto: into.id,
      mergedAt: ctx.now,
      mergeLog,
    }),
  ];
}

// The player a merge target has since been merged into, and so on. Rows held
// by anyone on this chain still belong to the merge being undone; rows held
// by anyone else were moved on purpose since (e.g. by an earlier merge's undo).
function mergeChain(state: ReadState, startId: string): Set<string> {
  const chain = new Set<string>();
  let id: string | null | undefined = startId;
  while (id && !chain.has(id)) {
    chain.add(id);
    id = state.get("players", id)?.mergedInto;
  }
  return chain;
}

function undoMerge(
  state: ReadState,
  args: ActionArgs["undoMerge"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const from = getPlayer(state, requireId(args.fromId, "player id"));
  const log = from.mergeLog;
  if (!log) return [];
  const target = state.get("players", log.into);
  const ownsTarget = !!target?.claimedBy && target.claimedBy === userId;
  // A claimed player (guest handoff) can only be restored by the target's owner.
  if ((from.claimedBy || ctx.isGuest) && !ownsTarget) {
    throw new ActionError(
      "You can't undo this merge. Ask whoever owns the merged player.",
      "forbidden"
    );
  }

  const chain = mergeChain(state, log.into);
  const mine = (holder: string) => chain.has(holder) && holder !== from.id;
  const restoredSeats = new Map<string, SeatRow>();
  for (const id of [...log.seats].sort()) {
    const seat = state.get("seats", id);
    if (seat && mine(seat.playerId)) restoredSeats.set(id, seat);
  }
  const restoredTurns = new Map<string, TurnRow>();
  const addTurn = (turn: TurnRow | undefined) => {
    if (turn && mine(turn.playerId)) restoredTurns.set(turn.id, turn);
  };
  for (const id of log.turns) addTurn(state.get("turns", id));
  // Turns added after the merge, in the games whose seats are going back.
  for (const seat of restoredSeats.values()) {
    for (const turn of state.where("turns", "playerId", seat.playerId)) {
      if (state.get("rounds", turn.roundId)?.gameId === seat.gameId)
        addTurn(turn);
    }
  }
  const restoredGames: GameRow[] = [];
  for (const id of [...log.dealerGames].sort()) {
    const game = state.get("games", id);
    if (game?.initialDealerId && mine(game.initialDealerId))
      restoredGames.push(game);
  }

  return [
    ...byId([...restoredSeats.values()]).map((seat) =>
      put("seats", { ...seat, playerId: from.id })
    ),
    ...byId([...restoredTurns.values()]).map((turn) =>
      put("turns", { ...turn, playerId: from.id })
    ),
    ...restoredGames.map((game) =>
      put("games", { ...game, initialDealerId: from.id })
    ),
    put("players", {
      ...from,
      mergedInto: null,
      mergedAt: null,
      mergeLog: null,
    }),
  ];
}

// ── Import (offline guest-mode game upload) ─────────────────────────────

function importGame(
  state: ReadState,
  args: ActionArgs["importGame"],
  ctx: ActionContext
): RowOp[] {
  const userId = requireUser(ctx);
  const bad = (message: string) => new ActionError(message, "invalid");
  const game = args.game;
  if (game === null || typeof game !== "object" || Array.isArray(game))
    throw bad("Invalid game data.");
  const gameId = requireId(game.id, "game id");
  if (game.createdBy !== userId)
    throw new ActionError("You can only import your own games.", "forbidden");
  const createdAt = requireDate(game.createdAt, "game date");
  const deletedAt =
    game.deletedAt == null ? null : requireDate(game.deletedAt, "deleted date");

  const existing = state.get("games", gameId);
  if (existing) {
    if (existing.createdBy === userId && existing.createdAt === createdAt)
      return [];
    throw new ActionError("That game id is already in use.", "conflict");
  }

  const newPlayers = requireRows<{ id: string; name: string }>(
    args.newPlayers,
    MAX_IMPORT_SEATS,
    "players"
  );
  const seats = requireRows<SeatRow>(args.seats, MAX_IMPORT_SEATS, "seats");
  const rounds = requireRows<RoundRow>(
    args.rounds,
    DEALS_NUM_CARDS.length,
    "rounds"
  );
  const turns = requireRows<TurnRow>(
    args.turns,
    rounds.length * seats.length,
    "turns"
  );

  // Every id in the import must be new and unique within it.
  const seen = new Set<string>();
  const fresh = (table: TableName, id: unknown): string => {
    const key = requireId(id, "id");
    if (state.get(table, key) || seen.has(`${table}:${key}`)) {
      throw new ActionError(
        "Some of the imported rows already exist.",
        "conflict"
      );
    }
    seen.add(`${table}:${key}`);
    return key;
  };

  const players = newPlayers.map((p): PlayerRow => {
    return {
      id: fresh("players", p.id),
      name: cleanName(p.name),
      createdAt: ctx.now,
    };
  });
  const newIds = new Set(players.map((p) => p.id));
  const knownPlayer = (id: unknown): string => {
    const key = requireId(id, "player id");
    if (!newIds.has(key)) getActivePlayer(state, key);
    return key;
  };

  const roundRows = rounds.map((r): RoundRow => {
    if (r.gameId !== gameId) throw bad("A round belongs to a different game.");
    const roundNumber = requireInt(
      r.roundNumber,
      0,
      DEALS_NUM_CARDS.length - 1,
      "Invalid round number."
    );
    return { id: fresh("rounds", r.id), gameId, roundNumber };
  });
  if (new Set(roundRows.map((r) => r.roundNumber)).size !== roundRows.length)
    throw bad("Duplicate round numbers.");

  const seatRows = seats.map((s): SeatRow => {
    if (s.gameId !== gameId) throw bad("A seat belongs to a different game.");
    const orderNumber = requireInt(
      s.orderNumber,
      0,
      Number.MAX_SAFE_INTEGER,
      "Invalid seat position."
    );
    return {
      id: fresh("seats", s.id),
      gameId,
      playerId: knownPlayer(s.playerId),
      orderNumber,
    };
  });
  const seated = new Set(seatRows.map((s) => s.playerId));
  if (seated.size !== seatRows.length) throw bad("A player is seated twice.");

  const dealerId =
    game.initialDealerId == null
      ? null
      : requireId(game.initialDealerId, "dealer id");
  if (dealerId && !seated.has(dealerId))
    throw bad("The dealer must be one of the players in the game.");

  const roundsById = new Map(roundRows.map((r) => [r.id, r]));
  const turnRows = turns.map((t): TurnRow => {
    const round = roundsById.get(t.roundId);
    if (!round) throw bad("A turn belongs to a different game.");
    const playerId = requireId(t.playerId, "player id");
    if (!seated.has(playerId))
      throw bad("A turn is for a player not in the game.");
    const bid =
      t.bid == null
        ? null
        : requireInt(
            t.bid,
            0,
            DEALS_NUM_CARDS[round.roundNumber],
            "Invalid bid."
          );
    const score =
      t.score == null
        ? null
        : requireInt(t.score, 0, MAX_SCORE, "Invalid score.");
    if (score !== null && bid === null) throw bad("A score needs a bid.");
    return {
      id: fresh("turns", t.id),
      roundId: round.id,
      playerId,
      bid,
      score,
    };
  });
  if (
    new Set(turnRows.map((t) => `${t.roundId}:${t.playerId}`)).size !==
    turnRows.length
  ) {
    throw bad("A player has two turns in one round.");
  }

  const gameRow: GameRow = { id: gameId, createdAt, createdBy: userId };
  if (deletedAt) gameRow.deletedAt = deletedAt;
  if (dealerId) gameRow.initialDealerId = dealerId;
  return [
    ...players.map((row) => put("players", row)),
    put("games", gameRow),
    ...roundRows.map((row) => put("rounds", row)),
    ...seatRows.map((row) => put("seats", row)),
    ...turnRows.map((row) => put("turns", row)),
  ];
}

// ── Dispatcher ──────────────────────────────────────────────────────────

// Whatever the client sends, the only thing that can come out is RowOps or an
// ActionError: anything else thrown while reading the args is "invalid".
export function applyAction(
  state: ReadState,
  action: Action,
  ctx: ActionContext
): RowOp[] {
  try {
    return dispatch(state, action, ctx);
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError("Invalid request.", "invalid");
  }
}

function dispatch(
  state: ReadState,
  action: Action,
  ctx: ActionContext
): RowOp[] {
  const args = action.args;
  if (args === null || typeof args !== "object")
    throw new ActionError("Invalid action.", "invalid");
  switch (action.name) {
    case "createPlayer":
      return createPlayer(state, args as ActionArgs["createPlayer"], ctx);
    case "claimPlayer":
      return claimPlayer(state, args as ActionArgs["claimPlayer"], ctx);
    case "unclaimPlayer":
      return unclaimPlayer(state, args as ActionArgs["unclaimPlayer"], ctx);
    case "createGame":
      return createGame(state, args as ActionArgs["createGame"], ctx);
    case "deleteGame":
      return deleteGame(state, args as ActionArgs["deleteGame"], ctx);
    case "addSeat":
      return addSeat(state, args as ActionArgs["addSeat"], ctx);
    case "removeSeat":
      return removeSeat(state, args as ActionArgs["removeSeat"], ctx);
    case "reorderSeats":
      return reorderSeats(state, args as ActionArgs["reorderSeats"], ctx);
    case "setInitialDealer":
      return setInitialDealer(
        state,
        args as ActionArgs["setInitialDealer"],
        ctx
      );
    case "placeBid":
      return placeBid(state, args as ActionArgs["placeBid"], ctx);
    case "setScore":
      return setScore(state, args as ActionArgs["setScore"], ctx);
    case "clearScore":
      return clearScore(state, args as ActionArgs["clearScore"], ctx);
    case "deleteTurn":
      return deleteTurn(state, args as ActionArgs["deleteTurn"], ctx);
    case "mergePlayers":
      return mergePlayers(state, args as ActionArgs["mergePlayers"], ctx);
    case "undoMerge":
      return undoMerge(state, args as ActionArgs["undoMerge"], ctx);
    case "importGame":
      return importGame(state, args as ActionArgs["importGame"], ctx);
    default:
      throw new ActionError("Unknown action.", "unknown_action");
  }
}
