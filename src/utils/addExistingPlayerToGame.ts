import { enqueueSnackbar } from "notistack";
import { act, newId } from "../lib/dispatch";
import { sync } from "../sync";

// Order number for a new seat: after the last one (seats can have gaps once
// someone has been removed).
export const nextSeatOrder = (seats: { orderNumber: number }[]) =>
  Math.max(-1, ...seats.map((s) => s.orderNumber)) + 1;

export const addExistingPlayerToGame = async (
  gameId: string,
  playerId: string,
  order: number
) => {
  const ok = await act("addSeat", {
    seatId: newId(),
    gameId,
    playerId,
    orderNumber: order,
  });
  if (ok && sync.getStatus() === "offline") {
    enqueueSnackbar("Player added", { variant: "success" });
  }
  return ok;
};
