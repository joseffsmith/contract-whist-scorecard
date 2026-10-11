import { selectGame, useConnectionStatus, useSyncView } from "../sync";

// Offline-first notes:
// The sync engine (src/sync) keeps a full local copy of the data and queues
// every write, so screens just read from the local view and never wait for
// the server. Only signing in/up, logging in and opening a game this phone
// has never seen need a connection.

export function useIsOffline() {
  return useConnectionStatus() === "offline";
}

// One game (with seats, rounds and turns) from the local copy.
export function useGame(gameId: string | undefined) {
  const { view, isLoading } = useSyncView();
  return { game: selectGame(view, gameId), isLoading };
}
