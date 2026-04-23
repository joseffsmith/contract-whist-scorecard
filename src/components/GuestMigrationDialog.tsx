import { id } from "@instantdb/react";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { db } from "../db";
import { clearAll, GuestGame } from "../guest/guestStore";
import { queryAllPlayers } from "../queries";
import { goldButton, t } from "../theme/tokens";
import { Shell } from "./chrome/Shell";

type Player = { id: string; name: string };

export const GuestMigrationDialog = ({
  userId,
  games,
  onDone,
}: {
  userId: string;
  games: GuestGame[];
  onDone: () => void;
}) => {
  const { data: playersData } = db.useQuery(queryAllPlayers);
  const allPlayers: Player[] = playersData?.players ?? [];
  const [busy, setBusy] = useState(false);

  const findOrMint = (name: string, txs: any[]): string => {
    const needle = name.trim().toLowerCase();
    const match = allPlayers.find(
      (p) => p.name.trim().toLowerCase() === needle
    );
    if (match) return match.id;
    const newId = id();
    txs.push(db.tx.players[newId].update({ name: name.trim() }));
    return newId;
  };

  const migrate = async () => {
    setBusy(true);
    try {
      const txs: any[] = [];
      for (const game of games) {
        // Build a name→cloud-player-id map for this game's players.
        const mappedIds = game.players.map((gp) => findOrMint(gp.name, txs));
        const initialDealerCloudId =
          game.initialDealerId
            ? mappedIds[
                game.players.findIndex(
                  (p) => p.id === game.initialDealerId
                )
              ] ?? null
            : null;

        const newGameId = id();
        txs.push(
          db.tx.games[newGameId].update({
            createdAt: game.createdAt,
            createdBy: userId,
            initialDealerId: initialDealerCloudId ?? undefined,
          })
        );
        // playersOrders
        for (let i = 0; i < mappedIds.length; i++) {
          txs.push(
            db.tx.playersOrders[id()]
              .update({ orderNumber: i })
              .link({ player: mappedIds[i], game: newGameId })
          );
        }
        // rounds + turns
        for (const round of game.rounds) {
          const newRoundId = id();
          txs.push(
            db.tx.rounds[newRoundId]
              .update({ roundNumber: round.roundNumber })
              .link({ game: newGameId })
          );
          for (const turn of round.turns) {
            const cloudPlayerId =
              mappedIds[
                game.players.findIndex((p) => p.id === turn.playerId)
              ];
            if (!cloudPlayerId) continue;
            const payload: { bid?: number; score?: number } = {};
            if (turn.bid !== null) payload.bid = turn.bid;
            if (turn.score !== null) payload.score = turn.score;
            txs.push(
              db.tx.turns[id()]
                .update(payload)
                .link({ round: newRoundId, player: cloudPlayerId })
            );
          }
        }
      }
      await db.transact(txs);
      clearAll();
      enqueueSnackbar(
        `Migrated ${games.length} guest game${games.length === 1 ? "" : "s"}`,
        { variant: "success" }
      );
      onDone();
    } catch (err) {
      console.error(err);
      enqueueSnackbar("Migration failed — your guest games were not touched", {
        variant: "error",
      });
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
          Welcome back
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
          You played {games.length} guest game
          {games.length === 1 ? "" : "s"}
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
          Save them to your account, or discard and start fresh.
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
                  background: "rgba(0,0,0,0.25)",
                  border: `1px solid ${t.gold}22`,
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
          {busy ? "Saving…" : "Save to my account"}
        </button>
        <button
          onClick={discard}
          disabled={busy}
          style={{
            width: "100%",
            padding: "12px 0",
            borderRadius: 12,
            background: "transparent",
            border: `1px solid ${t.cream}22`,
            color: t.cream,
            opacity: 0.6,
            fontSize: 13,
            fontFamily: t.display,
            fontWeight: 500,
          }}
        >
          Discard guest games
        </button>
      </div>
    </Shell>
  );
};
