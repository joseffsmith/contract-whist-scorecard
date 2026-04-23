import { useSyncExternalStore } from "react";
import { GuestGame, getGame, listGames, subscribe } from "./guestStore";

export const useGuestGame = (id: string | undefined): GuestGame | undefined => {
  return useSyncExternalStore(
    subscribe,
    () => (id ? getGame(id) : undefined),
    () => undefined
  );
};

export const useGuestGames = (): GuestGame[] => {
  return useSyncExternalStore(
    subscribe,
    () => listGames().filter((g) => !g.deletedAt),
    () => []
  );
};
