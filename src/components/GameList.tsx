import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../db";
import { queryHomeGames } from "../queries";
import { goldButton, t } from "../theme/tokens";
import { summarizeGame } from "../utils/gameStatus";

export const GameList = () => {
  const nav = useNavigate();
  const { user } = db.useAuth();
  const { data, isLoading } = db.useQuery(queryHomeGames);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await db.transact([
        db.tx.games[confirmDelete].update({
          deletedAt: new Date().toISOString(),
        }),
      ]);
    } catch (err) {
      enqueueSnackbar("Error deleting game", { variant: "error" });
      return;
    }
    setConfirmDelete(null);
  };

  if (isLoading) {
    return <div style={{ padding: 20, opacity: 0.6 }}>Loading…</div>;
  }

  const games = (data?.games ?? [])
    .filter((g) => !g.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "14px 16px 16px" }}>
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
        {games.length} game{games.length === 1 ? "" : "s"}
      </div>

      {games.length === 0 && (
        <div
          style={{
            fontSize: 13,
            color: t.cream,
            opacity: 0.6,
            padding: "20px 0",
          }}
        >
          No games yet. Tap <b>+ Deal</b> to start one.
        </div>
      )}

      {games.map((g) => {
        const { totals, winnerIdx, isFinished } = summarizeGame(
          g.playersOrders,
          g.rounds
        );
        const sorted = [...totals].sort((a, b) => b.score - a.score);
        const canDelete = g.createdBy === user?.id;
        const when = new Date(g.createdAt).toLocaleString();
        return (
          <div
            key={g.id}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              marginBottom: 8,
              background: "rgba(0,0,0,0.25)",
              border: `1px solid ${t.gold}22`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 8,
              }}
            >
              <Link
                to={`/games/${g.id}`}
                style={{
                  fontFamily: t.display,
                  fontSize: 15,
                  color: t.cream,
                  fontWeight: 600,
                }}
              >
                {isFinished && winnerIdx >= 0 ? (
                  <>
                    {totals[winnerIdx].name}{" "}
                    <span
                      style={{
                        color: t.gold,
                        opacity: 0.65,
                        fontSize: 12,
                        fontWeight: 400,
                      }}
                    >
                      won
                    </span>
                  </>
                ) : (
                  <span style={{ opacity: 0.8 }}>In progress</span>
                )}
              </Link>
              <div
                style={{ fontSize: 10, color: t.cream, opacity: 0.55 }}
              >
                {when}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                cursor: "pointer",
              }}
              onClick={() => nav(`/games/${g.id}`)}
            >
              {sorted.map((p) => {
                const isWinner =
                  isFinished && winnerIdx >= 0 && p.id === totals[winnerIdx].id;
                return (
                  <div
                    key={p.id}
                    style={{
                      fontSize: 11,
                      color: isWinner ? t.gold : t.cream,
                      opacity: isWinner ? 1 : 0.7,
                    }}
                  >
                    {p.name}{" "}
                    <span style={{ fontFamily: t.mono }}>{p.score}</span>
                  </div>
                );
              })}
            </div>
            {canDelete && (
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 6,
                }}
              >
                <button
                  onClick={() => setConfirmDelete(g.id)}
                  style={{
                    background: "transparent",
                    border: `1px solid ${t.red}77`,
                    color: t.red,
                    fontSize: 11,
                    padding: "5px 10px",
                    borderRadius: 14,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}

      {confirmDelete && (
        <ConfirmDialog
          onCancel={() => setConfirmDelete(null)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
};

const ConfirmDialog = ({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) => (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.6)",
      backdropFilter: "blur(4px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      zIndex: 1000,
    }}
    onClick={onCancel}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        maxWidth: 320,
        width: "100%",
        padding: 20,
        borderRadius: 14,
        background: `linear-gradient(180deg, ${t.panel}, ${t.panelDk})`,
        color: t.ink,
        boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
      }}
    >
      <div
        style={{
          fontFamily: t.display,
          fontSize: 20,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        Delete game?
      </div>
      <div style={{ fontSize: 13, color: t.ink2, marginBottom: 16 }}>
        This can't be undone.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: "12px 0",
            borderRadius: 10,
            border: `1px solid ${t.ink}33`,
            background: "transparent",
            color: t.ink,
            fontFamily: t.display,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          style={{
            ...goldButton,
            flex: 1,
            padding: "12px 0",
            borderRadius: 10,
            fontSize: 14,
            background: `linear-gradient(180deg, ${t.red}, #8a2a1e)`,
            color: t.cream,
          }}
        >
          Delete
        </button>
      </div>
    </div>
  </div>
);
