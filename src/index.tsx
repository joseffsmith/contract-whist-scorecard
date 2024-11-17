import "./index.css";

import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { App } from "./components/App";
import { GameComp } from "./components/Game";
import { GameList } from "./components/GameList";

import { init } from "@instantdb/react";
import { SnackbarProvider } from "notistack";
import { Schema } from "./types";
import { Leaderboard } from "./components/Leaderboard";
import { GameManager } from "./components/GameManager";
import { UserManager } from "./components/UserManager";
import { UserLogin } from "./components/UserLogin";

// ID for app: contract-whist-scoreboard
const APP_ID = "33fdf866-9fcb-4721-a84d-ca1dba1f0ab0";

export const db = init<Schema>({ appId: APP_ID });

const container = document.getElementById("root");
const root = createRoot(container!);

const router = createBrowserRouter(
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

root.render(
  <>
    <SnackbarProvider />
    <RouterProvider router={router} />
  </>
);
