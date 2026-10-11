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
//   "pending":  queued actions, keyed by action id (so two tabs sharing the
//               database never overwrite each other) and ordered by (at, n)
//   "kv":       "version" (number) and "session" ({ token, user })
// If IndexedDB is unavailable (private mode, blocked, hung) we fall back to
// memory: the app still works online, it just can't survive a reload.
// Writes reject when they fail even after reopening the database once; the
// engine decides what to do about that.

// `provisional`: a guest made on this device while offline. It has no token
// yet; the server is asked to accept its id when we're next online.
export type Session = {
  token: string | null;
  user: PublicUser;
  provisional?: boolean;
  // Proves to the server that we're the one who made a provisional id.
  secret?: string;
};

export type PendingEntry = {
  id: string; // the action's id
  at: number; // when it was queued (ms), never going backwards on a device
  n: number; // tie-break for entries queued in the same millisecond
  userId: string; // who dispatched it; dropped if someone else signs in
  isGuest: boolean;
  action: Action;
  // Set once the server has answered ok. The entry is kept (and still applied
  // to the view) until the snapshot reaches this version, so nothing flickers.
  ackVersion?: number;
};

export const comparePending = (a: PendingEntry, b: PendingEntry) =>
  a.at - b.at || a.n - b.n || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export type StoredState = {
  data: DataState;
  version: number;
  pending: PendingEntry[];
  session: Session | null;
};

export interface SyncStorage {
  // False for the in-memory fallback.
  readonly persistent: boolean;
  // Rejects if the stored data can't be read (don't write over it then).
  load(): Promise<StoredState>;
  // Writes just the rows in the change set, plus the new version.
  applyChanges(changes: ChangeSet): Promise<void>;
  putPending(entries: PendingEntry[]): Promise<void>;
  deletePending(ids: string[]): Promise<void>;
  // Replaces the whole queue (used to repair after a failed write).
  replacePending(entries: PendingEntry[]): Promise<void>;
  setSession(session: Session | null): Promise<void>;
  // Both in one transaction (switching guests moves the queue with the session).
  replaceSessionAndPending(
    session: Session | null,
    entries: PendingEntry[]
  ): Promise<void>;
}

const DB_NAME = "whist-sync";
const DB_VERSION = 2;
const PENDING = "pending";
const KV = "kv";
const OPEN_TIMEOUT_MS = 3000;
const TX_TIMEOUT_MS = 10_000;

// ── Memory fallback ─────────────────────────────────────────────────────

function cloneData(data: DataState): DataState {
  const copy = createMemoryState();
  for (const table of TABLES) {
    for (const [id, row] of data[table]) {
      (copy[table] as Map<string, Tables[TableName]>).set(id, row);
    }
  }
  return copy;
}

export function createMemoryStorage(): SyncStorage {
  let data = createMemoryState();
  let version = 0;
  let session: Session | null = null;
  const pending = new Map<string, PendingEntry>();
  return {
    persistent: false,
    async load() {
      return {
        data: cloneData(data),
        version,
        pending: [...pending.values()].sort(comparePending),
        session,
      };
    },
    async applyChanges(changes) {
      if (changes.reset) data = createMemoryState();
      for (const table of TABLES) {
        const rows = data[table] as Map<string, { id: string }>;
        for (const row of changes.puts[table] ?? []) rows.set(row.id, row);
        for (const id of changes.deletes[table] ?? []) rows.delete(id);
      }
      version = changes.version;
    },
    async putPending(entries) {
      for (const entry of entries) pending.set(entry.id, entry);
    },
    async deletePending(ids) {
      for (const id of ids) pending.delete(id);
    },
    async replacePending(entries) {
      pending.clear();
      for (const entry of entries) pending.set(entry.id, entry);
    },
    async setSession(next) {
      session = next;
    },
    async replaceSessionAndPending(next, entries) {
      session = next;
      pending.clear();
      for (const entry of entries) pending.set(entry.id, entry);
    },
  };
}

// ── IndexedDB ───────────────────────────────────────────────────────────

const timeoutAfter = <T>(promise: Promise<T>, ms: number, what: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      for (const table of TABLES) {
        if (!db.objectStoreNames.contains(table)) {
          db.createObjectStore(table, { keyPath: "id" });
        }
      }
      // Version 1 keyed the queue by a counter; it's unreleased, so recreate.
      if (event.oldVersion < 2 && db.objectStoreNames.contains(PENDING)) {
        db.deleteObjectStore(PENDING);
      }
      if (!db.objectStoreNames.contains(PENDING)) {
        db.createObjectStore(PENDING, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
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
  return timeoutAfter(
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
      fn(tx);
    }),
    TX_TIMEOUT_MS,
    "IndexedDB transaction"
  );
}

