import { createBrowserRouter } from "react-router-dom";
import { App } from "./components/App";
import { GameComp } from "./components/Game";
import { GameList } from "./components/GameList";
import { GameManager } from "./components/GameManager";
import { GuestGameComp } from "./components/GuestGame";
import { GuestGameManager } from "./components/GuestGameManager";
import { Home } from "./components/Home";
import { Leaderboard } from "./components/Leaderboard";
import { UserLogin } from "./components/UserLogin";
import { UserManager } from "./components/UserManager";

export const router = createBrowserRouter(
  [
    { path: "/login", element: <UserLogin /> },
    {
      path: "/",
      element: <App />,
      children: [
        { path: "/", element: <Home /> },
        { path: "/games", element: <GameList /> },
        { path: "/leaderboard", element: <Leaderboard /> },
        { path: "/user", element: <UserManager /> },
        { path: "/games/:gameId", element: <GameComp /> },
        { path: "/games/:gameId/manage", element: <GameManager /> },
        { path: "/games/guest/:gameId", element: <GuestGameComp /> },
        { path: "/games/guest/:gameId/manage", element: <GuestGameManager /> },
      ],
    },
  ],
  { basename: "/contract-whist" }
);
