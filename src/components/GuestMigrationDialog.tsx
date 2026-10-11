import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import type { RoundRow, SeatRow, TurnRow } from "../../shared/types";
import {
  clearAll,
  deleteGame as deleteGuestGame,
  GuestGame,
} from "../guest/guestStore";
import { newId } from "../lib/dispatch";
import {
  selectActivePlayers,
  selectPlayersByClaim,
  sync,
  useSyncView,
} from "../sync";
import { alpha, goldButton, t } from "../theme/tokens";
import { Shell } from "./chrome/Shell";

export const GuestMigrationDialog = ({
  userId,
  games,
  onDone,
  onClose,
}: {
  userId: string;
  games: GuestGame[];
  onDone: () => void;
  // "Not now": leaves the games where they are.
  onClose?: () => void;
}) => {
  const { view } = useSyncView();
  const [busy, setBusy] = useState(false);

  const migrate = async () => {
    setBusy(true);
    // Players matched by name (case-insensitive) onto existing ones; names
    // nobody has used yet become new players. Remembered across games so a
    // new name is only created once.
    const known = new Map<string, string>();
    for (const p of selectActivePlayers(view)) {
      const key = p.name.trim().toLowerCase();
      if (!known.has(key)) known.set(key, p.id);
    }
    // Your own player wins a name clash with someone else's.
    for (const p of selectPlayersByClaim(view, userId)) {
      known.set(p.name.trim().toLowerCase(), p.id);
    }
    const saved: GuestGame[] = [];
    try {
      for (const game of games) {
        const newPlayers: { id: string; name: string }[] = [];
        const mappedIds = game.players.map((gp) => {
          const key = gp.name.trim().toLowerCase();
          let playerId = known.get(key);
          if (!playerId) {
            playerId = newId();
            known.set(key, playerId);
            newPlayers.push({ id: playerId, name: gp.name.trim() });
          }
          return playerId;
        });
        const dealerIdx = game.players.findIndex(
          (p) => p.id === game.initialDealerId
        );

        const gameId = newId();
        const seats: SeatRow[] = mappedIds.map((playerId, i) => ({
          id: newId(),
          gameId,
          playerId,
          orderNumber: i,
        }));
        const rounds: RoundRow[] = [];
        const turns: TurnRow[] = [];
        for (const round of game.rounds) {
          const roundId = newId();
          rounds.push({ id: roundId, gameId, roundNumber: round.roundNumber });
          for (const turn of round.turns) {
            const playerId =
              mappedIds[game.players.findIndex((p) => p.id === turn.playerId)];
            if (!playerId) continue;
            turns.push({
              id: newId(),
              roundId,
              playerId,
              bid: turn.bid,
              score: turn.score,
            });
          }
        }

        await sync.dispatch("importGame", {
          game: {
            id: gameId,
            createdAt: game.createdAt,
            createdBy: userId,
            initialDealerId: dealerIdx >= 0 ? mappedIds[dealerIdx] : null,
          },
          newPlayers,
          seats,
          rounds,
          turns,
        });
        saved.push(game);
      }
      clearAll();
      enqueueSnackbar(
        `Migrated ${games.length} guest game${games.length === 1 ? "" : "s"}`,
        { variant: "success" }
      );
      onDone();
    } catch (err) {
      console.error(err);
      // Don't offer the ones that did make it again.
      saved.forEach((g) => deleteGuestGame(g.id));
      enqueueSnackbar(
        `Couldn't save every guest game: ${(err as Error).message}`,
        { variant: "error" }
      );
      setBusy(false);
    }
  };

  const discard = () => {
    clearAll();
    onDone();
  };

  return (
    <Shell>
      <div
        style={{
          flex: 1,
          padding: "40px 24px 24px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: t.gold,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            textAlign: "center",
            fontWeight: 600,
          }}
        >
          Saved on this phone
        </div>
        <div
          style={{
            fontFamily: t.display,
            fontSize: 28,
            fontWeight: 600,
            color: t.cream,
            textAlign: "center",
            marginTop: 6,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          {games.length} game{games.length === 1 ? "" : "s"} only on this phone
        </div>
        <div
          style={{
            fontSize: 13,
            color: t.cream,
            opacity: 0.7,
            textAlign: "center",
            marginTop: 10,
            marginBottom: 20,
          }}
        >
          Save {games.length === 1 ? "it" : "them"} so everyone can see{" "}
          {games.length === 1 ? "it" : "them"}, or discard and start fresh.
        </div>

        <div style={{ flex: 1, overflow: "auto", marginBottom: 16 }}>
          {games.map((g) => {
            const date = new Date(g.createdAt).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
            });
            return (
              <div
                key={g.id}
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  marginBottom: 6,
                  background: alpha(t.shade, 0.25),
                  border: `1px solid ${alpha(t.gold, 0.13)}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      fontFamily: t.display,
                      fontSize: 14,
                      color: t.cream,
                      fontWeight: 600,
                    }}
                  >
                    {date}
                  </div>
                  <div style={{ fontSize: 10, color: t.cream, opacity: 0.5 }}>
                    {g.players.length} player
                    {g.players.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: t.cream,
                    opacity: 0.65,
                  }}
                >
                  {g.players.map((p) => p.name).join(" · ") || "(empty)"}
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={migrate}
          disabled={busy}
          style={{
            ...goldButton,
            width: "100%",
            padding: "14px 0",
            borderRadius: 12,
            fontSize: 15,
            marginBottom: 8,
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "Saving…" : "Save games"}
        </button>
        <button
          onClick={discard}
          disabled={busy}
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: 12,
            background: "transparent",
            border: `1px solid ${alpha(t.cream, 0.13)}`,
            color: t.cream,
            opacity: 0.6,
            fontSize: 13,
            fontFamily: t.display,
            fontWeight: 500,
          }}
        >
          Discard local games
        </button>
        {onClose && (
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              width: "100%",
              marginTop: 8,
              padding: "10px 0",
              background: "transparent",
              border: "none",
              color: t.gold,
              fontSize: 13,
            }}
          >
            Not now
          </button>
        )}
      </div>
    </Shell>
  );
};
