import "./index.css";

import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";

import { SnackbarProvider } from "notistack";
import { router } from "./Routes";

const container = document.getElementById("root");
const root = createRoot(container!);
root.render(
  <>
    <SnackbarProvider />
    <RouterProvider router={router} />
  </>
);
