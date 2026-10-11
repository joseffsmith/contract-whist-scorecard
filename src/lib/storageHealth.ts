import { useSyncExternalStore } from "react";
import { sync } from "../sync";

// Whether the sync engine can keep this phone's data on the device:
// "ok", "memory" (storage unavailable, held in memory only) or "failing"
// (writes are erroring).
export function useStorageHealth(): "ok" | "memory" | "failing" {
  return useSyncExternalStore(
    sync.subscribe,
    sync.getStorageHealth,
    sync.getStorageHealth
  );
}
