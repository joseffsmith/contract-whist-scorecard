export { sync, createSyncClient, isConfirmed } from "./client";
export type {
  ActionRejection,
  PasskeyInfo,
  AuthState,
  ConnectionStatus,
  NetworkSignal,
  StorageHealth,
  SyncClient,
  SyncDeps,
} from "./client";
export {
  useAuth,
  useConnectionStatus,
  usePendingCount,
  usePreparedPasskeys,
  useStorageHealth,
  useSyncView,
} from "./react";
export {
  selectActivePlayers,
  selectGame,
  selectHomeGames,
  selectPlayersByClaim,
} from "./selectors";
export type { HomeGame, HomeGames } from "./selectors";
export { passkeysSupported } from "./passkeys";
export { openStorage } from "./storage";
export type { SyncStorage } from "./storage";
export { OFFLINE_MESSAGE, SyncError, isNetworkError } from "./transport";
