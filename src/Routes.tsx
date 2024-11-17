import { createBrowserRouter } from "react-router-dom";
import { App } from "./components/App";
import { GameComp } from "./components/Game";
import { GameList } from "./components/GameList";
import { GameManager } from "./components/GameManager";
import { Leaderboard } from "./components/Leaderboard";
import { UserLogin } from "./components/UserLogin";
import { UserManager } from "./components/UserManager";

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <App />,
      children: [
        {
          path: "/login",
          element: <UserLogin />,
        },
        {
          path: "/user",
          element: <UserManager />,
        },
        {
          path: "/leaderboard",
          element: <Leaderboard />,
        },
        {
          path: "/games/:gameId",
          element: <GameComp />,
        },
        { path: "/games/:gameId/manage", element: <GameManager /> },
        {
          path: "/",
          element: <GameList />,
        },
      ],
    },
  ],
  { basename: "/contract-whist" }
);
