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

// Every game (deleted ones too; the UI filters `deletedAt`) with its seats,
// rounds and turns, and each seat/turn's player when we have it.
export function selectHomeGames(view: DataState): HomeGames {
  const cached = homeGamesCache.get(view);
  if (cached) return cached;

  const withPlayer = <R extends { playerId: string }>(row: R) => {
    const player = view.players.get(row.playerId);
    return player ? { ...row, player } : row;
  };
  const seats = groupBy(view.seats.values(), (seat) => seat.gameId);
  const rounds = groupBy(view.rounds.values(), (round) => round.gameId);
  const turns = groupBy(view.turns.values(), (turn) => turn.roundId);

  const games = [...view.games.values()].map((game) => ({
    ...game,
    playersOrders: (seats.get(game.id) ?? [])
      .sort((a, b) => a.orderNumber - b.orderNumber)
      .map(withPlayer),
    rounds: (rounds.get(game.id) ?? [])
      .sort((a, b) => a.roundNumber - b.roundNumber)
      .map((round) => ({
        ...round,
        turns: (turns.get(round.id) ?? []).map(withPlayer),
      })),
  }));
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
