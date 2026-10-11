import { useEffect, useMemo, useSyncExternalStore } from "react";
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

// Keeps passkey prompts ready for the tap while the component is on screen:
// the options are fetched ahead (see SyncClient.preparePasskey), and again when
// they get old, when the page becomes visible, or when a session appears.
export function usePreparedPasskeys(
  kinds: ("login" | "register")[],
  enabled = true
): void {
  const { user } = useAuth();
  const key = kinds.join();
  useEffect(() => {
    if (!enabled) return;
    // Nothing is fetched for a page nobody is looking at.
    const prepare = () => {
      if (document.hidden) return;
      for (const kind of key.split(",") as typeof kinds) {
        void sync.preparePasskey(kind);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") prepare();
    };
    prepare();
    const timer = setInterval(prepare, 60 * 1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, user?.id, enabled]);
}
