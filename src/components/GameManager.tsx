import { Link, useParams } from "react-router-dom";
import Delete from "@mui/icons-material/Delete";
import DragHandle from "@mui/icons-material/DragHandle";
import { db } from "..";
import {
  List,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  ListItemContent,
  Typography,
  IconButton,
  Chip,
  Button,
  Box,
  Autocomplete,
  AutocompleteOption,
  FormControl,
} from "@mui/joy";
import { Player, PlayersOrders } from "../types";
import { getDealerIdx } from "../utils/getDealerIdx";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { enqueueSnackbar } from "notistack";
import { id, tx } from "@instantdb/react";
import { useMemo, useState } from "react";

export const GameManager = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const [type, settype] = useState<"existing" | "new">("existing");
  const query = {
    games: {
      playersOrders: {
        player: {},
      },
      $: {
        where: {
          id: gameId,
        },
      },
    },
  };

  const { isLoading, error, data } = db.useQuery(query);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const playerOrdersInGame: PlayersOrders[] = (
    Object.values(data?.games[0]?.playersOrders ?? {}) as PlayersOrders[]
  ).sort((apo, bpo) => apo.orderNumber - bpo.orderNumber);

  console.table(playerOrdersInGame);

  if (isLoading || !data) {
    return <div>Loading...</div>;
  }

  const game = data.games[0];
  const playerOrders = game.playersOrders;

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (active.id !== over?.id) {
      // Create a copy of the current list of items sorted by orderNumber
      const items = [...playerOrdersInGame]; // Make a shallow copy
      // Find the indices of the active and over items
      const oldIndex = items.findIndex((po) => po.id === active.id);
      const newIndex = items.findIndex((po) => po.id === over?.id);

      if (oldIndex === -1 || newIndex === -1) {
        enqueueSnackbar("Error changing order", { variant: "error" });
        return;
      }

      // Remove the item from the old index
      const [movedItem] = items.splice(oldIndex, 1);
      // Insert the item at the new index
      items.splice(newIndex, 0, movedItem);

      // Update the orderNumber of all items to match their new positions
      const updates = items.map((po, index) =>
        tx.playersOrders[po.id].update({ orderNumber: index })
      );

      // Perform the updates in a transaction
      await db.transact(updates);
    }
  }

  let initialDealerIdx: number | null = playerOrdersInGame.findIndex(
    (po) => po.player?.[0]?.id === game.initialDealerId
  );
  if (initialDealerIdx === -1) {
    initialDealerIdx = null;
  }

  const dealerIdx = getDealerIdx(null, playerOrders.length, initialDealerIdx);

  return (
    <Box
      sx={{
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "start",
        rowGap: 1,
        px: 2,
        mt: 2,
      }}
    >
      <Box display={"flex"} alignItems={"flex-start"} columnGap={4}>
        <AddPlayerInput
          playerOrdersInGame={playerOrdersInGame.flatMap((p) => p.player)}
        />
      </Box>
      {/* <Typography level="title-sm">Players: </Typography> */}
      <List size="lg" sx={{ flexGrow: 0 }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={playerOrdersInGame.map((po) => po.id)}
            strategy={verticalListSortingStrategy}
          >
            {playerOrdersInGame.map((po, idx) => {
              const isDealer = dealerIdx === idx;
              const player = po.player[0];
              if (!player) {
                return null;
              }
              return (
                <PlayerRow
                  playerOrderId={po.id}
                  key={po.id}
                  player={player}
                  isDealer={isDealer}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </List>

      <Box flexGrow={1} />
      <Button
        size="lg"
        component={Link}
        to=".."
        relative="path"
        disabled={playerOrdersInGame.length < 2}
      >
        {playerOrdersInGame.length < 2 ? "Minimum 2 players" : "Play"}
      </Button>
    </Box>
  );
};

const PlayerRow = ({
  playerOrderId,
  player,
  isDealer,
}: {
  playerOrderId: string;
  player: Player;
  isDealer: boolean;
}) => {
  const { gameId } = useParams<{ gameId: string }>();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: playerOrderId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

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

  const handleRemove = async () => {
    await db.transact([tx.playersOrders[playerOrderId].delete()]);
  };

  const handleMakeDealer = async (playerId: string) => {
    if (!canChangeDealer) {
      enqueueSnackbar("Cannot change dealer if game has started", {
        variant: "error",
      });
      return;
    }
    await db.transact([
      tx.games[gameId!].update({ initialDealerId: playerId }),
    ]);
  };

  return (
    <ListItem
      key={player.id}
      style={style}
      ref={setNodeRef}
      endAction={
        <>
          {isDealer ? (
            <Chip color="primary" variant="soft">
              Starting dealer
            </Chip>
          ) : (
            <Button
              color="primary"
              variant="plain"
              onClick={() => handleMakeDealer(player.id)}
            >
              Make dealer
            </Button>
          )}
          <IconButton
            aria-label="Delete"
            size="sm"
            color="danger"
            variant="plain"
            onClick={handleRemove}
          >
            <Delete />
          </IconButton>
        </>
      }
    >
      <ListItemDecorator
        {...listeners}
        {...attributes}
        sx={{ touchAction: "none" }}
      >
        <DragHandle />
      </ListItemDecorator>
      <ListItemContent>{player.name}</ListItemContent>
    </ListItem>
  );
};

const AddPlayerInput = ({
  playerOrdersInGame,
}: {
  playerOrdersInGame: Player[];
}) => {
  const {
    data: allPlayers,
    isLoading: isLoadingAllPlayers,
    error: errorPlayers,
  } = db.useQuery({
    players: {},
  });

  const { gameId } = useParams<{ gameId: string }>();
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [inputValue, setInputValue] = useState("");

  const handleChange = (
    event,
    newValue: Player | null | string,
    reason,
    details
  ) => {
    if (typeof newValue === "string") {
      throw Error("Not implemented");
    }
    setSelectedPlayer(newValue);
  };

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
      enqueueSnackbar("Player added", { variant: "success" });
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
      enqueueSnackbar("Player added", { variant: "success" });
    }
  };

  const handleAddPlayer = async (type: "new" | "existing") => {
    if (type === "new") {
      if (!inputValue.length) {
        enqueueSnackbar("Name is required", { variant: "error" });
        return;
      }

      await addNewPlayerToGame(inputValue, playerOrdersInGame?.length ?? 0);
      setInputValue("");
      return;
    }

    if (!selectedPlayer) {
      enqueueSnackbar("Player is required", { variant: "error" });
      return;
    }
    await addExistingPlayerToGame(
      selectedPlayer.id,
      playerOrdersInGame?.length ?? 0
    );
    setSelectedPlayer(null);
  };

  const options =
    allPlayers?.players
      .filter((p) => !playerOrdersInGame.map((p) => p.id).includes(p.id))
      .map(
        (p) =>
          ({
            id: p.id,
            name: p.name as any,
          } as Player)
      ) ?? [];

  const hasOptions = !!options.find(
    (o) => o.name.trim().toLowerCase() === inputValue.trim().toLowerCase()
  );

  return (
    <FormControl sx={{ flexGrow: 1 }}>
      <Typography>Type to create or choose existing</Typography>
      <Autocomplete<Player, false, true, true>
        size="lg"
        freeSolo
        disableClearable
        handleHomeEndKeys
        autoFocus
        value={selectedPlayer ?? ""}
        onChange={handleChange}
        onInputChange={(event, newInputValue) => {
          setInputValue(newInputValue);
        }}
        endDecorator={
          !hasOptions && inputValue ? (
            <Button onClick={() => handleAddPlayer("new")}>Create</Button>
          ) : selectedPlayer ? (
            <Button onClick={() => handleAddPlayer("existing")}>Add</Button>
          ) : null
        }
        isOptionEqualToValue={(o, v) => o.id === v.id}
        options={options}
        getOptionLabel={(option) => {
          if (typeof option === "string") {
            return option;
          }
          return option.name;
        }}
        renderOption={(props, option) => (
          <AutocompleteOption {...props} key={option.id}>
            {option.name}
          </AutocompleteOption>
        )}
      />
    </FormControl>
  );
};
