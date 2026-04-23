// Local-only game state for playing without an account / while offline.
// Schema is intentionally denormalized — no player entities across games,
// no relations. Names are strings. Migration to the cloud is a one-shot
// dialog that matches names → cloud players.

import { DEALS } from "../constants";

export type GuestTurn = {
  id: string;
  playerId: string;
  bid: number | null;
  score: number | null;
};

export type GuestRound = {
  id: string;
  roundNumber: number;
  turns: GuestTurn[];
};

export type GuestPlayer = {
  id: string;
  name: string;
};

export type GuestGame = {
  id: string;
  createdAt: string;
  players: GuestPlayer[];
  initialDealerId: string | null;
  rounds: GuestRound[];
  deletedAt?: string;
};

const KEY = "guest-games-v1";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

// Cheap uuid for local-only entities. Not cryptographic — just unique enough.
const uid = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

export const listGames = (): GuestGame[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GuestGame[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const hasGames = (): boolean =>
  listGames().some((g) => !g.deletedAt);

const save = (games: GuestGame[]) => {
  localStorage.setItem(KEY, JSON.stringify(games));
  emit();
};

export const getGame = (id: string): GuestGame | undefined =>
  listGames().find((g) => g.id === id);

export const createGame = (): GuestGame => {
  const game: GuestGame = {
    id: uid("guest"),
    createdAt: new Date().toISOString(),
    players: [],
    initialDealerId: null,
    rounds: DEALS.map((d) => ({
      id: uid("gr"),
      roundNumber: d.id,
      turns: [],
    })),
  };
  save([game, ...listGames()]);
  return game;
};

const update = (id: string, updater: (g: GuestGame) => GuestGame) => {
  const games = listGames();
  const idx = games.findIndex((g) => g.id === id);
  if (idx === -1) return;
  games[idx] = updater(games[idx]);
  save(games);
};

export const deleteGame = (id: string) => {
  update(id, (g) => ({ ...g, deletedAt: new Date().toISOString() }));
};

export const clearAll = () => save([]);

// ── Setup mutations ──

export const addPlayer = (gameId: string, name: string) => {
  update(gameId, (g) => ({
    ...g,
    players: [...g.players, { id: uid("gp"), name }],
  }));
};

export const removePlayer = (gameId: string, playerId: string) => {
  update(gameId, (g) => ({
    ...g,
    players: g.players.filter((p) => p.id !== playerId),
    initialDealerId:
      g.initialDealerId === playerId ? null : g.initialDealerId,
    rounds: g.rounds.map((r) => ({
      ...r,
      turns: r.turns.filter((tt) => tt.playerId !== playerId),
    })),
  }));
};

export const reorderPlayers = (
  gameId: string,
  fromIdx: number,
  toIdx: number
) => {
  update(gameId, (g) => {
    const players = [...g.players];
    const [moved] = players.splice(fromIdx, 1);
    players.splice(toIdx, 0, moved);
    return { ...g, players };
  });
};

export const setInitialDealer = (gameId: string, playerId: string) => {
  update(gameId, (g) => ({ ...g, initialDealerId: playerId }));
};

// ── Play mutations ──

export const setBid = (
  gameId: string,
  roundId: string,
  playerId: string,
  bid: number
) => {
  update(gameId, (g) => ({
    ...g,
    rounds: g.rounds.map((r) =>
      r.id === roundId
        ? {
            ...r,
            turns: [
              ...r.turns,
              { id: uid("gt"), playerId, bid, score: null },
            ],
          }
        : r
    ),
  }));
};

export const setScore = (gameId: string, turnId: string, score: number) => {
  update(gameId, (g) => ({
    ...g,
    rounds: g.rounds.map((r) => ({
      ...r,
      turns: r.turns.map((tt) => (tt.id === turnId ? { ...tt, score } : tt)),
    })),
  }));
};

export const clearScore = (gameId: string, turnId: string) => {
  update(gameId, (g) => ({
    ...g,
    rounds: g.rounds.map((r) => ({
      ...r,
      turns: r.turns.map((tt) =>
        tt.id === turnId ? { ...tt, score: null } : tt
      ),
    })),
  }));
};

export const deleteTurn = (gameId: string, turnId: string) => {
  update(gameId, (g) => ({
    ...g,
    rounds: g.rounds.map((r) => ({
      ...r,
      turns: r.turns.filter((tt) => tt.id !== turnId),
    })),
  }));
};
