import { id } from "@instantdb/react";
import { enqueueSnackbar } from "notistack";
import { db } from "../db";

export const addExistingPlayerToGame = async (
  gameId: string,
  player: { id: string; name: string },
  order: number
) => {
  const res = await db.transact([
    db.tx.playersOrders[id()]
      .update({ orderNumber: order })
      .link({ player: player.id, game: gameId }),
    // Re-save the name in the same transaction. Offline, InstantDB answers
    // each query from what that query has already seen plus pending writes;
    // without this, a player who'd never been in a game yet shows up as a
    // seat with no player on the (cached) games query until we're back online.
    db.tx.players[player.id].update({ name: player.name }),
  ]);
  if (res.status === "enqueued") {
    enqueueSnackbar("Player added", { variant: "success" });
  }
};
