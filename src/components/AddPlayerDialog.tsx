import { tx, id } from "@instantdb/react";
import {
  Modal,
  ModalDialog,
  DialogTitle,
  DialogContent,
  RadioGroup,
  Radio,
  Input,
  Autocomplete,
  DialogActions,
  Button,
  Menu,
  MenuItem,
  ListItem,
  AutocompleteOption,
} from "@mui/joy";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { db } from "..";
import { Player } from "../types";

export const AddPlayerDialog = ({ onClose }: { onClose: () => void }) => {
  const { gameId } = useParams();
  const [type, settype] = useState<"existing" | "new">("existing");
  const [playerName, setPlayerName] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const {
    data: allPlayers,
    isLoading,
    error,
  } = db.useQuery({
    players: {},
  });
  const {
    data: playersInGame,
    isLoading: isLoading2,
    error: error2,
  } = db.useQuery({
    players: {
      $: {
        where: {
          "playersOrders.game.id": gameId!,
        },
      },
    },
  });

  const psInGame = playersInGame?.players.map((p) => p.id);

  const addExistingPlayerToGame = async (
    playerId: string,
    orderNumber: number
  ) => {
    const res = await db.transact([
      tx.playersOrders[id()]
        .update({ orderNumber })
        .link({ player: playerId, game: gameId! }),
    ]);
    if (res.status === "enqueued") {
      enqueueSnackbar("Player enqueued (linked)", { variant: "success" });
    }
  };

  const addNewPlayerToGame = async (name: string, orderNumber: number) => {
    const playerId = id();
    const res = await db.transact([
      tx.players[playerId].update({ name }),
      tx.playersOrders[id()]
        .update({ orderNumber })
        .link({ player: playerId, game: gameId! }),
    ]);
    if (res.status === "enqueued") {
      enqueueSnackbar("Player enqueued", { variant: "success" });
    }
  };

  const handleAddPlayer = () => {
    if (type === "new") {
      if (!playerName.length) {
        enqueueSnackbar("Name is required", { variant: "error" });
        return;
      }

      const res = addNewPlayerToGame(playerName, psInGame?.length ?? 0);
      setPlayerName("");
      return;
    }
    if (!selectedPlayer) {
      enqueueSnackbar("Player is required", { variant: "error" });
      return;
    }
    const res = addExistingPlayerToGame(
      selectedPlayer.id,
      psInGame?.length ?? 0
    );
    setSelectedPlayer(null);
  };
  return (
    <Modal component={"div"} open onClose={onClose}>
      <ModalDialog>
        <DialogTitle>Add player</DialogTitle>
        <DialogContent>
          <RadioGroup
            value={type}
            onChange={(e) => settype(e.target.value as any)}
          >
            <Radio id={"false"} value={"existing"} label="Existing Player" />
            <Radio id={"true"} value={"new"} label="New Player" />
          </RadioGroup>

          {type === "new" ? (
            <Input
              value={playerName}
              autoFocus
              onChange={(e) => setPlayerName(e.target.value)}
            />
          ) : (
            <Autocomplete<Player>
              autoFocus
              value={selectedPlayer}
              onChange={(e, val) => setSelectedPlayer(val)}
              isOptionEqualToValue={(o, v) => o.id === v.id}
              options={
                allPlayers?.players
                  .filter((p) => !psInGame?.includes(p.id))
                  .map(
                    (p) =>
                      ({
                        id: p.id,
                        name: p.name as any,
                      } as Player)
                  ) ?? []
              }
              getOptionLabel={(o) => o.name}
              renderOption={(props, option) => (
                <AutocompleteOption {...props} {...option} key={option.id}>
                  {option.name}
                </AutocompleteOption>
              )}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleAddPlayer}>Add player</Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
};
