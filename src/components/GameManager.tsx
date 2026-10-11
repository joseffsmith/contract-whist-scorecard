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
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { act, newId } from "../lib/dispatch";
import { useGame } from "../lib/offline";
import { useMyPlayer } from "../players/account";
import { useAuth, useConnectionStatus } from "../sync";
import { alpha, goldButton, t } from "../theme/tokens";
import { Player, PlayersOrdersWithPlayers } from "../types";
import {
  addExistingPlayerToGame,
  nextSeatOrder,
} from "../utils/addExistingPlayerToGame";
import { getDealerIdx } from "../utils/getDealerIdx";
import { ChoosePlayerOrCreate } from "./ChoosePlayerOrCreate";
import { Crumb } from "./chrome/Crumb";
import { InviteSheet } from "./InviteSheet";

export const GameManager = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const nav = useNavigate();
  const [addingOpen, setAddingOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { user } = useAuth();
  const connecting = useConnectionStatus() === "connecting";
  const { isLoading, game } = useGame(gameId);
  const { player: myPlayer } = useMyPlayer();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (isLoading || !game) {
    return (
      <>
        <Crumb trail={[{ label: "Home", to: "/" }, { label: "New game" }]} />
        <div style={{ padding: 20, opacity: 0.6 }}>
          {isLoading || connecting ? "Loading…" : "Game not found."}
        </div>
      </>
    );
  }

  // Only the host (or the app admin) can change who's playing.
  const canManage = user?.id === game.createdBy || !!user?.isAdmin;
  const playerOrders = game.playersOrders;
  const hasStarted = game.rounds.some((r) => r.turns.length > 0);
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
    await act("reorderSeats", {
      gameId: gameId!,
      seatIds: items.map((po) => po.id),
    });
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
                  isSelf={po.player?.id === myPlayer?.id}
                  playerOrderId={po.id}
                  player={player}
                  isDealer={dealerIdx === idx}
                  canChangeDealer={!hasStarted}
                  readOnly={!canManage}
                />
              );
            })}
          </SortableContext>
        </DndContext>

        {!canManage && (
          <div
            style={{
              marginTop: 10,
              fontSize: 13,
              color: t.cream,
              opacity: 0.65,
              textAlign: "center",
            }}
          >
            Only the host can change players.
          </div>
        )}

        {canManage && addingOpen ? (
          <div style={{ marginTop: 10 }}>
            <ChoosePlayerOrCreate
              createPlayer={async (name) => {
                const playerId = newId();
                if (!(await act("createPlayer", { playerId, name }))) return;
                await addExistingPlayerToGame(
                  gameId!,
                  playerId,
                  nextSeatOrder(playerOrdersInGame)
                );
                setAddingOpen(false);
              }}
              choosePlayer={async (player) => {
                await addExistingPlayerToGame(
                  gameId!,
                  player.id,
                  nextSeatOrder(playerOrdersInGame)
                );
                setAddingOpen(false);
              }}
              excludedPlayerIds={playerOrdersInGame.map((p) => p.player?.id)}
              contextPlayerIds={[
                ...playerOrdersInGame.map((p) => p.player?.id),
                myPlayer?.id,
              ]}
            />
            <button
              onClick={() => setAddingOpen(false)}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "10px",
                borderRadius: 8,
                border: `1px solid ${alpha(t.gold, 0.2)}`,
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
        ) : canManage ? (
          <button
            onClick={() => setAddingOpen(true)}
            style={{
              padding: 12,
              borderRadius: 10,
              marginTop: 8,
              border: `1px dashed ${alpha(t.gold, 0.33)}`,
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
        ) : null}
        {canManage && (
          <button
            onClick={() => setInviteOpen(true)}
            style={{
              padding: 12,
              borderRadius: 10,
              marginTop: 8,
              border: `1px solid ${alpha(t.gold, 0.33)}`,
              color: t.gold,
              textAlign: "center",
              fontSize: 13,
              fontFamily: t.display,
              background: alpha(t.gold, 0.06),
              width: "100%",
            }}
          >
            ▦ Let players join from their phones
          </button>
        )}
      </div>
      {inviteOpen && (
        <InviteSheet gameId={gameId!} onClose={() => setInviteOpen(false)} />
      )}

      <div
        style={{
          padding: "10px 16px 14px",
          borderTop: `1px solid ${alpha(t.gold, 0.13)}`,
        }}
      >
        <button
          disabled={canManage && playerOrdersInGame.length < 2}
          onClick={() => nav(`/games/${gameId}`)}
          style={{
            ...goldButton,
            width: "100%",
            borderRadius: 12,
            padding: "14px",
            fontSize: 16,
            opacity: canManage && playerOrdersInGame.length < 2 ? 0.5 : 1,
          }}
        >
          {!canManage
            ? "View game →"
            : playerOrdersInGame.length < 2
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
  canChangeDealer,
  readOnly,
}: {
  isSelf: boolean;
  playerOrderId: string;
  player: Player;
  isDealer: boolean;
  canChangeDealer: boolean;
  readOnly: boolean;
}) => {
  const { gameId } = useParams<{ gameId: string }>();
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: playerOrderId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const remove = async () => {
    await act("removeSeat", { seatId: playerOrderId });
  };

  const makeDealer = async () => {
    if (!canChangeDealer) {
      enqueueSnackbar("Cannot change dealer once the game has started", {
        variant: "error",
      });
      return;
    }
    await act("setInitialDealer", { gameId: gameId!, playerId: player.id });
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
        background: isDealer ? alpha(t.gold, 0.09) : alpha(t.shade, 0.22),
        border: `1px solid ${
          isDealer ? alpha(t.gold, 0.33) : alpha(t.gold, 0.13)
        }`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      {!readOnly && (
        <div
          {...listeners}
          {...attributes}
          style={{
            color: alpha(t.gold, 0.6),
            fontSize: 16,
            letterSpacing: "-0.1em",
            cursor: "grab",
            touchAction: "none",
          }}
        >
          ⋮⋮
        </div>
      )}
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          background: t.feltDk,
          border: `1px solid ${alpha(t.gold, 0.27)}`,
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
      {!isDealer && !readOnly && (
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
      {!isSelf && !readOnly && (
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
