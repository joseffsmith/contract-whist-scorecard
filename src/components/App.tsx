import { push, ref, set } from "firebase/database";
import { useObjectVal } from "react-firebase-hooks/database";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { db } from "..";
import { Game } from "../types";

export const Root = () => {
  const { gameId } = useParams();
  const nav = useNavigate();

  const [currentGame, loading, errors] = useObjectVal<Game>(
    ref(db, "games/" + gameId)
  );

  // TODO: select players from previous game loaded
  async function createNewGame() {
    const gamesListRef = ref(db, "games");
    const newGameRef = await push(gamesListRef);
    set(newGameRef, {
      created_at: new Date().toISOString(),
    });

    const playerRef = ref(db, "players/" + newGameRef.key);
    await push(playerRef, { name: "Player 1" });
    await push(playerRef, { name: "Player 2" });

    nav("/games/" + newGameRef.key);
  }

  return (
    <>
      <header className="flex items-baseline justify-between mt-px">
        <h1 className="font-mono text-sm">Contract whist</h1>
        <span className="space-x-2">
          <Link to={"/"}>
            <button className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900">
              All games
            </button>
          </Link>
          <button
            onClick={createNewGame}
            className="border rounded-sm py-0.5 px-2 bg-indigo-100 border-indigo-900"
          >
            New game
          </button>
        </span>
      </header>
      <Outlet />
    </>
  );
};
