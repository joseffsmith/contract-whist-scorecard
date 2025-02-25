import { Button, DialogTitle, Modal, ModalDialog, Typography } from "@mui/joy";
import { enqueueSnackbar } from "notistack";
import { useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../db";
import { queryAllGamesWithPlayers } from "../queries";

export const GameList = () => {
  const { user, isLoading } = db.useAuth();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const { data: gameData } = db.useQuery(queryAllGamesWithPlayers);

  const handleDelete = (gameIsDeleting: string) => {
    setIsDeleting(gameIsDeleting);
  };

  const _handleDelete = async () => {
    // if createdBy id is not the same as the current user id, return

    if (!isDeleting) {
      enqueueSnackbar("No game selected", { variant: "error" });
      return;
    }

    try {
      await db.transact([
        db.tx.games[isDeleting].update({
          deletedAt: new Date().toISOString(),
        }),
      ]);
    } catch (err) {
      enqueueSnackbar("Error deleting game", { variant: "error" });
      console.error(err);
      return;
    }

    setIsDeleting(null);
  };

  const handleCloseDelete = () => {
    setIsDeleting(null);
  };

  if (!gameData?.games || isLoading) {
    return null;
  }

  return (
    <div className="text-sm overflow-scroll">
      {isDeleting && (
        <Modal open onClose={handleCloseDelete}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              _handleDelete();
            }}
          >
            <ModalDialog>
              <DialogTitle>Delete game?</DialogTitle>
              <Typography>
                Are you sure you want to delete this game?
              </Typography>
              <Button variant="plain" onClick={handleCloseDelete}>
                Cancel
              </Button>
              <Button type="submit" variant="solid" color="danger">
                Delete
              </Button>
            </ModalDialog>
          </form>
        </Modal>
      )}
      {gameData.games
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .filter((g) => !g.deletedAt)
        .map((game) => {
          const isOwnGame = game.createdBy === user?.id;
          const canDelete = isOwnGame;
          //|| user?.email === "xxx@icloud.com";
          return (
            <div key={game.id} className="py-1 mb-1 border-b">
              <div className="flex justify-between">
                <span>{new Date(game.createdAt).toLocaleString()}</span>
                <div className="flex">
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(game.id)}
                      className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900 mx-1"
                    >
                      Delete game
                    </button>
                  )}
                  <Link to={`/games/${game.id}`}>
                    <button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900">
                      Load game
                    </button>
                  </Link>
                </div>
              </div>
              <div
                className={`grid grid-cols-${game.playersOrders.length}`}
                style={{
                  gridTemplateColumns: `repeat(${game.playersOrders.length}, minmax(0, 1fr))`,
                }}
              >
                {game.playersOrders.map((p, idx) => (
                  <div key={idx}>{p.player?.name}</div>
                ))}
                {game.playersOrders.map((po, idx) => {
                  return (
                    <PlayerScore
                      key={po.id}
                      playerId={po.player?.id}
                      gameId={game.id}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
    </div>
  );
};

const PlayerScore = ({ playerId, gameId }) => {
  const { data: playerData } = db.useQuery({
    turns: { $: { where: { "player.id": playerId, "round.game.id": gameId } } },
  });
  const score = playerData?.turns.reduce((acc, t) => {
    return (acc += t.score ?? 0);
  }, 0);

  return (
    <div
    // className={`${
    //   // Math.max(...game.scores) === s && s > 0 ? "bg-green-500" : ""
    // }`}
    >
      {score ?? "..."}
    </div>
  );
};
