import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { hostTable, nearbySupported, scanTables } from "../lib/nearby";
import type { Table } from "../lib/nearby";
import { useMyPlayer } from "../players/account";
import { alpha, goldButton, t } from "../theme/tokens";
import { Sheet } from "./chrome/Sheet";

// "Join a table nearby" (the app only): scans for phones showing an invite and
// lists their tables. Joining opens the same page as the invite's QR code.
export const NearbyTablesButton = () => {
  const [open, setOpen] = useState(false);
  if (!nearbySupported()) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          marginTop: 10,
          padding: "12px 0",
          borderRadius: 12,
          border: `1px solid ${alpha(t.gold, 0.4)}`,
          background: "transparent",
          color: t.cream,
          fontFamily: t.display,
          fontSize: 15,
          fontWeight: 600,
        }}
      >
        Join a table nearby
      </button>
      {open && <NearbyTablesSheet onClose={() => setOpen(false)} />}
    </>
  );
};

const NearbyTablesSheet = ({ onClose }: { onClose: () => void }) => {
  const nav = useNavigate();
  const [tables, setTables] = useState<Table[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    setError(null);
    scanTables((table) =>
      setTables((list) =>
        list.some((t) => t.gameId === table.gameId) ? list : [...list, table]
      )
    )
      .then((stopScan) => (gone ? stopScan() : (stop = stopScan)))
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
      stop?.();
    };
  }, [attempt]);

  return (
    <Sheet onClose={onClose}>
      <div
        style={{
          fontFamily: t.display,
          fontSize: 22,
          fontWeight: 600,
          color: t.cream,
          textAlign: "center",
        }}
      >
        Tables nearby
      </div>
      <div
        style={{
          fontSize: 13,
          color: t.cream,
          opacity: 0.7,
          margin: "6px 0 16px",
          textAlign: "center",
        }}
      >
        Ask the host to open their game's invite.
      </div>
      {tables.map((table) => (
        <button
          key={table.gameId}
          onClick={() => {
            onClose();
            nav(`/join/${table.gameId}`);
          }}
          style={{
            ...goldButton,
            width: "100%",
            padding: "14px 0",
            borderRadius: 12,
            fontSize: 16,
            marginBottom: 8,
          }}
        >
          Join {table.name ? `${table.name}'s table` : "this table"}
        </button>
      ))}
      {error ? (
        <div style={{ textAlign: "center", fontSize: 13, color: t.cream }}>
          {error}{" "}
          <button
            onClick={() => setAttempt((n) => n + 1)}
            style={{
              background: "none",
              border: "none",
              color: t.gold,
              fontWeight: 600,
              fontSize: 13,
              padding: 0,
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <div
          style={{
            textAlign: "center",
            fontSize: 12,
            color: t.cream,
            opacity: 0.55,
          }}
        >
          {tables.length ? "Still looking…" : "Looking for tables…"}
        </div>
      )}
    </Sheet>
  );
};

// While the invite is open, the host's phone tells phones nearby about the
// game. Shows how that's going under the QR code (the app only).
export const HostNearby = ({ gameId }: { gameId: string }) => {
  const { player } = useMyPlayer();
  const name = player?.name ?? "";
  const [state, setState] = useState<"starting" | "on" | string>("starting");

  useEffect(() => {
    if (!nearbySupported()) return;
    let stop: (() => void) | undefined;
    let gone = false;
    setState("starting");
    hostTable(gameId, name)
      .then((stopHosting) => {
        if (gone) return stopHosting();
        stop = stopHosting;
        setState("on");
      })
      .catch((e: Error) => !gone && setState(e.message));
    return () => {
      gone = true;
      stop?.();
    };
  }, [gameId, name]);

  if (!nearbySupported()) return null;
  return (
    <div
      style={{
        fontSize: 12,
        color: t.cream,
        opacity: state === "on" ? 0.75 : 0.55,
        marginTop: 12,
        lineHeight: 1.4,
      }}
    >
      {state === "on"
        ? "Phones nearby can find this table too: Home, Join a table nearby."
        : state === "starting"
        ? "Letting phones nearby find this table…"
        : state}
    </div>
  );
};
