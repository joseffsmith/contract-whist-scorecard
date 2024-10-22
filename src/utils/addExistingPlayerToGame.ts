import { tx, id } from "@instantdb/react";
import { enqueueSnackbar } from "notistack";
import { db } from "..";

export const addExistingPlayerToGame = async (
  gameId: string,
  playerId: string,
  order: number
) => {
  const res = await db.transact([
    tx.playersOrders[id()]
      .update({ orderNumber: order })
      .link({ player: playerId, game: gameId! }),
  ]);
  if (res.status === "enqueued") {
    enqueueSnackbar("Player added", { variant: "success" });
  }
};
