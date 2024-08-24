// import { ref } from "firebase/database";
import { useList } from "react-firebase-hooks/database";
import { Link } from "react-router-dom";
import { db } from "..";

// TODO: add scores
export const ManageGames = () => {
  // const manager = useManager()
  // // bit of a hack to make sure the scores stay up to date on this page
  // useEffect(() => {
  //   manager.updateHighlightScores()
  // }, [])

  const [games, loading, error] = useList(ref(db, "games"));

  if (!games) {
    return null;
  }

  return (
    <div className="text-sm overflow-scroll">
      {games.reverse().map((game) => {
        return (
          <div key={game.key} className="p-1">
            <div className="flex justify-between">
              <span>{game.val().created_at.toLocaleString()}</span>
              <Link to={`/games/${game.key}`}>
                <button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900">
                  Load game
                </button>
              </Link>
            </div>
            {/* <div
                className={`grid grid-cols-${data.players.length}`}
                style={{
                  gridTemplateColumns: `repeat(${data.players.length}, minmax(0, 1fr))`,
                }}
              >
                {data.players.map((p, idx) => (
                  <div key={idx}>{p.name}</div>
                ))}
                {data.scores.map((s, idx) => (
                  <div
                    key={idx}
                    className={`${
                      Math.max(...data.scores) === s && s > 0
                        ? "bg-green-500"
                        : ""
                    }`}
                  >
                    {s}
                  </div>
                ))}
              </div> */}
          </div>
        );
      })}
    </div>
  );
};
