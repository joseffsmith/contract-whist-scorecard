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
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../db";
import {
  queryGameData,
  queryPlayersWithUserId,
  queryTurnsForGame,
} from "../queries";
import { goldButton, t } from "../theme/tokens";
import { Player, PlayersOrdersWithPlayers } from "../types";
import { addExistingPlayerToGame } from "../utils/addExistingPlayerToGame";
import { getDealerIdx } from "../utils/getDealerIdx";
import { ChoosePlayerOrCreate } from "./ChoosePlayerOrCreate";
import { Crumb } from "./chrome/Crumb";

export const GameManager = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const nav = useNavigate();
  const { user } = db.useAuth();
  const [addingOpen, setAddingOpen] = useState(false);

  const { isLoading, data } = db.useQuery(
    gameId ? queryGameData(gameId) : null
  );
  const { data: playerUser } = db.useQuery(
    user ? queryPlayersWithUserId(user.id) : null
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (isLoading || !data) {
    return (
      <>
        <Crumb trail={[{ label: "Home", to: "/" }, { label: "New game" }]} />
        <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>
      </>
    );
  }

  const game = data.games[0];
  const playerOrders = game.playersOrders;
  const playerOrdersInGame = [...playerOrders].sort(
    (a, b) => a.orderNumber - b.orderNumber
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const items = [...playerOrdersInGame];
    const oldIndex = items.findIndex((po) => po.id === active.id);
    const newIndex = items.findIndex((po) => po.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const [moved] = items.splice(oldIndex, 1);
    items.splice(newIndex, 0, moved);
    await db.transact(
      items.map((po, i) =>
        db.tx.playersOrders[po.id].update({ orderNumber: i })
      )
    );
  }

  let initialDealerIdx: number | null = playerOrdersInGame.findIndex(
    (po) => po.player?.id === game.initialDealerId
  );
  if (initialDealerIdx === -1) initialDealerIdx = null;
  const dealerIdx = getDealerIdx(null, playerOrders.length, initialDealerIdx);

  return (
    <>
      <Crumb trail={[{ label: "Home", to: "/" }, { label: "New game" }]} />
      <div style={{ flex: 1, overflow: "auto", padding: "16px 16px 16px" }}>
        <div
          style={{
            fontSize: 10,
            color: t.gold,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            fontWeight: 700,
            marginBottom: 10,
          }}
        >
          Players · {playerOrdersInGame.length}
        </div>

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
              const player = po.player;
              if (!player) return null;
              return (
                <PlayerRow
                  key={po.id}
                  isSelf={po.player?.id === playerUser?.players[0]?.id}
                  playerOrderId={po.id}
                  player={player}
                  isDealer={dealerIdx === idx}
                />
              );
            })}
          </SortableContext>
        </DndContext>

        {addingOpen ? (
          <div style={{ marginTop: 10 }}>
            <ChoosePlayerOrCreate
              createPlayer={async (name) => {
                const playerId = id();
                const res = await db.transact([
                  db.tx.players[playerId].update({ name }),
                  db.tx.playersOrders[id()]
                    .update({ orderNumber: playerOrdersInGame.length })
                    .link({ player: playerId, game: gameId! }),
                ]);
                if (res.status === "enqueued") {
                  enqueueSnackbar("Player added", { variant: "success" });
                }
                setAddingOpen(false);
              }}
              choosePlayer={async (pid) => {
                await addExistingPlayerToGame(
                  gameId!,
                  pid,
                  playerOrdersInGame.length
                );
                setAddingOpen(false);
              }}
              excludedPlayerIds={playerOrdersInGame.map((p) => p.player?.id)}
            />
            <button
              onClick={() => setAddingOpen(false)}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "10px",
                borderRadius: 8,
                border: `1px solid ${t.gold}33`,
                background: "transparent",
                color: t.gold,
                fontSize: 12,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontFamily: t.display,
                fontWeight: 600,
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingOpen(true)}
            style={{
              padding: 12,
              borderRadius: 10,
              marginTop: 8,
              border: `1px dashed ${t.gold}55`,
              color: t.gold,
              textAlign: "center",
              fontSize: 13,
              fontFamily: t.display,
              background: "transparent",
              width: "100%",
            }}
          >
            + Add player
          </button>
        )}
      </div>

      <div style={{ padding: "10px 16px 14px", borderTop: `1px solid ${t.gold}22` }}>
        <button
          disabled={playerOrdersInGame.length < 2}
          onClick={() => nav(`/games/${gameId}`)}
          style={{
            ...goldButton,
            width: "100%",
            borderRadius: 12,
            padding: "14px",
            fontSize: 16,
            opacity: playerOrdersInGame.length < 2 ? 0.5 : 1,
          }}
        >
          {playerOrdersInGame.length < 2
            ? "Minimum 2 players"
            : "Deal · start game →"}
        </button>
      </div>
    </>
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

  const remove = async () => {
    await db.transact([db.tx.playersOrders[playerOrderId].delete()]);
  };

  const makeDealer = async () => {
    if (!canChangeDealer) {
      enqueueSnackbar("Cannot change dealer once the game has started", {
        variant: "error",
      });
      return;
    }
    await db.transact([
      db.tx.games[gameId!].update({ initialDealerId: player.id }),
    ]);
  };

  const initials = (player.name ?? "")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        padding: "12px 14px",
        borderRadius: 10,
        marginBottom: 6,
        background: isDealer ? `${t.gold}18` : "rgba(0,0,0,0.22)",
        border: `1px solid ${isDealer ? t.gold + "55" : t.gold + "22"}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        {...listeners}
        {...attributes}
        style={{
          color: t.gold + "99",
          fontSize: 16,
          letterSpacing: "-0.1em",
          cursor: "grab",
          touchAction: "none",
        }}
      >
        ⋮⋮
      </div>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: t.feltDk,
          border: `1px solid ${t.gold}44`,
          color: t.gold,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: t.display,
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        {initials || "?"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: t.display,
            fontSize: 15,
            color: t.cream,
            fontWeight: 600,
          }}
        >
          {player.name}
        </div>
        {isDealer && (
          <div
            style={{
              fontSize: 10,
              color: t.gold,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            Dealer first
          </div>
        )}
      </div>
      {!isDealer && (
        <button
          onClick={makeDealer}
          style={{
            fontSize: 11,
            color: t.gold,
            opacity: 0.85,
            background: "transparent",
            border: "none",
          }}
        >
          Make dealer
        </button>
      )}
      {!isSelf && (
        <button
          onClick={remove}
          aria-label="Remove"
          style={{
            color: t.red,
            opacity: 0.8,
            background: "transparent",
            border: "none",
            fontSize: 18,
            padding: 4,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
};