function createIdbStorage(
  factory: IDBFactory,
  first: IDBDatabase
): SyncStorage {
  // iOS may kill the connection while the app is in the background. When it
  // closes (or another tab upgrades the schema) forget it and reopen lazily.
  let current: Promise<IDBDatabase> | null = Promise.resolve(first);
  const watch = (db: IDBDatabase) => {
    const forget = () => {
      if (current) current = null;
    };
    db.onclose = forget;
    db.onversionchange = () => {
      db.close();
      forget();
    };
  };
  watch(first);

  const getDb = () =>
    (current ??= timeoutAfter(
      openDb(factory),
      OPEN_TIMEOUT_MS,
      "Opening IndexedDB"
    ).then(
      (db) => {
        watch(db);
        return db;
      },
      (error) => {
        current = null;
        throw error;
      }
    ));

  // One retry on a fresh connection.
  async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
    try {
      return await fn(await getDb());
    } catch {
      const old = current;
      current = null;
      old?.then((db) => db.close()).catch(() => {});
      return await fn(await getDb());
    }
  }

  return {
    persistent: true,
    load: () =>
      withDb(async (db) => {
        // Issue every read before awaiting any of them.
        const tx = db.transaction([...TABLES, PENDING, KV], "readonly");
        const reads = [
          ...TABLES.map((table) => done(tx.objectStore(table).getAll())),
          done(tx.objectStore(PENDING).getAll()),
          done(tx.objectStore(KV).get("version")),
          done(tx.objectStore(KV).get("session")),
        ];
        const results = await timeoutAfter(
          Promise.all(reads),
          TX_TIMEOUT_MS,
          "Reading IndexedDB"
        );
        const data = createMemoryState();
        TABLES.forEach((table, i) => {
          for (const row of results[i] as { id: string }[]) {
            (data[table] as Map<string, { id: string }>).set(row.id, row);
          }
        });
        const [pending, version, session] = results.slice(TABLES.length);
        return {
          data,
          version: typeof version === "number" ? version : 0,
          pending: (pending as PendingEntry[]).sort(comparePending),
          session: (session as Session | undefined) ?? null,
        };
      }),
    applyChanges: (changes) =>
      withDb((db) =>
        transact(db, [...TABLES, KV], "readwrite", (tx) => {
          for (const table of TABLES) {
            const store = tx.objectStore(table);
            if (changes.reset) store.clear();
            for (const row of changes.puts[table] ?? []) store.put(row);
            for (const id of changes.deletes[table] ?? []) store.delete(id);
          }
          tx.objectStore(KV).put(changes.version, "version");
        })
      ),
    putPending: (entries) =>
      withDb((db) =>
        transact(db, [PENDING], "readwrite", (tx) => {
          for (const entry of entries) tx.objectStore(PENDING).put(entry);
        })
      ),
    deletePending: (ids) =>
      withDb((db) =>
        transact(db, [PENDING], "readwrite", (tx) => {
          for (const id of ids) tx.objectStore(PENDING).delete(id);
        })
      ),
    replacePending: (entries) =>
      withDb((db) =>
        transact(db, [PENDING], "readwrite", (tx) => {
          tx.objectStore(PENDING).clear();
          for (const entry of entries) tx.objectStore(PENDING).put(entry);
        })
      ),
    replaceSessionAndPending: (session, entries) =>
      withDb((db) =>
        transact(db, [KV, PENDING], "readwrite", (tx) => {
          if (session) tx.objectStore(KV).put(session, "session");
          else tx.objectStore(KV).delete("session");
          tx.objectStore(PENDING).clear();
          for (const entry of entries) tx.objectStore(PENDING).put(entry);
        })
      ),
    setSession: (session) =>
      withDb((db) =>
        transact(db, [KV], "readwrite", (tx) => {
          if (session) tx.objectStore(KV).put(session, "session");
          else tx.objectStore(KV).delete("session");
        })
      ),
  };
}

// IndexedDB if we can have it (and it answers quickly), otherwise memory.
// Never rejects.
export async function openStorage(
  factory?: IDBFactory | null,
  timeoutMs = OPEN_TIMEOUT_MS
): Promise<SyncStorage> {
  try {
    // Reading `indexedDB` can itself throw when site data is blocked.
    const idb = factory === undefined ? globalThis.indexedDB : factory;
    if (!idb) return createMemoryStorage();
    const db = await timeoutAfter(openDb(idb), timeoutMs, "Opening IndexedDB");
    return createIdbStorage(idb, db);
  } catch (error) {
    console.warn("IndexedDB unavailable, data won't survive a reload", error);
    return createMemoryStorage();
  }
}
