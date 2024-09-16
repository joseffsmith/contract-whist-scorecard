import {
  Modal,
  ModalDialog,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Button,
} from "@mui/joy";
import { useState, useRef, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Player } from "../types";
import { tx } from "@instantdb/react";
import { db } from "..";
import { enqueueSnackbar, SnackbarContent, SnackbarProvider } from "notistack";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export const PlayerManager = ({
  player,
  isDealer,
}: {
  player: Player;
  isDealer: boolean;
}) => {
  const { gameId } = useParams();
  const [temp_name, setTempName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: playersOrdersData } = db.useQuery({
    playersOrders: {
      $: {
        where: {
          game: gameId!,
          player: player.id,
        },
      },
    },
  });

  const { data: turnsData } = db.useQuery({
    turns: {
      $: {
        where: {
          "round.game.id": gameId!,
        },
      },
    },
  });
  const canChangeDealer = turnsData?.turns.length === 0;

  useEffect(() => {
    setTempName(player.name);
  }, [player, setDialogOpen]);

  const handleClose = () => {
    setDialogOpen(false);
  };
  const handleSave = async () => {
    await db.transact([tx.players[player.id].update({ name: temp_name })]);
    handleClose();
  };
  const handleMakeDealer = async () => {
    if (!canChangeDealer) {
      enqueueSnackbar("Cannot change dealer if game has started", {
        variant: "error",
      });
      return;
    }
    await db.transact([
      tx.games[gameId!].update({ initialDealerId: player.id }),
    ]);
    handleClose();
  };
  const handleRemove = async () => {
    if (!playersOrdersData) {
      enqueueSnackbar("No data", { variant: "error" });
      return;
    }
    await db.transact([
      tx.playersOrders[playersOrdersData.playersOrders[0].id].delete(),
    ]);
  };

  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: player.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`${isDealer ? "bg-red-500" : ""} text-center text-xs`}
    >
      {dialogOpen ? (
        <Modal open onClose={handleClose}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            <ModalDialog>
              <DialogTitle>Player settings</DialogTitle>
              <FormControl>
                <FormLabel>Name</FormLabel>
                <Input
                  required
                  value={temp_name}
                  onChange={(e) => setTempName(e.target.value)}
                />
              </FormControl>
              <Button type="submit">Save name</Button>
              <Button variant="soft" onClick={handleMakeDealer}>
                Set as dealer
              </Button>
              <Button color="danger" variant="soft" onClick={handleRemove}>
                Remove player
              </Button>
            </ModalDialog>
          </form>
        </Modal>
      ) : (
        <button
          className="w-full h-full p-1 truncate"
          onClick={() => setDialogOpen(true)}
        >
          {player.name}
        </button>
      )}
    </div>
  );
};
