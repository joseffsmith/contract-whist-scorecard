import { useEffect, useState } from "react";
import { db } from "../db";
import { queryPlayerDirectory } from "../players/directory";
import { queryHomeGames } from "../queries";

// Offline-first notes:
// InstantDB keeps the results of queries it has already run (in IndexedDB)
// and applies changes made offline on top of them, but it can't answer a
// query it has never seen until it reaches the server. So screens read from
// a few broad queries that are always subscribed (see useWarmOfflineCache)
// instead of asking for one game by id.

export function useIsOffline() {
  const status = db.useConnectionStatus();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return !online || status === "closed" || status === "errored";
}

// All games with seats, rounds and turns. Also used by Home, the games list
// and the leaderboard, so it's almost always cached.
export function useGame(gameId: string | undefined) {
  const { data, isLoading, error } = db.useQuery(queryHomeGames);
  const game = gameId ? data?.games.find((g) => g.id === gameId) : undefined;
  return { game, isLoading, error };
}

// Keep the broad queries subscribed from the app shell so they're cached
// (and kept fresh) for when there's no signal.
export function useWarmOfflineCache() {
  db.useQuery(queryHomeGames);
  db.useQuery(queryPlayerDirectory);
}

export const OFFLINE_MESSAGE = "You're offline. This needs a connection.";

// Server round-trips (db.queryOnce) can't be answered offline and may hang
// on a dead connection, so fail fast with a clear message instead.
export async function online<T>(promise: () => Promise<T>, ms = 10000) {
  if (!navigator.onLine) throw new Error(OFFLINE_MESSAGE);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("Couldn't reach the server. Check your signal.")),
          ms
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
