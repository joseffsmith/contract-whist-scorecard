import "./index.css";

import { FirebaseOptions, initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { GameComp } from "./components/Game";
import { ManageGames } from "./components/ManageGames";
import { Root } from "./components/App";

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: "contract-whist-7aee2.firebaseapp.com",
  projectId: "contract-whist-7aee2",
  storageBucket: "contract-whist-7aee2.appspot.com",
  messagingSenderId: import.meta.env.VITE_FB_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
  databaseURL:
    "https://contract-whist-7aee2-default-rtdb.europe-west1.firebasedatabase.app",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

const container = document.getElementById("root");
const root = createRoot(container!);

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    children: [
      {
        path: "/games/:gameId",
        element: <GameComp />,
      },
      {
        path: "/",
        element: <ManageGames />,
      },
    ],
  },
]);

root.render(<RouterProvider router={router} />);
