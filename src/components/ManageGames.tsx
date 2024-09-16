import { Link } from "react-router-dom";
import { db } from "..";

// TODO: add scores
export const ManageGames = () => {
  const { data: gameData } = db.useQuery({
    games: { playersOrders: { player: {} } },
  });

  if (!gameData?.games) {
    return null;
  }

  return (
    <div className="text-sm overflow-scroll">
      {gameData.games
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((game) => {
          return (
            <div key={game.id} className="p-1">
              <div className="flex justify-between">
                <span>{game.created_at.toLocaleString()}</span>
                <Link to={`/games/${game.id}`}>
                  <button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900">
                    Load game
                  </button>
                </Link>
              </div>
              <div
                className={`grid grid-cols-${game.playersOrders.length}`}
                style={{
                  gridTemplateColumns: `repeat(${game.playersOrders.length}, minmax(0, 1fr))`,
                }}
              >
                {game.playersOrders.map((p, idx) => (
                  <div key={idx}>{p.player[0].name}</div>
                ))}
                {game.playersOrders.map((po, idx) => {
                  return (
                    <PlayerScore
                      key={po.id}
                      playerId={po.player[0].id}
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
      {score}
    </div>
  );
};
