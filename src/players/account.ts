import { enqueueSnackbar } from "notistack";
import { useEffect, useRef, useState } from "react";
import { db } from "../db";
import { useIsOffline } from "../lib/offline";
import { mergePlayers } from "./merge";

// A phone that joined by QR is signed in as an Instant *guest* user. If that
// person later signs in with their email we want to keep their player:
// either the guest account is upgraded in place (same user id), or they land
// in a different (existing) account and we carry the guest player over.
const HANDOFF_KEY = "whist-guest-handoff";
type Handoff = { guestUserId: string; playerId: string };

const readHandoff = (): Handoff | null => {
  try {
    const raw = localStorage.getItem(HANDOFF_KEY);
    return raw ? (JSON.parse(raw) as Handoff) : null;
  } catch {
    return null;
  }
};
const writeHandoff = (h: Handoff | null) => {
  try {
    if (h) localStorage.setItem(HANDOFF_KEY, JSON.stringify(h));
    else localStorage.removeItem(HANDOFF_KEY);
  } catch {}
};

export async function claimPlayer(playerId: string, userId: string) {
  await db.transact([
    db.tx.players[playerId]
      .update({ claimedBy: userId })
      .link({ $user: userId }),
  ]);
}

// This phone's / account's own player. Looked up by the visible claimedBy
// marker, which also works offline from the local cache; the $user link
// (only resolvable by the server) covers players claimed before claimedBy
// existed, until the backfill below sets it.
export function useMyPlayer() {
  const { user, isLoading: authLoading } = db.useAuth();
  const byClaim = db.useQuery(
    user ? { players: { $: { where: { claimedBy: user.id } } } } : null
  );
  const byLink = db.useQuery(
    user ? { players: { $: { where: { $user: user.id } } } } : null
  );
  const candidates = [
    ...(byClaim.data?.players ?? []),
    ...(byLink.data?.players ?? []),
  ];
  const player = candidates.find((p) => !p.mergedInto) ?? candidates[0];
  const stillLooking = byClaim.isLoading || byLink.isLoading;
  return {
    user,
    player,
    isLoading: authLoading || (!!user && !player && stillLooking),
  };
}

// Keeps account ↔ player bookkeeping straight. Returns true while it's still
// sorting out a guest → email sign-in, so callers can hold off on asking
// "which player is you?".
export function useAccountReconcile(): boolean {
  const { user, player, isLoading } = useMyPlayer();
  const offline = useIsOffline();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const handoff = readHandoff();
  const pending = !!user && !user.isGuest && !!handoff;

  useEffect(() => {
    if (isLoading || !user || running.current) return;

    // Backfill the visible marker for players claimed before it existed.
    if (player && player.claimedBy !== user.id) {
      db.transact([db.tx.players[player.id].update({ claimedBy: user.id })]);
    }

    if (user.isGuest) {
      writeHandoff(
        player ? { guestUserId: user.id, playerId: player.id } : null
      );
      return;
    }

    const h = readHandoff();
    if (!h) return;
    // Carrying a guest player over needs the server; try again once online
    // rather than dropping the handoff.
    if (offline) return;
    if (h.guestUserId === user.id || player?.id === h.playerId) {
      writeHandoff(null); // upgraded in place
      return;
    }

    running.current = true;
    setBusy(true);
    (async () => {
      try {
        if (!player) {
          await db.transact([
            db.tx.players[h.playerId]
              .unlink({ $user: h.guestUserId })
              .link({ $user: user.id })
              .update({ claimedBy: user.id }),
          ]);
        } else {
          await mergePlayers(h.playerId, player.id, { allowClaimedFrom: true });
          enqueueSnackbar(
            "Moved your games from this phone onto your account",
            {
              variant: "success",
            }
          );
        }
      } catch (e) {
        enqueueSnackbar(
          `Couldn't move this phone's player onto your account: ${
            (e as Error).message
          }`,
          { variant: "error" }
        );
      } finally {
        writeHandoff(null);
        running.current = false;
        setBusy(false);
      }
    })();
  }, [user, player, isLoading, offline]);

  return pending || busy;
}
