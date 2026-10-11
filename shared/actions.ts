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
        if (row[field as keyof typeof row] === value) found.push(row as Tables[typeof table]);
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

const put = <T extends TableName>(table: T, row: Tables[T]): RowOp => ({ op: "put", table, row });
const del = (table: TableName, id: string): RowOp => ({ op: "delete", table, id });

function requireUser(ctx: ActionContext): string {
  if (!ctx.userId) throw new ActionError("Sign in to do that.", "not_signed_in");
  return ctx.userId;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || value === "") throw new ActionError(`Missing ${label}.`, "invalid");
  return value;
}

function requireInt(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ActionError(message, "invalid");
  }
  return value;
}

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1) throw new ActionError("Enter a name.", "invalid");
  if (name.length > MAX_NAME_LENGTH) {
    throw new ActionError(`Names can be at most ${MAX_NAME_LENGTH} characters.`, "invalid");
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
  if (player.mergedInto) throw new ActionError(`${player.name} has been merged into another player.`, "merged");
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

function getSeat(state: ReadState, id: string): SeatRow {
  const seat = state.get("seats", id);
  if (!seat) throw new ActionError("Seat not found.", "not_found");
  return seat;
}

function requireCreator(game: GameRow, userId: string): void {
  if (game.createdBy !== userId) {
    throw new ActionError("Only the person who created the game can do that.", "forbidden");
  }
}

function requireNotDeleted(game: GameRow): void {
  if (game.deletedAt) throw new ActionError("That game has been deleted.", "not_found");
}

function isSeated(state: ReadState, gameId: string, playerId: string): boolean {
  return state.where("seats", "gameId", gameId).some((seat) => seat.playerId === playerId);
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

function createPlayer(state: ReadState, args: ActionArgs["createPlayer"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const playerId = requireId(args.playerId, "player id");
  const name = cleanName(args.name);
  const existing = state.get("players", playerId);
  if (existing) {
    if (existing.name === name) return [];
    throw new ActionError("That player id is already in use.", "conflict");
  }
  const player: PlayerRow = { id: playerId, name, createdAt: ctx.now };
  if (args.claim) player.claimedBy = userId;
  return [put("players", player)];
}

function claimPlayer(state: ReadState, args: ActionArgs["claimPlayer"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const player = getActivePlayer(state, requireId(args.playerId, "player id"));
  if (player.claimedBy && player.claimedBy !== userId) {
    throw new ActionError(`${player.name} has already been claimed by someone else.`, "claimed");
  }
  return [put("players", { ...player, claimedBy: userId })];
}

function unclaimPlayer(state: ReadState, args: ActionArgs["unclaimPlayer"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const player = getPlayer(state, requireId(args.playerId, "player id"));
  if (player.claimedBy !== userId) throw new ActionError("You haven't claimed this player.", "forbidden");
  return [put("players", { ...player, claimedBy: null })];
}

// ── Games ───────────────────────────────────────────────────────────────

function createGame(state: ReadState, args: ActionArgs["createGame"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const gameId = requireId(args.gameId, "game id");
  const seatId = requireId(args.seatId, "seat id");
  const playerId = requireId(args.playerId, "player id");
  const roundIds = args.roundIds;
  if (!Array.isArray(roundIds) || roundIds.length !== DEALS_NUM_CARDS.length) {
    throw new ActionError(`A game needs ${DEALS_NUM_CARDS.length} rounds.`, "invalid");
  }
  roundIds.forEach((id) => requireId(id, "round id"));
  if (new Set(roundIds).size !== roundIds.length) throw new ActionError("Round ids must be unique.", "invalid");

  const existing = state.get("games", gameId);
  if (existing) {
    if (existing.createdBy === userId) return [];
    throw new ActionError("That game id is already in use.", "conflict");
  }
  getActivePlayer(state, playerId);
  if (state.get("seats", seatId) || roundIds.some((id) => state.get("rounds", id))) {
    throw new ActionError("That game id is already in use.", "conflict");
  }

  const game: GameRow = { id: gameId, createdAt: ctx.now, createdBy: userId };
  const rounds = roundIds.map((id, roundNumber): RoundRow => ({ id, gameId, roundNumber }));
  const seat: SeatRow = { id: seatId, gameId, playerId, orderNumber: 0 };
  return [put("games", game), ...rounds.map((round) => put("rounds", round)), put("seats", seat)];
}

function deleteGame(state: ReadState, args: ActionArgs["deleteGame"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const game = getGame(state, requireId(args.gameId, "game id"));
  requireCreator(game, userId);
  if (game.deletedAt) return [];
  return [put("games", { ...game, deletedAt: ctx.now })];
}

// ── Seats ───────────────────────────────────────────────────────────────

function addSeat(state: ReadState, args: ActionArgs["addSeat"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const seatId = requireId(args.seatId, "seat id");
  const gameId = requireId(args.gameId, "game id");
  const playerId = requireId(args.playerId, "player id");
  const orderNumber = requireInt(args.orderNumber, 0, Number.MAX_SAFE_INTEGER, "Invalid seat position.");

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
      throw new ActionError("Only the person who created the game can add players.", "forbidden");
    }
    if (gameStarted(state, gameId)) {
      throw new ActionError("The game has already started, so players can't join now.", "started");
    }
  }
  requireNotDeleted(game);
  getActivePlayer(state, playerId);
  if (isSeated(state, gameId, playerId)) {
    throw new ActionError(`${player.name} is already in this game.`, "conflict");
  }
  return [put("seats", { id: seatId, gameId, playerId, orderNumber })];
}

function removeSeat(state: ReadState, args: ActionArgs["removeSeat"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const seat = getSeat(state, requireId(args.seatId, "seat id"));
  requireCreator(getGame(state, seat.gameId), userId);
  const hasTurns = state.where("turns", "playerId", seat.playerId).some((turn) => {
    return state.get("rounds", turn.roundId)?.gameId === seat.gameId;
  });
  if (hasTurns) throw new ActionError("This player has already played in the game, so can't be removed.", "has_turns");
  return [del("seats", seat.id)];
}

function reorderSeats(state: ReadState, args: ActionArgs["reorderSeats"], ctx: ActionContext): RowOp[] {
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
  if (!sameSeats) throw new ActionError("The new order must include every player exactly once.", "invalid");
  return ids.map((id, orderNumber) => put("seats", { ...(state.get("seats", id) as SeatRow), orderNumber }));
}

function setInitialDealer(state: ReadState, args: ActionArgs["setInitialDealer"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const game = getGame(state, requireId(args.gameId, "game id"));
  const playerId = requireId(args.playerId, "player id");
  requireCreator(game, userId);
  if (gameStarted(state, game.id)) {
    throw new ActionError("The game has already started, so the dealer can't change.", "started");
  }
  if (!isSeated(state, game.id, playerId)) throw new ActionError("That player isn't in this game.", "invalid");
  return [put("games", { ...game, initialDealerId: playerId })];
}

// ── Turns ───────────────────────────────────────────────────────────────

function placeBid(state: ReadState, args: ActionArgs["placeBid"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const turnId = requireId(args.turnId, "turn id");
  const playerId = requireId(args.playerId, "player id");
  const round = getRound(state, requireId(args.roundId, "round id"));
  const game = getGame(state, round.gameId);
  requireCreator(game, userId);

  const turns = state.where("turns", "roundId", round.id).filter((turn) => turn.playerId === playerId);
  if (turns.some((turn) => turn.id === turnId)) return [];
  requireNotDeleted(game);
  if (!isSeated(state, game.id, playerId)) throw new ActionError("That player isn't in this game.", "invalid");
  const numCards = DEALS_NUM_CARDS[round.roundNumber];
  if (numCards === undefined) throw new ActionError("Invalid round.", "invalid");
  requireInt(args.bid, 0, numCards, `Bid must be a whole number from 0 to ${numCards}.`);
  if (turns.length > 0) throw new ActionError("That player has already bid this round.", "conflict");
  if (state.get("turns", turnId)) throw new ActionError("That turn id is already in use.", "conflict");

  return [put("turns", { id: turnId, roundId: round.id, playerId, bid: args.bid, score: null })];
}

function setScore(state: ReadState, args: ActionArgs["setScore"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const turn = getTurn(state, requireId(args.turnId, "turn id"));
  requireCreator(gameOfTurn(state, turn), userId);
  if (turn.bid == null) throw new ActionError("Place a bid before entering a score.", "invalid");
  requireInt(args.score, 0, MAX_SCORE, `Score must be a whole number from 0 to ${MAX_SCORE}.`);
  return [put("turns", { ...turn, score: args.score })];
}

function clearScore(state: ReadState, args: ActionArgs["clearScore"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const turn = getTurn(state, requireId(args.turnId, "turn id"));
  requireCreator(gameOfTurn(state, turn), userId);
  return [put("turns", { ...turn, score: null })];
}

function deleteTurn(state: ReadState, args: ActionArgs["deleteTurn"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const turn = getTurn(state, requireId(args.turnId, "turn id"));
  requireCreator(gameOfTurn(state, turn), userId);
  return [del("turns", turn.id)];
}

// ── Merging ─────────────────────────────────────────────────────────────

function mergePlayers(state: ReadState, args: ActionArgs["mergePlayers"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const from = getPlayer(state, requireId(args.fromId, "player id"));
  const into = getPlayer(state, requireId(args.intoId, "player id"));
  if (from.id === into.id) throw new ActionError("Pick two different players to merge.", "invalid");
  if (into.claimedBy !== userId && ctx.isGuest) {
    throw new ActionError("Sign in to an account to merge players.", "forbidden");
  }
  if (from.mergedInto || into.mergedInto) {
    throw new ActionError("One of those players has already been merged.", "merged");
  }
  if (from.claimedBy && from.claimedBy !== ctx.internal?.allowClaimedFrom) {
    throw new ActionError(`${from.name} belongs to someone else, so can't be merged.`, "claimed");
  }

  // Merging two players who appear in the same live game would double them up.
  const liveGames = new Set<string>();
  for (const seat of state.where("seats", "playerId", from.id)) {
    const game = state.get("games", seat.gameId);
    if (game && !game.deletedAt) liveGames.add(game.id);
  }
  if (state.where("seats", "playerId", into.id).some((seat) => liveGames.has(seat.gameId))) {
    throw new ActionError("Those players have played in the same game, so can't be merged.", "shared_game");
  }

  const seats = state.where("seats", "playerId", from.id);
  const turns = state.where("turns", "playerId", from.id);
  const dealerGames = state.where("games", "initialDealerId", from.id);
  const mergeLog = {
    into: into.id,
    seats: seats.map((seat) => seat.id),
    turns: turns.map((turn) => turn.id),
    dealerGames: dealerGames.map((game) => game.id),
  };
  return [
    ...seats.map((seat) => put("seats", { ...seat, playerId: into.id })),
    ...turns.map((turn) => put("turns", { ...turn, playerId: into.id })),
    ...dealerGames.map((game) => put("games", { ...game, initialDealerId: into.id })),
    put("players", { ...from, mergedInto: into.id, mergedAt: ctx.now, mergeLog }),
  ];
}

function undoMerge(state: ReadState, args: ActionArgs["undoMerge"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const from = getPlayer(state, requireId(args.fromId, "player id"));
  const log = from.mergeLog;
  if (!log) throw new ActionError(`${from.name} hasn't been merged.`, "invalid");
  const into = state.get("players", log.into);
  if (ctx.isGuest && into?.claimedBy !== userId) {
    throw new ActionError("Sign in to an account to undo a merge.", "forbidden");
  }

  // Whoever holds the logged rows now gives them back; rows that are gone are skipped.
  const ops: RowOp[] = [];
  for (const id of log.seats) {
    const seat = state.get("seats", id);
    if (seat) ops.push(put("seats", { ...seat, playerId: from.id }));
  }
  for (const id of log.turns) {
    const turn = state.get("turns", id);
    if (turn) ops.push(put("turns", { ...turn, playerId: from.id }));
  }
  for (const id of log.dealerGames) {
    const game = state.get("games", id);
    if (game) ops.push(put("games", { ...game, initialDealerId: from.id }));
  }
  ops.push(put("players", { ...from, mergedInto: null, mergedAt: null, mergeLog: null }));
  return ops;
}

// ── Import (offline guest-mode game upload) ─────────────────────────────

function importGame(state: ReadState, args: ActionArgs["importGame"], ctx: ActionContext): RowOp[] {
  const userId = requireUser(ctx);
  const { game, newPlayers, seats, rounds, turns } = args;
  const bad = (message: string) => new ActionError(message, "invalid");
  if (!game || ![newPlayers, seats, rounds, turns].every(Array.isArray)) throw bad("Invalid game data.");
  const gameId = requireId(game.id, "game id");
  if (game.createdBy !== userId) throw new ActionError("You can only import your own games.", "forbidden");
  if (typeof game.createdAt !== "string" || game.createdAt === "") throw bad("Missing game date.");

  const existing = state.get("games", gameId);
  if (existing) {
    if (existing.createdBy === userId && existing.createdAt === game.createdAt) return [];
    throw new ActionError("That game id is already in use.", "conflict");
  }

  // Every id in the import must be new and unique within it.
  const seen = new Set<string>();
  const fresh = (table: TableName, id: unknown): string => {
    const key = requireId(id, "id");
    if (state.get(table, key) || seen.has(`${table}:${key}`)) {
      throw new ActionError("Some of the imported rows already exist.", "conflict");
    }
    seen.add(`${table}:${key}`);
    return key;
  };

  const players = newPlayers.map((p): PlayerRow => {
    return { id: fresh("players", p.id), name: cleanName(p.name), createdAt: ctx.now };
  });
  const knownPlayer = (id: unknown): string => {
    const key = requireId(id, "player id");
    if (!state.get("players", key) && !players.some((p) => p.id === key)) {
      throw new ActionError("An imported game refers to an unknown player.", "not_found");
    }
    return key;
  };
  if (game.initialDealerId) knownPlayer(game.initialDealerId);

  const roundRows = rounds.map((r): RoundRow => {
    if (r.gameId !== gameId) throw bad("A round belongs to a different game.");
    const roundNumber = requireInt(r.roundNumber, 0, DEALS_NUM_CARDS.length - 1, "Invalid round number.");
    return { id: fresh("rounds", r.id), gameId, roundNumber };
  });
  if (new Set(roundRows.map((r) => r.roundNumber)).size !== roundRows.length) throw bad("Duplicate round numbers.");

  const seatRows = seats.map((s): SeatRow => {
    if (s.gameId !== gameId) throw bad("A seat belongs to a different game.");
    const orderNumber = requireInt(s.orderNumber, 0, Number.MAX_SAFE_INTEGER, "Invalid seat position.");
    return { id: fresh("seats", s.id), gameId, playerId: knownPlayer(s.playerId), orderNumber };
  });
  if (new Set(seatRows.map((s) => s.playerId)).size !== seatRows.length) throw bad("A player is seated twice.");

  const turnRows = turns.map((t): TurnRow => {
    const round = roundRows.find((r) => r.id === t.roundId);
    if (!round) throw bad("A turn belongs to a different game.");
    const maxBid = DEALS_NUM_CARDS[round.roundNumber];
    const bid = t.bid == null ? null : requireInt(t.bid, 0, maxBid, "Invalid bid.");
    const score = t.score == null ? null : requireInt(t.score, 0, MAX_SCORE, "Invalid score.");
    return { id: fresh("turns", t.id), roundId: round.id, playerId: knownPlayer(t.playerId), bid, score };
  });
  if (new Set(turnRows.map((t) => `${t.roundId}:${t.playerId}`)).size !== turnRows.length) {
    throw bad("A player has two turns in one round.");
  }

  const gameRow: GameRow = { id: gameId, createdAt: game.createdAt, createdBy: userId };
  if (game.deletedAt) gameRow.deletedAt = game.deletedAt;
  if (game.initialDealerId) gameRow.initialDealerId = game.initialDealerId;
  return [
    ...players.map((row) => put("players", row)),
    put("games", gameRow),
    ...roundRows.map((row) => put("rounds", row)),
    ...seatRows.map((row) => put("seats", row)),
    ...turnRows.map((row) => put("turns", row)),
  ];
}

// ── Dispatcher ──────────────────────────────────────────────────────────

export function applyAction(state: ReadState, action: Action, ctx: ActionContext): RowOp[] {
  const args = action.args;
  if (args === null || typeof args !== "object") throw new ActionError("Invalid action.", "invalid");
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
      return setInitialDealer(state, args as ActionArgs["setInitialDealer"], ctx);
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
