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
  const { data } = db.useQuery({
    playersOrders: {
      $: {
        where: {
          game: gameId!,
          player: player.id,
        },
      },
    },
  });

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
  const handleMakeDealer = () => {
    handleClose();
  };
  const handleRemove = async () => {
    if (!data) {
      enqueueSnackbar("No data", { variant: "error" });
      return;
    }
    await db.transact([tx.playersOrders[data.playersOrders[0].id].delete()]);
  };

  return (
    <div className={`${isDealer ? "bg-red-500" : ""} text-center text-xs`}>
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
