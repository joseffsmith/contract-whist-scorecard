import { useMemo, useSyncExternalStore } from "react";
import { sync } from "./client";
import type { AuthState, ConnectionStatus, StorageHealth } from "./client";
import type { DataState } from "../../shared/types";

// The engine lives outside React; these hooks just subscribe to it. Each one
// reads a value that only changes identity when it really changed, so a
// component re-renders only for what it uses.

const subscribe = sync.subscribe;

export function useSyncView(): { view: DataState; isLoading: boolean } {
  const view = useSyncExternalStore(subscribe, sync.getView, sync.getView);
  const isLoading = useSyncExternalStore(
    subscribe,
    sync.isLoading,
    sync.isLoading
  );
  return useMemo(() => ({ view, isLoading }), [view, isLoading]);
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, sync.getAuth, sync.getAuth);
}

export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(subscribe, sync.getStatus, sync.getStatus);
}

// Actions made on this device that the server hasn't confirmed yet.
export function usePendingCount(): number {
  return useSyncExternalStore(
    subscribe,
    sync.getPendingCount,
    sync.getPendingCount
  );
}

// "memory" or "failing" means changes may not survive a reload on this device.
export function useStorageHealth(): StorageHealth {
  return useSyncExternalStore(
    subscribe,
    sync.getStorageHealth,
    sync.getStorageHealth
  );
}
