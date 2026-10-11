import { createMemoryState } from "../../shared/actions";
import { TABLES } from "../../shared/types";
import type {
  Action,
  ChangeSet,
  DataState,
  PublicUser,
  TableName,
  Tables,
} from "../../shared/types";

// Everything the engine keeps on the device, in IndexedDB "whist-sync":
//   one object store per synced table (keyPath "id"): the server snapshot
//   "pending":  queued actions, keyed by `seq` so they stay in order
//   "kv":       "version" (number) and "session" ({ token, user })
// If IndexedDB is unavailable (private mode, blocked) we fall back to memory:
// the app still works online, it just can't survive a reload offline.

export type Session = { token: string; user: PublicUser };

export type PendingEntry = {
  seq: number;
  userId: string; // who dispatched it; dropped if someone else signs in
  isGuest: boolean;
  action: Action;
  // Set once the server has answered ok. The entry is kept (and still applied
  // to the view) until the snapshot reaches this version, so nothing flickers.
  ackVersion?: number;
};

export type StoredState = {
  data: DataState;
  version: number;
  pending: PendingEntry[];
  session: Session | null;
};

export interface SyncStorage {
  readonly persistent: boolean;
  load(): Promise<StoredState>;
  // Writes just the rows in the change set, plus the new version.
  applyChanges(changes: ChangeSet): Promise<void>;
  putPending(entries: PendingEntry[]): Promise<void>;
  deletePending(seqs: number[]): Promise<void>;
  setSession(session: Session | null): Promise<void>;
}

const DB_NAME = "whist-sync";
const PENDING = "pending";
const KV = "kv";

// ── Shared change-set logic ─────────────────────────────────────────────

export function applyChangeSetToData(data: DataState, changes: ChangeSet) {
  for (const table of TABLES) {
    const rows = data[table] as Map<string, Tables[TableName]>;
    for (const row of changes.puts[table] ?? []) rows.set(row.id, row);
    for (const id of changes.deletes[table] ?? []) rows.delete(id);
  }
}

// ── Memory fallback ─────────────────────────────────────────────────────

export function createMemoryStorage(): SyncStorage {
  let data = createMemoryState();
  let version = 0;
  let session: Session | null = null;
  const pending = new Map<number, PendingEntry>();
  return {
    persistent: false,
    async load() {
      return {
        data: cloneData(data),
        version,
        pending: [...pending.values()].sort((a, b) => a.seq - b.seq),
        session,
      };
    },
    async applyChanges(changes) {
      if (changes.reset) data = createMemoryState();
      applyChangeSetToData(data, changes);
      version = changes.version;
    },
    async putPending(entries) {
      for (const entry of entries) pending.set(entry.seq, entry);
    },
    async deletePending(seqs) {
      for (const seq of seqs) pending.delete(seq);
    },
    async setSession(next) {
      session = next;
    },
  };
}

function cloneData(data: DataState): DataState {
  const copy = createMemoryState();
  for (const table of TABLES) {
    for (const [id, row] of data[table]) {
      (copy[table] as Map<string, Tables[TableName]>).set(id, row);
    }
  }
  return copy;
}

// ── IndexedDB ───────────────────────────────────────────────────────────

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const table of TABLES)
        db.createObjectStore(table, { keyPath: "id" });
      db.createObjectStore(PENDING, { keyPath: "seq" });
      db.createObjectStore(KV);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
}

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

// Runs `fn` in one transaction; resolves when it commits.
function transact(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    fn(tx);
  });
}

function createIdbStorage(db: IDBDatabase): SyncStorage {
  // Persistence is best effort: a failed write (quota, evicted DB) must not
  // break the running app, whose in-memory state is still right.
  const safely = async (write: Promise<void>) => {
    try {
      await write;
    } catch (error) {
      console.warn("Couldn't save to IndexedDB", error);
    }
  };

  return {
    persistent: true,
    async load() {
      const empty: StoredState = {
        data: createMemoryState(),
        version: 0,
        pending: [],
        session: null,
      };
      try {
        const stores = [...TABLES, PENDING, KV];
        const tx = db.transaction(stores, "readonly");
        const rows = await Promise.all(
          TABLES.map((table) => done(tx.objectStore(table).getAll()))
        );
        const pending = await done(tx.objectStore(PENDING).getAll());
        const version = await done(tx.objectStore(KV).get("version"));
        const session = await done(tx.objectStore(KV).get("session"));
        TABLES.forEach((table, i) => {
          for (const row of rows[i]) {
            (empty.data[table] as Map<string, Tables[TableName]>).set(
              row.id,
              row
            );
          }
        });
        empty.pending = (pending as PendingEntry[]).sort(
          (a, b) => a.seq - b.seq
        );
        empty.version = typeof version === "number" ? version : 0;
        empty.session = session ?? null;
      } catch (error) {
        console.warn("Couldn't read from IndexedDB", error);
      }
      return empty;
    },
    applyChanges(changes) {
      return safely(
        transact(db, [...TABLES, KV], "readwrite", (tx) => {
          for (const table of TABLES) {
            const store = tx.objectStore(table);
            if (changes.reset) store.clear();
            for (const row of changes.puts[table] ?? []) store.put(row);
            for (const id of changes.deletes[table] ?? []) store.delete(id);
          }
          tx.objectStore(KV).put(changes.version, "version");
        })
      );
    },
    putPending(entries) {
      return safely(
        transact(db, [PENDING], "readwrite", (tx) => {
          for (const entry of entries) tx.objectStore(PENDING).put(entry);
        })
      );
    },
    deletePending(seqs) {
      return safely(
        transact(db, [PENDING], "readwrite", (tx) => {
          for (const seq of seqs) tx.objectStore(PENDING).delete(seq);
        })
      );
    },
    setSession(session) {
      return safely(
        transact(db, [KV], "readwrite", (tx) => {
          if (session) tx.objectStore(KV).put(session, "session");
          else tx.objectStore(KV).delete("session");
        })
      );
    },
  };
}

// IndexedDB if we can have it, otherwise memory. Never rejects.
export async function openStorage(
  factory?: IDBFactory | null
): Promise<SyncStorage> {
  try {
    // Reading `indexedDB` can itself throw when site data is blocked.
    const idb = factory === undefined ? globalThis.indexedDB : factory;
    if (!idb) return createMemoryStorage();
    return createIdbStorage(await openDb(idb));
  } catch (error) {
    console.warn("IndexedDB unavailable, data won't survive a reload", error);
    return createMemoryStorage();
  }
}
