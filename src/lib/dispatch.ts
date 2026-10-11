import { enqueueSnackbar } from "notistack";
import { sync } from "../sync";
import type { ActionArgs, ActionName } from "../../shared/types";

// Run an action, showing its error as a toast if it isn't allowed. Returns
// whether it was applied (locally; the server confirms in the background).
export async function act<N extends ActionName>(
  name: N,
  args: ActionArgs[N]
): Promise<boolean> {
  try {
    await sync.dispatch(name, args);
    return true;
  } catch (e) {
    enqueueSnackbar((e as Error).message || "Something went wrong", {
      variant: "error",
    });
    return false;
  }
}

// New row id. crypto.randomUUID only exists in secure contexts (https or
// localhost), so fall back to building a v4 uuid for plain-http LAN use.
export const newId = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(
    16,
    20
  )}-${h.slice(20)}`;
};
