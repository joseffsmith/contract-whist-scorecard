import "./index.css";

import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { App } from "./components/App";
import { GameComp } from "./components/Game";
import { ManageGames } from "./components/ManageGames";

import { init, tx, id } from "@instantdb/react";
import { SnackbarProvider } from "notistack";
import { Schema } from "./types";

// ID for app: contract-whist-scoreboard
const APP_ID = "33fdf866-9fcb-4721-a84d-ca1dba1f0ab0";

export const db = init<Schema>({ appId: APP_ID });

const container = document.getElementById("root");
const root = createRoot(container!);

const router = createBrowserRouter([
  {
    path: "/contract-whist",
    element: <App />,
    children: [
      {
        path: "games/:gameId",
        element: <GameComp />,
      },
      {
        path: "",
        element: <ManageGames />,
      },
    ],
  },
]);

root.render(
  <>
    <SnackbarProvider />
    <RouterProvider router={router} />
  </>
);
