import type {
  DataState,
  GameRow,
  PlayerRow,
  RoundRow,
  SeatRow,
  TurnRow,
} from "../../shared/types";

// The old InstantDB query shapes, computed from a view. Results are cached
// per view object, so calling these on every render is cheap.

export type HomeGame = GameRow & {
  playersOrders: (SeatRow & { player?: PlayerRow })[];
  rounds: (RoundRow & { turns: (TurnRow & { player?: PlayerRow })[] })[];
};
export type HomeGames = { games: HomeGame[] };

const homeGamesCache = new WeakMap<DataState, HomeGames>();

function groupBy<T>(rows: Iterable<T>, key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

// Games whose rows are all the same objects as last time keep their old
// result object, so memoised components don't re-render when only some other
// game changed. Rows keep their identity from one view to the next.
const gameCache = new WeakMap<GameRow, { rows: unknown[]; game: HomeGame }>();

// Every game (deleted ones too; the UI filters `deletedAt`) with its seats,
// rounds and turns, and each seat/turn's player when we have it.
export function selectHomeGames(view: DataState): HomeGames {
  const cached = homeGamesCache.get(view);
  if (cached) return cached;

  const seats = groupBy(view.seats.values(), (seat) => seat.gameId);
  const rounds = groupBy(view.rounds.values(), (round) => round.gameId);
  const turns = groupBy(view.turns.values(), (turn) => turn.roundId);

  const games = [...view.games.values()].map((row) => {
    const gameSeats = (seats.get(row.id) ?? []).sort(
      (a, b) => a.orderNumber - b.orderNumber
    );
    const gameRounds = (rounds.get(row.id) ?? []).sort(
      (a, b) => a.roundNumber - b.roundNumber
    );
    const roundTurns = gameRounds.map((round) => turns.get(round.id) ?? []);
    // Every row this game's result is made of, in a fixed order.
    const used: unknown[] = [];
    const player = (playerId: string) => {
      const found = view.players.get(playerId);
      used.push(found);
      return found;
    };
    const withPlayer = <R extends { playerId: string }>(r: R) => {
      used.push(r);
      const found = player(r.playerId);
      return found ? { ...r, player: found } : r;
    };
    const result: HomeGame = {
      ...row,
      playersOrders: gameSeats.map(withPlayer),
      rounds: gameRounds.map((round, i) => {
        used.push(round);
        return { ...round, turns: roundTurns[i].map(withPlayer) };
      }),
    };
    used.push(row);

    const before = gameCache.get(row);
    if (
      before &&
      before.rows.length === used.length &&
      before.rows.every((r, i) => r === used[i])
    ) {
      return before.game;
    }
    gameCache.set(row, { rows: used, game: result });
    return result;
  });
  const result = { games };
  homeGamesCache.set(view, result);
  return result;
}

export const selectGame = (view: DataState, gameId: string | undefined) =>
  gameId ? selectHomeGames(view).games.find((g) => g.id === gameId) : undefined;

const claimCache = new WeakMap<DataState, Map<string, PlayerRow[]>>();

// The players a user has claimed ("my player"), skipping merged-away ones.
export function selectPlayersByClaim(view: DataState, userId: string) {
  let byUser = claimCache.get(view);
  if (!byUser) claimCache.set(view, (byUser = new Map()));
  let players = byUser.get(userId);
  if (!players) {
    players = [...view.players.values()].filter(
      (p) => p.claimedBy === userId && !p.mergedInto
    );
    byUser.set(userId, players);
  }
  return players;
}

const playersCache = new WeakMap<DataState, PlayerRow[]>();

// All players that haven't been merged into another, by name.
export function selectActivePlayers(view: DataState) {
  let players = playersCache.get(view);
  if (!players) {
    players = [...view.players.values()]
      .filter((p) => !p.mergedInto)
      .sort((a, b) => a.name.localeCompare(b.name));
    playersCache.set(view, players);
  }
  return players;
}
