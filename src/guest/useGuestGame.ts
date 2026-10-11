import { useEffect, useState } from "react";
import {
  GUEST_GAMES_KEY,
  GuestGame,
  getGame,
  listGames,
  subscribe,
} from "./guestStore";

// Deliberately NOT using useSyncExternalStore — listGames/getGame return
// fresh references per call (they JSON.parse localStorage), which causes
// React's snapshot-identity check to loop. useState + subscribe is simpler
// and tolerant of unstable snapshots.

// Other tabs write to the same localStorage; the `storage` event tells us.
const onOtherTabs = (refresh: () => void) => {
  const handler = (e: StorageEvent) => {
    if (e.key === null || e.key === GUEST_GAMES_KEY) refresh();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
};

export const useGuestGame = (id: string | undefined): GuestGame | undefined => {
  const [game, setGame] = useState<GuestGame | undefined>(() =>
    id ? getGame(id) : undefined
  );
  useEffect(() => {
    const refresh = () => setGame(id ? getGame(id) : undefined);
    refresh();
    const stopOthers = onOtherTabs(refresh);
    const stop = subscribe(refresh);
    return () => {
      stop();
      stopOthers();
    };
  }, [id]);
  return game;
};

export const useGuestGames = (): GuestGame[] => {
  const [games, setGames] = useState<GuestGame[]>(() =>
    listGames().filter((g) => !g.deletedAt)
  );
  useEffect(() => {
    const refresh = () => setGames(listGames().filter((g) => !g.deletedAt));
    const stopOthers = onOtherTabs(refresh);
    const stop = subscribe(refresh);
    return () => {
      stop();
      stopOthers();
    };
  }, []);
  return games;
};
