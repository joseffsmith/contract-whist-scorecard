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
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  addPlayer,
  GuestPlayer,
  removePlayer,
  reorderPlayers,
  setInitialDealer,
} from "../guest/guestStore";
import { useGuestGame } from "../guest/useGuestGame";
import { goldButton, t } from "../theme/tokens";
import { getDealerIdx } from "../utils/getDealerIdx";
import { Crumb } from "./chrome/Crumb";

export const GuestGameManager = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const nav = useNavigate();
  const game = useGuestGame(gameId);
  const [newName, setNewName] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  if (!game) {
    return (
      <>
        <Crumb trail={[{ label: "Guest", to: "/login" }, { label: "New game" }]} />
        <div style={{ padding: 20, opacity: 0.6 }}>Game not found.</div>
      </>
    );
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = game.players.findIndex((p) => p.id === active.id);
    const newIndex = game.players.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorderPlayers(game.id, oldIndex, newIndex);
  };

  let initialDealerIdx: number | null = game.players.findIndex(
    (p) => p.id === game.initialDealerId
  );
  if (initialDealerIdx === -1) initialDealerIdx = null;
  const dealerIdx = getDealerIdx(null, game.players.length, initialDealerIdx);

  const submitName = () => {
    const name = newName.trim();
    if (!name) return;
    addPlayer(game.id, name);
    setNewName("");
  };

  return (
    <>
      <Crumb
        trail={[{ label: "Guest", to: "/login" }, { label: "New game" }]}
      />
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
          Players · {game.players.length}
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={game.players.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            {game.players.map((p, idx) => (
              <PlayerRow
                key={p.id}
                player={p}
                isDealer={dealerIdx === idx}
                onMakeDealer={() => setInitialDealer(game.id, p.id)}
                onRemove={() => removePlayer(game.id, p.id)}
              />
            ))}
          </SortableContext>
        </DndContext>

        <div
          style={{
            display: "flex",
            gap: 8,
            padding: 10,
            borderRadius: 10,
            background: "rgba(0,0,0,0.25)",
            border: `1px dashed ${t.gold}55`,
            marginTop: 8,
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitName();
            }}
            placeholder="Add player"
            autoFocus
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: t.cream,
              fontSize: 14,
              padding: "4px 6px",
            }}
          />
          {newName.trim() && (
            <button
              onClick={submitName}
              style={{
                border: `1px solid ${t.gold}`,
                color: t.gold,
                background: "transparent",
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: 12,
                fontFamily: t.display,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Add
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          padding: "10px 16px 14px",
          borderTop: `1px solid ${t.gold}22`,
        }}
      >
        <button
          disabled={game.players.length < 2}
          onClick={() => nav(`/games/guest/${game.id}`)}
          style={{
            ...goldButton,
            width: "100%",
            borderRadius: 12,
            padding: "14px",
            fontSize: 16,
            opacity: game.players.length < 2 ? 0.5 : 1,
          }}
        >
          {game.players.length < 2
            ? "Minimum 2 players"
            : "Deal · start game →"}
        </button>
      </div>
    </>
  );
};

const PlayerRow = ({
  player,
  isDealer,
  onMakeDealer,
  onRemove,
}: {
  player: GuestPlayer;
  isDealer: boolean;
  onMakeDealer: () => void;
  onRemove: () => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: player.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
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
          onClick={onMakeDealer}
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
      <button
        onClick={onRemove}
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
    </div>
  );
};
