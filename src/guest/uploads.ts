import { useEffect, useState } from "react";
import { enqueueSnackbar } from "notistack";
import { sync } from "../sync";
import { listGames, removeGames } from "./guestStore";

// Uploading a phone-only game is an importGame action that the server has to
// accept. The local copy stays until the new game shows up as confirmed, so a
// rejected or lost upload never loses it. Which local game went to which new
// game is remembered in localStorage, so this survives a reload.

const KEY = "guest-uploads-v1";
// How long an upload may sit with nothing queued and no confirmation before
// we assume it was lost (e.g. signed out first) and offer the game again.
const LOST_AFTER_MS = 20_000;

type Uploads = Record<string, string>; // local game id → new synced game id

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const readUploads = (): Uploads => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeUploads = (uploads: Uploads) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(uploads));
  } catch {}
  emit();
};

export const recordUpload = (localId: string, gameId: string) =>
  writeUploads({ ...readUploads(), [localId]: gameId });

const forget = (localIds: string[]) => {
  const uploads = readUploads();
  localIds.forEach((id) => delete uploads[id]);
  writeUploads(uploads);
};

// Local game ids that are uploaded but not yet confirmed by the server.
export function useUploading(): Set<string> {
  const [ids, setIds] = useState(() => new Set(Object.keys(readUploads())));
  useEffect(() => {
    const refresh = () => setIds(new Set(Object.keys(readUploads())));
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === KEY) refresh();
    };
    listeners.add(refresh);
    window.addEventListener("storage", onStorage);
    refresh();
    return () => {
      listeners.delete(refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return ids;
}

// Runs for the life of the app: deletes each local game once its upload is
// confirmed, and keeps it (with an error) if the server turns it down.
export function watchUploads(): () => void {
  const quietSince = new Map<string, number>();

  const check = () => {
    const uploads = readUploads();
    const entries = Object.entries(uploads);
    if (!entries.length) return;
    const local = new Set(listGames().map((g) => g.id));
    const confirmed: string[] = [];
    const dropped: string[] = [];
    for (const [localId, gameId] of entries) {
      if (!local.has(localId)) dropped.push(localId);
      else if (sync.isConfirmed("games", gameId)) confirmed.push(localId);
      else if (sync.getPendingCount() === 0) {
        const since = quietSince.get(localId) ?? Date.now();
        quietSince.set(localId, since);
        if (Date.now() - since > LOST_AFTER_MS) dropped.push(localId);
      } else quietSince.delete(localId);
    }
    if (confirmed.length) {
      removeGames(confirmed);
      enqueueSnackbar(
        `Saved ${confirmed.length} game${confirmed.length === 1 ? "" : "s"}`,
        { variant: "success" }
      );
    }
    if (confirmed.length || dropped.length) forget([...confirmed, ...dropped]);
  };

  const stopSync = sync.subscribe(check);
  // Pending count can settle without any change to notify about.
  const timer = setInterval(check, 5000);
  const stopRejected = sync.onActionRejected(({ action, error }) => {
    if (action.name !== "importGame") return;
    const gameId = (action.args as { game?: { id?: string } }).game?.id;
    const uploads = readUploads();
    const localIds = Object.keys(uploads).filter(
      (id) => uploads[id] === gameId
    );
    if (!localIds.length) return;
    forget(localIds);
    enqueueSnackbar(`Couldn't save a game from this phone: ${error}`, {
      variant: "error",
    });
  });
  check();
  return () => {
    stopSync();
    stopRejected();
    clearInterval(timer);
  };
}
