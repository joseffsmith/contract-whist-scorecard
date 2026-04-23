import { useEffect, useState } from "react";
import { GuestGame, getGame, listGames, subscribe } from "./guestStore";

// Deliberately NOT using useSyncExternalStore — listGames/getGame return
// fresh references per call (they JSON.parse localStorage), which causes
// React's snapshot-identity check to loop. useState + subscribe is simpler
// and tolerant of unstable snapshots.

export const useGuestGame = (id: string | undefined): GuestGame | undefined => {
  const [game, setGame] = useState<GuestGame | undefined>(() =>
    id ? getGame(id) : undefined
  );
  useEffect(() => {
    const refresh = () => setGame(id ? getGame(id) : undefined);
    refresh();
    return subscribe(refresh);
  }, [id]);
  return game;
};

export const useGuestGames = (): GuestGame[] => {
  const [games, setGames] = useState<GuestGame[]>(() =>
    listGames().filter((g) => !g.deletedAt)
  );
  useEffect(() => {
    const refresh = () =>
      setGames(listGames().filter((g) => !g.deletedAt));
    return subscribe(refresh);
  }, []);
  return games;
};
