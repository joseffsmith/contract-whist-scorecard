import { createBrowserRouter } from "react-router-dom";
import { AdminSetup } from "./components/AdminSetup";
import { App } from "./components/App";
import { GameComp } from "./components/Game";
import { GameList } from "./components/GameList";
import { GameManager } from "./components/GameManager";
import { GuestGameComp } from "./components/GuestGame";
import { GuestGameManager } from "./components/GuestGameManager";
import { HeadToHead } from "./components/HeadToHead";
import { Home } from "./components/Home";
import { Leaderboard } from "./components/Leaderboard";
import { JoinGame } from "./components/JoinGame";
import { PlayerStats } from "./components/PlayerStats";
import { Players } from "./components/Players";
import { ResetPassword } from "./components/ResetPassword";
import { UserLogin } from "./components/UserLogin";
import { UserManager } from "./components/UserManager";
import { BASE_PATH } from "./lib/paths";

export const router = createBrowserRouter(
  [
    { path: "/login", element: <UserLogin /> },
    { path: "/admin", element: <AdminSetup /> },
    { path: "/reset", element: <ResetPassword /> },
    { path: "/reset/:token", element: <ResetPassword /> },
    {
      path: "/",
      element: <App />,
      children: [
        { path: "/", element: <Home /> },
        { path: "/games", element: <GameList /> },
        { path: "/leaderboard", element: <Leaderboard /> },
        { path: "/players", element: <Players /> },
        { path: "/stats/:playerId", element: <PlayerStats /> },
        { path: "/stats/:playerId/vs/:otherId", element: <HeadToHead /> },
        { path: "/join/:gameId", element: <JoinGame /> },
        { path: "/user", element: <UserManager /> },
        { path: "/games/:gameId", element: <GameComp /> },
        { path: "/games/:gameId/manage", element: <GameManager /> },
        { path: "/games/guest/:gameId", element: <GuestGameComp /> },
        { path: "/games/guest/:gameId/manage", element: <GuestGameManager /> },
      ],
    },
  ],
  { basename: BASE_PATH || "/" }
);
