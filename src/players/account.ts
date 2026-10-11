import { selectPlayersByClaim, sync, useAuth, useSyncView } from "../sync";

// Mark a player as this account's own ("that's me"). Rejects with the rule's
// message if it's already someone else's.
export const claimPlayer = (playerId: string) =>
  sync.dispatch("claimPlayer", { playerId });

// This phone's / account's own player: the first one the signed-in user has
// claimed (and that hasn't been merged away). Read from the local copy, so
// it works offline.
export function useMyPlayer() {
  const { user, isLoading: authLoading } = useAuth();
  const { view, isLoading: dataLoading } = useSyncView();
  const player = user ? selectPlayersByClaim(view, user.id)[0] : undefined;
  return {
    user,
    player,
    isLoading: authLoading || (!!user && !player && dataLoading),
  };
}
