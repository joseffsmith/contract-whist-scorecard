import "./index.css";

import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { SnackbarProvider } from "notistack";
import { router } from "./Routes";

const container = document.getElementById("root");
const root = createRoot(container!);
root.render(
  <>
    <SnackbarProvider
      autoHideDuration={3000}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
    />
    <RouterProvider router={router} />
  </>
);

// A new deploy's service worker takes over once it activates; reload so the
// page runs the new code now rather than on the open after. Only when a
// worker already controlled the page (not the first install), and only once.
// Queued changes live in IndexedDB, so reloading is safe.
if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
