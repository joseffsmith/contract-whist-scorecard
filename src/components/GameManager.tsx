import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
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
import { id } from "@instantdb/react";
import Delete from "@mui/icons-material/Delete";
import DragHandle from "@mui/icons-material/DragHandle";
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemContent,
  ListItemDecorator,
} from "@mui/joy";
import { enqueueSnackbar } from "notistack";
import { Link, useParams } from "react-router-dom";
import { db } from "../db";
import {
  queryGameData,
  queryPlayersWithUserId,
  queryTurnsForGame,
} from "../queries";
import { Player, PlayersOrdersWithPlayers } from "../types";
import { addExistingPlayerToGame } from "../utils/addExistingPlayerToGame";
import { getDealerIdx } from "../utils/getDealerIdx";
import { ChoosePlayerOrCreate } from "./ChoosePlayerOrCreate";

export const GameManager = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const { user } = db.useAuth();

  const { isLoading, error, data } = db.useQuery(
    gameId ? queryGameData(gameId) : null
  );

  const { isLoading: isLoadingMyUser, data: playerUser } = db.useQuery(
    user ? queryPlayersWithUserId(user.id) : null
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const playerOrdersInGame = Object.values(
    data?.games[0].playersOrders ?? {}
  ).sort((apo, bpo) => apo.orderNumber - bpo.orderNumber);

  if (isLoading || !data) {
    return <div className="text-gray-900 dark:text-gray-100 p-4">Loading...</div>;
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
        db.tx.playersOrders[po.id].update({ orderNumber: index })
      );

      // Perform the updates in a transaction
      await db.transact(updates);
    }
  }

  let initialDealerIdx: number | null = playerOrdersInGame.findIndex(
    (po) => po.player?.id === game.initialDealerId
  );
  if (initialDealerIdx === -1) {
    initialDealerIdx = null;
  }

  const dealerIdx = getDealerIdx(null, playerOrders.length, initialDealerIdx);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        rowGap: 1,
        px: 2,
        mt: 2,
      }}
    >
      <Box>
        <Box display={"flex"} alignItems={"flex-start"} columnGap={4}>
          <AddPlayerInput playersInGame={playerOrdersInGame} />
        </Box>
        <List
          size="md"
          sx={{ flexGrow: 0, overflow: "auto", maxHeight: "60vh" }}
        >
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
                const player = po.player;
                if (!player) {
                  return null;
                }
                return (
                  <PlayerRow
                    isSelf={po.player?.id === playerUser?.players[0].id}
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
      </Box>
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
  isSelf,
  playerOrderId,
  player,
  isDealer,
}: {
  isSelf: boolean;
  playerOrderId: string;
  player: Player;
  isDealer: boolean;
}) => {
  const { gameId } = useParams<{ gameId: string }>();
  const { user } = db.useAuth();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: playerOrderId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const { data: turnsData } = db.useQuery(
    gameId ? queryTurnsForGame(gameId) : null
  );
  const canChangeDealer = turnsData?.turns.length === 0;

  const handleRemove = async () => {
    await db.transact([db.tx.playersOrders[playerOrderId].delete()]);
  };

  const handleMakeDealer = async (playerId: string) => {
    if (!canChangeDealer) {
      enqueueSnackbar("Cannot change dealer if game has started", {
        variant: "error",
      });
      return;
    }

    await db.transact([
      db.tx.games[gameId!].update({ initialDealerId: playerId }),
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
            disabled={isSelf}
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
  playersInGame,
}: {
  playersInGame: PlayersOrdersWithPlayers[];
}) => {
  const { gameId } = useParams<{ gameId: string }>();

  const addNewPlayerToGame = async (name: string) => {
    const playerId = id();
    const res = await db.transact([
      db.tx.players[playerId].update({ name }),
      db.tx.playersOrders[id()]
        .update({ orderNumber: playersInGame?.length ?? 0 })
        .link({ player: playerId, game: gameId! }),
    ]);
    if (res.status === "enqueued") {
      enqueueSnackbar("Player added", { variant: "success" });
    }
  };

  return (
    <ChoosePlayerOrCreate
      createPlayer={addNewPlayerToGame}
      choosePlayer={(playerId) =>
        addExistingPlayerToGame(gameId!, playerId, playersInGame.length)
      }
      excludedPlayerIds={playersInGame.map((p) => p.player?.id)}
    />
  );
};
