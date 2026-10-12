import {
  applyAction,
  applyOps,
  createMemoryState,
  memoryReadState,
} from "../../shared/actions";
import { ActionError, TABLES } from "../../shared/types";
import type {
  Action,
  ActionArgs,
  ActionContext,
  ActionName,
  AuthResponse,
  ChangeSet,
  DataState,
  PublicUser,
  PushResponse,
  TableName,
} from "../../shared/types";
import { API_BASE } from "../lib/paths";
import { browserPasskeys, isCancelled, passkeyError } from "./passkeys";
import type { PasskeyApi } from "./passkeys";
import { createMemoryStorage, openStorage } from "./storage";
import type {
  PendingEntry,
  Session,
  StoredState,
  SyncStorage,
} from "./storage";
import {
  OFFLINE_MESSAGE,
  SyncError,
  createTransport,
  isAuthResponse,
  isNetworkError,
} from "./transport";
import type { StreamHandle } from "./transport";

export type ConnectionStatus = "connected" | "connecting" | "offline";
// "memory": no IndexedDB, changes won't survive a reload. "failing": writes
// to IndexedDB are failing. Either way the UI should say "Not saving on this
// device".
export type StorageHealth = "ok" | "memory" | "failing";
export type AuthState = { isLoading: boolean; user: PublicUser | null };
export type ActionRejection = { action: Action; error: string; code: string };
// One of the account's passkeys, as the server lists them.
export type PasskeyInfo = {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: string | null;
  backedUp: boolean;
};

export type NetworkSignal = {
  isOnline(): boolean;
  // Called when connectivity (or page visibility) may have changed.
  subscribe(onChange: () => void): () => void;
};

// Everything the engine touches outside itself, so tests can swap it.
export type SyncDeps = {
  fetch: typeof fetch;
  openStorage: () => Promise<SyncStorage>;
  now: () => number;
  uuid: () => string;
  // A random secret (32 bytes, base64url) for a provisional guest.
  secret: () => string;
  network: NetworkSignal;
  passkeys: PasskeyApi;
  apiBase: string;
  backoff: { minMs: number; maxMs: number };
  batchSize: number;
  maxBatchBytes: number;
  // How long to wait for the stream to deliver our own pushed changes before
  // pulling them.
  streamGraceMs: number;
  // A stream must stay up this long before the reconnect backoff resets.
  healthyMs: number;
  // Give up on opening storage after this long and use memory.
  storageTimeoutMs: number;
  // A passkey prompt refused sooner than this after it was asked for wasn't
  // dismissed by the person.
  quickDismissMs: number;
  requestTimeoutMs?: number;
  streamIdleMs?: number;
};

export type SyncClient = {
  // Resolves once local data (snapshot, pending queue, session) is loaded.
  ready: Promise<void>;
  start(): Promise<void>;
  // Stops all network activity and timers. start() resumes.
  stop(): void;
  dispatch<N extends ActionName>(name: N, args: ActionArgs[N]): Promise<void>;
  onActionRejected(callback: (rejection: ActionRejection) => void): () => void;
  subscribe(callback: () => void): () => void;
  getView(): DataState;
  // True when the row is in the server's snapshot, not just the optimistic view.
  isConfirmed(table: TableName, id: string): boolean;
  getStatus(): ConnectionStatus;
  getStorageHealth(): StorageHealth;
  getAuth(): AuthState;
  // True until hydrated and we have something to show (data, queued changes,
  // a first pull, or no connection to wait for).
  isLoading(): boolean;
  getPendingCount(): number;
  signInAsGuest(): Promise<PublicUser>;
  signUp(email: string, password: string): Promise<PublicUser>;
  logIn(email: string, password: string): Promise<PublicUser>;
  // Make a passkey for the signed-in user; a guest becomes an account. Null
  // when the person dismisses the prompt.
  registerPasskey(name?: string): Promise<PublicUser | null>;
  // Fetches the options for a passkey prompt ahead of the tap (and loads the
  // browser side), so the tap can open the prompt at once. Call it when the
  // buttons appear, and again when it has been used or after a few minutes.
  preparePasskey(kind: "login" | "register"): Promise<void>;
  // Gives a passkey-only account an email and password as a backup way in.
  addEmail(email: string, password: string): Promise<PublicUser>;
  // Signs out every other device.
  signOutOthers(): Promise<void>;
  // Sign in with any passkey on this device (a guest's player moves over, as
  // with logIn). Null when the person dismisses the prompt.
  logInWithPasskey(): Promise<PublicUser | null>;
  listPasskeys(): Promise<PasskeyInfo[]>;
  deletePasskey(id: string): Promise<void>;
  // Deletes the account for good, then signs out on this device.
  deleteAccount(): Promise<void>;
  logOut(): Promise<void>;
  setPassword(password: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<PublicUser>;
  // Admins only: a one-time set-password link for the account with `email`.
  createResetLink(email: string): Promise<string>;
  // The first admin proves they run the server with its bootstrap token.
  claimAdmin(token: string): Promise<void>;
  // Resolves when everything written so far has been attempted on storage.
  persisted(): Promise<void>;
};

const randomUuid = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Insecure contexts (plain http on a LAN) have no randomUUID.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(
    16,
    20
  )}-${h.slice(20)}`;
};

const randomSecret = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const browserNetwork: NetworkSignal = {
  isOnline: () =>
    typeof navigator === "undefined" || navigator.onLine !== false,
  subscribe(onChange) {
    if (typeof window === "undefined") return () => {};
    const onVisible = () => {
      if (document.visibilityState === "visible") onChange();
    };
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  },
};

function defaultDeps(): SyncDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    openStorage: () => openStorage(),
    now: () => Date.now(),
    uuid: randomUuid,
    secret: randomSecret,
    network: browserNetwork,
    passkeys: browserPasskeys,
    apiBase: API_BASE,
    backoff: { minMs: 1000, maxMs: 30_000 },
    batchSize: 50,
    maxBatchBytes: 200_000,
    streamGraceMs: 500,
    healthyMs: 5000,
    storageTimeoutMs: 5000,
    quickDismissMs: 300,
  };
}

const copyData = (data: DataState): DataState => ({
  players: new Map(data.players),
  games: new Map(data.games),
  seats: new Map(data.seats),
  rounds: new Map(data.rounds),
  turns: new Map(data.turns),
});

const encoder = new TextEncoder();
const actionBytes = (action: Action) =>
  encoder.encode(JSON.stringify(action)).length;

const UNSYNCED_MESSAGE =
  "Couldn't sync your changes yet. Try again when you have signal.";

type Domain = "snapshot" | "pending" | "session";

export function createSyncClient(
  overrides: Partial<SyncDeps> = {}
): SyncClient {
  const deps: SyncDeps = { ...defaultDeps(), ...overrides };
  const transport = createTransport({
    fetch: deps.fetch,
    base: deps.apiBase,
    requestTimeoutMs: deps.requestTimeoutMs,
    streamIdleMs: deps.streamIdleMs,
  });

  // ── State ───────────────────────────────────────────────────────────────
  // view = snapshot (server rows at `version`) + pending actions re-applied.
  let storage: SyncStorage | undefined;
  let snapshot = createMemoryState();
  let version = 0;
  let pending: PendingEntry[] = [];
  let lastAt = 0;
  let counter = 0;
  let session: Session | null = null;
  let view = createMemoryState();

  let hydrated = false;
  let firstPull = false;
  let status: ConnectionStatus = "connecting";
  let health: StorageHealth = "ok";
  let loading = true;
  let auth: AuthState = { isLoading: true, user: null };

  const listeners = new Set<() => void>();
  const rejectionListeners = new Set<(rejection: ActionRejection) => void>();

  let resolveReady: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  let hydrating: Promise<void> | null = null;
  let starting: Promise<void> | null = null;
  let everStarted = false;
  let running = false;
  // Bumped by stop(): work started before it must not touch state after it.
  let epoch = 0;
  let stopNetwork = () => {};

  // ── Persistence ─────────────────────────────────────────────────────────
  // Writes run one after another, in call order. A write that fails marks
  // its domain dirty; the next write to it (or a periodic retry) rewrites the
  // whole domain from memory, so a gap never leaves storage half-updated.

  let writes: Promise<void> = Promise.resolve();
  const dirty = new Set<Domain>();
  let healTimer: ReturnType<typeof setTimeout> | undefined;

  const fullChangeSet = (): ChangeSet => {
    const puts: Record<string, unknown[]> = {};
    for (const table of TABLES) puts[table] = [...snapshot[table].values()];
    return { version, reset: true, puts, deletes: {} } as ChangeSet;
  };
  const repairs: Record<Domain, () => Promise<void>> = {
    snapshot: () => storage!.applyChanges(fullChangeSet()),
    pending: () => storage!.replacePending(pending),
    session: () => storage!.setSession(session),
  };

  // `incremental` writes just the change; if any of the domains is dirty
  // (an earlier write failed) they are rewritten whole from memory instead.
  function save(domains: Domain | Domain[], incremental: () => Promise<void>) {
    const list = Array.isArray(domains) ? domains : [domains];
    return (writes = writes.then(async () => {
      try {
        if (!list.some((d) => dirty.has(d))) await incremental();
        else if (list.includes("session") && list.includes("pending")) {
          await storage!.replaceSessionAndPending(session, pending);
        } else for (const d of list) await repairs[d]();
        list.forEach((d) => dirty.delete(d));
      } catch {
        list.forEach((d) => dirty.add(d));
      }
      updateHealth();
    }));
  }
  const savePending = (write: () => Promise<void>) => save("pending", write);
  const saveSession = (next: Session | null) =>
    save("session", () => storage!.setSession(next));

  function updateHealth() {
    const next: StorageHealth = !storage?.persistent
      ? storage
        ? "memory"
        : "ok"
      : dirty.size
      ? "failing"
      : "ok";
    if (next !== health) {
      health = next;
      notify();
    }
    if (dirty.size && !healTimer) {
      healTimer = setTimeout(() => {
        healTimer = undefined;
        for (const domain of [...dirty]) save(domain, repairs[domain]);
      }, deps.backoff.maxMs);
    }
  }

  // ── Derived view ────────────────────────────────────────────────────────

  function entryContext(entry: PendingEntry): ActionContext {
    const user = session?.user.id === entry.userId ? session.user : null;
    return {
      userId: entry.userId,
      isGuest: user ? user.isGuest : entry.isGuest,
      isAdmin: !!user?.isAdmin,
      now: entry.action.clientTime ?? new Date(0).toISOString(),
    };
  }

  function buildView(): DataState {
    const next = copyData(snapshot);
    const read = memoryReadState(next);
    for (const entry of pending) {
      try {
        applyOps(next, applyAction(read, entry.action, entryContext(entry)));
      } catch {
        // No longer valid on top of newer data. Stays queued (and out of the
        // view) until the server answers.
      }
    }
    return next;
  }

  const hasData = () =>
    pending.length > 0 || TABLES.some((table) => snapshot[table].size > 0);

  function notify() {
    loading = !hydrated || !(hasData() || firstPull || status === "offline");
    const user = session?.user ?? null;
    if (auth.isLoading === hydrated || auth.user !== user) {
      auth = { isLoading: !hydrated, user };
    }
    for (const listener of [...listeners]) listener();
  }

  function rebuild() {
    view = buildView();
    notify();
  }

  function setStatus(next: ConnectionStatus) {
    if (status === next) return;
    status = next;
    notify();
  }

  function emitRejected(rejection: ActionRejection) {
    for (const listener of [...rejectionListeners]) listener(rejection);
  }

  // ── Snapshot ────────────────────────────────────────────────────────────

  const versionWaiters = new Set<{ target: number; resolve: () => void }>();

  // Removes entries from the queue. `reportAs` tells the UI about the ones
  // the server never acked (they are lost).
  function dropPending(
    test: (entry: PendingEntry) => boolean,
    reportAs?: { code: string; error: string }
  ) {
    const gone = pending.filter(test);
    if (!gone.length) return false;
    pending = pending.filter((entry) => !gone.includes(entry));
    savePending(() => storage!.deletePending(gone.map((entry) => entry.id)));
    if (reportAs) {
      for (const entry of gone) {
        if (entry.ackVersion === undefined) {
          emitRejected({ action: entry.action, ...reportAs });
        }
      }
    }
    return true;
  }

  // Acked actions leave the queue only once the snapshot contains them.
  const pruneAcked = () =>
    dropPending((e) => e.ackVersion !== undefined && e.ackVersion <= version);

  // `pulledSince` is set for a pull's answer, which can arrive late. Stream
  // events come in order, so they are never stale.
  function receive(changes: ChangeSet, pulledSince?: number) {
    let lost: PendingEntry[] = [];
    if (changes.reset) {
      if (pulledSince !== undefined && changes.version < version) {
        // An older snapshot than we hold: a slow pull overtaken by the
        // stream, unless the server really is behind what we asked for
        // (restored from a backup) and nothing newer arrived meanwhile.
        const serverBehind =
          pulledSince > 0 &&
          changes.version < pulledSince &&
          version === pulledSince;
        if (!serverBehind) return;
      }
      snapshot = createMemoryState();
      // Actions acked at versions the server no longer has must go again.
      lost = pending.filter(
        (e) => e.ackVersion !== undefined && e.ackVersion > changes.version
      );
      for (const entry of lost) delete entry.ackVersion;
    } else if (changes.version <= version) {
      return;
    }
    for (const table of TABLES) {
      const rows = snapshot[table] as Map<string, { id: string }>;
      for (const row of changes.puts[table] ?? []) rows.set(row.id, row);
      for (const id of changes.deletes[table] ?? []) rows.delete(id);
    }
    version = changes.version;
    save("snapshot", () => storage!.applyChanges(changes));
    if (lost.length) savePending(() => storage!.putPending(lost));
    pruneAcked();
    rebuild();
    for (const waiter of [...versionWaiters]) {
      if (version >= waiter.target) waiter.resolve();
    }
    if (lost.length) void push();
  }

  function waitForVersion(target: number, ms: number) {
    return new Promise<void>((resolve) => {
      const waiter = { target, resolve: () => {} };
      const timer = setTimeout(() => waiter.resolve(), ms);
      waiter.resolve = () => {
        clearTimeout(timer);
        versionWaiters.delete(waiter);
        resolve();
      };
      versionWaiters.add(waiter);
    });
  }

  // One pull at a time: callers share it and its result is applied once.
  let pulling: Promise<void> | null = null;
  function pullNow(): Promise<void> {
    if (pulling) return pulling;
    const since = version;
    const myEpoch = epoch;
    const pull = transport.pull(since).then((changes) => {
      if (myEpoch === epoch) receive(changes, since);
    });
    pulling = pull;
    const clear = () => {
      if (pulling === pull) pulling = null;
    };
    pull.then(clear, clear);
    return pull;
  }

  // Make sure the snapshot reaches `target` (a push response's version):
  // give the stream a moment, then pull.
  async function catchUp(target: number) {
    if (version >= target) return;
    if (status === "connected")
      await waitForVersion(target, deps.streamGraceMs);
    for (let i = 0; i < 2 && version < target && running; i++) {
      try {
        await pullNow();
      } catch {
        return; // the connection loop will catch up; acked actions stay queued
      }
    }
  }

  // ── Connection: pull, then stream, reconnecting with backoff ────────────

  let attempt = 0;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let healthyTimer: ReturnType<typeof setTimeout> | undefined;
  let stream: StreamHandle | null = null;

  const delayFor = (failureCount: number) =>
    Math.min(
      deps.backoff.maxMs,
      deps.backoff.minMs * 2 ** Math.max(0, failureCount - 1)
    );

  function closeStream() {
    stream?.close();
    stream = null;
  }

  // `force` tries even if the browser says we're offline, which it gets wrong
  // on captive portals and flaky mobile data.
  function connect(force = false) {
    if (!running) return;
    clearTimeout(retryTimer);
    closeStream();
    const id = ++attempt;
    if (!deps.network.isOnline()) {
      setStatus("offline");
      if (!force) {
        retryTimer = setTimeout(() => connect(true), deps.backoff.maxMs);
        return;
      }
    }
    void (async () => {
      try {
        await pullNow();
      } catch (error) {
        if (id === attempt) fail(error, "pull");
        return;
      }
      if (id !== attempt) return;
      // The server answered, so we're connected even if the stream is blocked
      // (then we poll, at the reconnect rate).
      firstPull = true;
      setStatus("connected");
      notify();
      void checkSession();
      stream = transport.openStream(
        version,
        (changes) => id === attempt && receive(changes),
        (event, error) => {
          if (id !== attempt) return;
          if (event === "open") {
            clearTimeout(healthyTimer);
            healthyTimer = setTimeout(() => (failures = 0), deps.healthyMs);
            void push();
          } else {
            fail(error, "stream");
          }
        }
      );
    })();
  }

  function fail(error: unknown, kind: "pull" | "stream") {
    closeStream();
    clearTimeout(healthyTimer);
    failures += 1;
    // A failed pull after being connected is "connecting" until a retry
    // fails too. A stream that fails after a good pull keeps us connected.
    if (kind === "pull") {
      setStatus(status === "connected" ? "connecting" : "offline");
    }
    const limited = error instanceof SyncError && error.status === 429;
    clearTimeout(retryTimer);
    if (deps.network.isOnline()) {
      // Rate limited: wait longer than a plain failure would.
      retryTimer = setTimeout(
        () => connect(),
        delayFor(limited ? failures + 2 : failures)
      );
    } else {
      retryTimer = setTimeout(() => connect(true), deps.backoff.maxMs);
    }
  }

  function onNetworkChange() {
    if (!running) return;
    if (deps.network.isOnline()) {
      failures = 0;
      pushFailures = 0;
      materialiseFailures = 0;
      materialiseBlockedUntil = 0;
    } else {
      setStatus("offline");
    }
    connect(true);
    void push();
  }

  // Asks the server whether our session still exists. Only a 401 for the same
  // token counts as revoked; the queue is kept either way.
  async function checkSession() {
    const checked = session;
    if (!checked?.token) return;
    const myEpoch = epoch;
    try {
      const { user } = await transport.get<{ user?: PublicUser }>(
        "/auth/me",
        checked.token
      );
      if (myEpoch !== epoch || session?.token !== checked.token) return;
      if (
        user &&
        user.id === checked.user.id &&
        (user.email !== checked.user.email ||
          user.isGuest !== checked.user.isGuest ||
          !!user.isAdmin !== !!checked.user.isAdmin ||
          user.hasPassword !== checked.user.hasPassword ||
          user.passkeyCount !== checked.user.passkeyCount ||
          !!user.hasApple !== !!checked.user.hasApple)
      ) {
        session = { token: checked.token, user };
        saveSession(session);
        rebuild();
      }
    } catch (error) {
      if (
        error instanceof SyncError &&
        error.status === 401 &&
        myEpoch === epoch &&
        session?.token === checked.token
      ) {
        setSession(null);
      }
    }
  }

  // ── Push ────────────────────────────────────────────────────────────────

  let pushing = false;
  let pushDone: Promise<void> = Promise.resolve();
  let pushFailures = 0;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  // Shrinks when the server says a batch is too big, grows back as pushes work.
  let batchLimit = Infinity;
  const sizes = new WeakMap<PendingEntry, number>();

  const unacked = () =>
    pending.filter((entry) => entry.ackVersion === undefined);
  const reachable = () => deps.network.isOnline() || status === "connected";
  const canPush = () =>
    running &&
    hydrated &&
    !!session?.token &&
    (deps.network.isOnline() || status === "connected");

  // The oldest unacked actions, within the count and byte limits (always at
  // least one).
  function nextBatch() {
    const limit = Math.min(batchLimit, deps.batchSize);
    const batch: PendingEntry[] = [];
    let bytes = 0;
    for (const entry of pending) {
      if (entry.ackVersion !== undefined) continue;
      let size = sizes.get(entry);
      if (size === undefined)
        sizes.set(entry, (size = actionBytes(entry.action)));
      if (
        batch.length &&
        (batch.length >= limit || bytes + size > deps.maxBatchBytes)
      ) {
        break;
      }
      batch.push(entry);
      bytes += size;
    }
    return batch;
  }

  function push(): Promise<void> {
    if (pushing) return pushDone;
    clearTimeout(pushTimer);
    pushDone = pushLoop();
    return pushDone;
  }

  function schedulePushRetry() {
    pushFailures += 1;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void push(), delayFor(pushFailures));
  }

  async function pushLoop() {
    pushing = true;
    const myEpoch = epoch;
    try {
      if (session?.provisional && running && reachable()) {
        // Get a real session first (the queue waits).
        if (!(await tryMaterialise()) || myEpoch !== epoch) return;
      }
      while (canPush() && myEpoch === epoch) {
        const batch = nextBatch();
        if (!batch.length) return;
        const token = session!.token!;
        let response: PushResponse;
        try {
          response = await transport.push(
            batch.map((entry) => entry.action),
            token
          );
        } catch (error) {
          if (myEpoch !== epoch) return;
          if (pushRefused(error, batch, token)) continue;
          return;
        }
        if (myEpoch !== epoch) return;
        if (!handlePushResponse(batch, response)) {
          schedulePushRetry();
          return;
        }
        pushFailures = 0;
        batchLimit = Math.min(deps.batchSize, batchLimit * 2);
      }
    } catch {
      // Whatever went wrong, the queue stays and we try again.
      if (myEpoch === epoch) schedulePushRetry();
    } finally {
      if (myEpoch === epoch) pushing = false;
    }
  }

  // Handles a failed push request. Returns true when the loop can go straight
  // on (the batch was split or a hopeless action dropped).
  function pushRefused(error: unknown, batch: PendingEntry[], token: string) {
    const code = error instanceof SyncError ? error.status : undefined;
    if (code === 401) {
      // The server no longer knows this session (unless it has changed since
      // the request). Keep the queue; signing in again as the same user
      // resumes it.
      if (session?.token === token) setSession(null);
      return false;
    }
    if (code === 413 || code === 400) {
      if (batch.length > 1) {
        batchLimit = Math.max(1, Math.floor(batch.length / 2));
        return true;
      }
      const tooLarge = code === 413;
      dropPending((e) => e === batch[0]);
      rebuild();
      emitRejected({
        action: batch[0].action,
        code: tooLarge ? "too_large" : "invalid",
        error: tooLarge
          ? "That change was too big to save."
          : "The server couldn't accept that change.",
      });
      return true;
    }
    schedulePushRetry();
    return false;
  }

  // Applies the server's per-action answers. Returns false if the batch should
  // be retried after a backoff (a server error, or an answer that skips it).
  function handlePushResponse(batch: PendingEntry[], response: PushResponse) {
    const byId = new Map(batch.map((entry) => [entry.action.id, entry]));
    const acked: PendingEntry[] = [];
    const rejected: ActionRejection[] = [];
    const rejectedEntries: PendingEntry[] = [];
    let retry = false;
    for (const result of response.results) {
      const entry = byId.get(result.id);
      if (!entry || !pending.includes(entry)) continue;
      if (!result.ok && result.code === "server_error") {
        // Not the action's fault. Later results may depend on it, so stop
        // here and send it all again.
        retry = true;
        break;
      }
      if (result.ok) {
        entry.ackVersion = response.version;
        acked.push(entry);
      } else {
        rejectedEntries.push(entry);
        rejected.push({
          action: entry.action,
          error: result.error,
          code: result.code,
        });
      }
    }
    if (!acked.length && !rejected.length) {
      return !retry && !batch.some((e) => pending.includes(e));
    }

    if (acked.length) savePending(() => storage!.putPending(acked));
    dropPending((entry) => rejectedEntries.includes(entry));
    const pruned = pruneAcked();
    if (rejected.length || pruned) rebuild();
    rejected.forEach(emitRejected);
    void catchUp(response.version);
    return !retry;
  }

  // ── Session ─────────────────────────────────────────────────────────────

  function setSession(next: Session | null, queueMoved = false) {
    session = next;
    if (queueMoved) {
      save(["session", "pending"], () =>
        storage!.replaceSessionAndPending(next, pending)
      );
    } else {
      saveSession(next);
    }
    if (next) {
      dropPending((entry) => entry.userId !== next.user.id, {
        code: "signed_out",
        error: "You signed in as someone else before this change was saved.",
      });
    }
    rebuild();
    if (next) {
      pushFailures = 0;
      void push();
    }
  }

  // Turns a provisional guest (made offline) into a real one. The server takes
  // our id if it's free; if not we get a fresh guest and the queued actions are
  // moved over to its id. Network errors propagate and nothing changes.
  let materialising: Promise<void> | null = null;
  function materialise(): Promise<void> {
    return (materialising ??= doMaterialise().finally(() => {
      materialising = null;
    }));
  }

  async function doMaterialise() {
    const provisional = session;
    if (!provisional?.provisional) return;
    let response: AuthResponse;
    try {
      response = await transport.post<AuthResponse>(
        "/auth/guest",
        { id: provisional.user.id, secret: provisional.secret },
        undefined,
        isAuthResponse
      );
    } catch (error) {
      // Only a definite "that id isn't yours" gets a new identity.
      if (
        !(error instanceof SyncError) ||
        (error.code !== "id_taken" && error.code !== "invalid_id")
      ) {
        throw error;
      }
      response = await transport.post<AuthResponse>(
        "/auth/guest",
        {},
        undefined,
        isAuthResponse
      );
    }
    if (session !== provisional) return; // signed out or in meanwhile
    const moved = response.user.id !== provisional.user.id;
    if (moved) moveQueue(provisional.user.id, response.user.id);
    materialiseFailures = 0;
    // The session and the moved queue are saved together.
    setSession({ token: response.token, user: response.user }, moved);
  }

  // Backed-off attempts, for the background: a registration that fails waits
  // before the next, however many actions are dispatched meanwhile. Resolves
  // true once the guest is real.
  let materialiseFailures = 0;
  let materialiseBlockedUntil = 0;
  let materialiseTimer: ReturnType<typeof setTimeout> | undefined;
  async function tryMaterialise(): Promise<boolean> {
    if (!session?.provisional) return true;
    const wait = materialiseBlockedUntil - Date.now();
    if (wait > 0) {
      // (Re)arm the timer: the one set earlier may fire a hair too soon.
      clearTimeout(materialiseTimer);
      materialiseTimer = setTimeout(() => void push(), wait + 1);
      return false;
    }
    try {
      await materialise();
      return !session?.provisional;
    } catch (error) {
      const limited = error instanceof SyncError && error.status === 429;
      materialiseFailures += limited ? 3 : 1;
      const delay = delayFor(materialiseFailures);
      materialiseBlockedUntil = Date.now() + delay;
      clearTimeout(materialiseTimer);
      materialiseTimer = setTimeout(() => void push(), delay + 1);
      return false;
    }
  }

  // Re-attributes queued actions to another user id, including ids that
  // actions carry in their arguments.
  function moveQueue(from: string, to: string) {
    for (const entry of pending) {
      if (entry.userId !== from) continue;
      entry.userId = to;
      sizes.delete(entry);
      const { action } = entry;
      if (action.name === "importGame") {
        const args = action.args as ActionArgs["importGame"];
        if (args.game?.createdBy === from) {
          entry.action = {
            ...action,
            args: { ...args, game: { ...args.game, createdBy: to } },
          } as Action;
        }
      }
    }
  }

  // A real session, for things only the server can do.
  async function ensureReal() {
    await begin();
    if (!session?.provisional) return;
    if (!deps.network.isOnline())
      throw new SyncError(OFFLINE_MESSAGE, "offline");
    await materialise();
  }

  async function authRequest<T = AuthResponse>(
    path: string,
    body: unknown,
    token?: string,
    validate: ((json: any) => boolean) | null = isAuthResponse
  ) {
    await begin();
    if (!deps.network.isOnline())
      throw new SyncError(OFFLINE_MESSAGE, "offline");
    return transport.post<T>(path, body, token, validate ?? undefined);
  }

  const adopt = (response: AuthResponse) => {
    setSession({ token: response.token, user: response.user });
    return response.user;
  };

  // ── Lifecycle ───────────────────────────────────────────────────────────

  const orMemory = <T>(promise: Promise<T>, ms: number, fallback: () => T) =>
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(fallback()), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          resolve(fallback());
        }
      );
    });

  async function hydrate() {
    storage = await orMemory(
      deps.openStorage(),
      deps.storageTimeoutMs,
      createMemoryStorage
    );
    let stored: StoredState;
    try {
      stored = await storage.load();
    } catch {
      // Unreadable: never write over it. Carry on in memory.
      storage = createMemoryStorage();
      stored = await storage.load();
    }
    snapshot = stored.data;
    version = stored.version;
    pending = stored.pending;
    for (const entry of pending) {
      lastAt = Math.max(lastAt, entry.at);
      counter = Math.max(counter, entry.n);
    }
    session = stored.session;
    if (session) {
      dropPending((entry) => entry.userId !== session!.user.id, {
        code: "signed_out",
        error: "You signed in as someone else before this change was saved.",
      });
    }
    pruneAcked();
    view = buildView();
    hydrated = true;
    health = storage.persistent ? "ok" : "memory";
    resolveReady();
    notify();
  }

  const begin = () => (everStarted ? hydrating! : start());

  function start(): Promise<void> {
    if (starting) return starting;
    everStarted = true;
    const myEpoch = epoch;
    return (starting = (async () => {
      await (hydrating ??= hydrate());
      if (myEpoch !== epoch) return;
      running = true;
      stopNetwork = deps.network.subscribe(onNetworkChange);
      connect(true);
      void push();
    })());
  }

  function stop() {
    running = false;
    epoch += 1;
    attempt += 1;
    starting = null;
    pushing = false;
    pulling = null;
    stopNetwork();
    stopNetwork = () => {};
    clearTimeout(retryTimer);
    clearTimeout(pushTimer);
    clearTimeout(materialiseTimer);
    clearTimeout(healthyTimer);
    clearTimeout(healTimer);
    healTimer = undefined;
    closeStream();
    for (const waiter of [...versionWaiters]) waiter.resolve();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async function dispatch<N extends ActionName>(name: N, args: ActionArgs[N]) {
    await begin();
    const user = session?.user;
    if (!user) throw new ActionError("Sign in to do that.", "not_signed_in");
    const nowMs = deps.now();
    const now = new Date(nowMs).toISOString();
    const action = { id: deps.uuid(), name, args, clientTime: now } as Action;
    // Throws the ActionError if this isn't valid on top of what we have.
    const ops = applyAction(memoryReadState(view), action, {
      userId: user.id,
      isGuest: user.isGuest,
      isAdmin: !!user.isAdmin,
      now,
    });
    lastAt = Math.max(lastAt, nowMs);
    const entry: PendingEntry = {
      id: action.id,
      at: lastAt,
      n: ++counter,
      userId: user.id,
      isGuest: user.isGuest,
      action,
    };
    pending.push(entry);
    // Same result as rebuilding, since this action goes last.
    const next = copyData(view);
    applyOps(next, ops);
    view = next;
    notify();
    // If this write fails, getStorageHealth() turns "failing" and notifies.
    const saved = savePending(() => storage!.putPending([entry]));
    void push();
    await saved;
  }

  // The guest session to hand over when signing in as someone else. Its
  // queued work goes up under the guest before we leave it. If it can't, stay
  // a guest rather than lose it.
  async function guestToHandOver() {
    const guest = session?.user.isGuest ? session : null;
    if (guest && unacked().length) {
      await push();
      if (unacked().length) throw new SyncError(UNSYNCED_MESSAGE, "unsynced");
    }
    return guest;
  }

  async function logIn(email: string, password: string) {
    await ensureReal();
    if (!deps.network.isOnline())
      throw new SyncError(OFFLINE_MESSAGE, "offline");
    const guest = await guestToHandOver();
    return adopt(
      await authRequest("/auth/login", {
        email,
        password,
        guestToken: guest?.token ?? undefined,
      })
    );
  }

  // What the server sends before a passkey prompt.
  type Ceremony = { challengeId: string; options: any };
  // `token`: the session it was asked for, or null for a new account.
  type Prepared = Ceremony & { at: number; token: string | null };
  const isCeremony = (json: any) =>
    typeof json.challengeId === "string" &&
    typeof json.options === "object" &&
    json.options !== null;
  const PASSKEY_PATH = {
    login: "/auth/passkey/login/options",
    register: "/auth/passkey/register/options",
  };
  // The server keeps a challenge for 5 minutes.
  const PREPARED_MS = 4 * 60 * 1000;

  // Options fetched ahead of the tap, one per kind. Safari opens a passkey
  // prompt only close to the user's tap, so nothing slow may sit between them.
  const prepared: Partial<Record<"login" | "register", Prepared>> = {};
  const preparing: Partial<Record<"login" | "register", Promise<void>>> = {};
  const usable = (p: Prepared | undefined, token: string | null) =>
    !!p && p.token === token && deps.now() - p.at < PREPARED_MS;

  async function fetchCeremony(
    kind: "login" | "register",
    token: string | null
  ): Promise<Prepared> {
    const got = await authRequest<Ceremony>(
      PASSKEY_PATH[kind],
      {},
      token ?? undefined,
      isCeremony
    );
    return { ...got, at: deps.now(), token };
  }

  function preparePasskey(kind: "login" | "register"): Promise<void> {
    return (preparing[kind] ??= (async () => {
      try {
        await begin();
        await deps.passkeys.preload?.();
        // Registering as a session needs it to be real; one that isn't yet
        // (made offline) waits for the tap.
        const mode = kind === "register" ? registerMode() : undefined;
        if (mode?.waits) return;
        const token = mode ? mode.token : null;
        if (usable(prepared[kind], token) || !deps.network.isOnline()) return;
        prepared[kind] = await fetchCeremony(kind, token);
      } catch {
        // The tap asks again, and reports what went wrong.
      } finally {
        delete preparing[kind];
      }
    })());
  }

  // Does this guest have anything worth keeping?
  const worthKeeping = (userId: string) =>
    pending.some((entry) => entry.userId === userId) ||
    [...view.players.values()].some((p) => p.claimedBy === userId) ||
    [...view.games.values()].some((g) => g.createdBy === userId);

  // What a passkey registration would do right now. An account, or a guest with
  // something to keep, is added to or upgraded in place (`token`: its session).
  // Anyone else, including a guest with nothing, gets a new account (token
  // null) and the old empty guest is simply left behind.
  function registerMode(): { token: string | null; waits: boolean } {
    const here = session;
    if (!here || (here.user.isGuest && !worthKeeping(here.user.id))) {
      return { token: null, waits: false };
    }
    return { token: here.token, waits: !here.token };
  }

  // Shows the browser's passkey prompt. Null when the person dismisses it. A
  // refusal that comes straight back wasn't the person: the browser couldn't
  // open the prompt (Safari does that when it isn't close enough to a tap).
  async function prompt<T>(ask: () => Promise<T>): Promise<T | null> {
    const asked = deps.now();
    try {
      return await ask();
    } catch (error) {
      if (!isCancelled(error)) throw passkeyError(error);
      if (deps.now() - asked < deps.quickDismissMs) {
        throw new SyncError(
          "Couldn't open the passkey prompt. Try again.",
          "prompt_failed"
        );
      }
      return null;
    }
  }

  // The first thing a tap does is open the prompt: with options ready this
  // has no await before it.
  async function logInWithPasskey() {
    const taken = prepared.login;
    delete prepared.login;
    let ready = usable(taken, null) ? taken! : undefined;
    if (!ready) {
      await begin();
      if (!deps.network.isOnline())
        throw new SyncError(OFFLINE_MESSAGE, "offline");
      ready = await fetchCeremony("login", null);
    }
    const { challengeId, options } = ready;
    const response = await prompt(() => deps.passkeys.get(options));
    if (!response) return null;
    // Only now the slow part: a guest's work goes up before it is handed over.
    await ensureReal();
    if (!deps.network.isOnline())
      throw new SyncError(OFFLINE_MESSAGE, "offline");
    const guest = await guestToHandOver();
    return adopt(
      await authRequest("/auth/passkey/login/verify", {
        challengeId,
        response,
        guestToken: guest?.token ?? undefined,
      })
    );
  }

  async function registerPasskey(name?: string) {
    let mode = registerMode();
    const taken = prepared.register;
    delete prepared.register;
    let ready = !mode.waits && usable(taken, mode.token) ? taken : undefined;
    if (!ready) {
      if (mode.waits) {
        // A guest made offline, with work to keep: it has to be real first.
        await ensureReal();
        mode = registerMode();
      }
      ready = await fetchCeremony("register", mode.token);
    }
    const token = mode.token;
    const { challengeId, options } = ready;
    const response = await prompt(() => deps.passkeys.create(options));
    if (!response) return null;
    // The device now holds a passkey. If the server won't keep it, tell the
    // device to forget it.
    const orphan = () =>
      deps.passkeys.signalUnknown?.(options.rp?.id, response.id);
    // The prompt can stay open a long time.
    if (registerMode().token !== token) {
      orphan();
      throw new SyncError("Your session changed. Try again.", "not_signed_in");
    }
    const left = session;
    try {
      const done = adopt(
        await authRequest(
          "/auth/passkey/register/verify",
          { challengeId, response, name },
          token ?? undefined
        )
      );
      // A new account replaces an empty guest; end its session if it had one.
      if (!token && left?.token) {
        transport.post("/auth/logout", {}, left.token).catch(() => {});
      }
      return done;
    } catch (error) {
      // Any refusal (not a 5xx or lost connection: it may have been kept).
      if (
        error instanceof SyncError &&
        error.status !== undefined &&
        error.status >= 400 &&
        error.status < 500
      )
        orphan();
      throw error;
    }
  }

  return {
    ready,
    start,
    stop,
    dispatch,
    persisted: () => writes,
    onActionRejected(callback) {
      rejectionListeners.add(callback);
      return () => rejectionListeners.delete(callback);
    },
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    getView: () => view,
    isConfirmed: (table, id) => snapshot[table].has(id),
    getStatus: () => status,
    getStorageHealth: () => health,
    getAuth: () => auth,
    isLoading: () => loading,
    getPendingCount: () => pending.length,
    async signInAsGuest() {
      await begin();
      if (session) {
        if (session.provisional && reachable()) await tryMaterialise();
        return session.user;
      }
      // Known to be offline: don't wait for a request to fail.
      if (status !== "offline") {
        try {
          return adopt(await authRequest("/auth/guest", {}));
        } catch (error) {
          const down =
            error instanceof SyncError &&
            (error.status === 429 || (error.status ?? 0) >= 500);
          if (!isNetworkError(error) && !down) throw error;
        }
      }
      // No signal on first use: carry on as a guest that exists only here
      // until we can register it.
      const user: PublicUser = {
        id: deps.uuid(),
        email: null,
        isGuest: true,
        hasPassword: false,
        passkeyCount: 0,
      };
      setSession({
        token: null,
        user,
        provisional: true,
        secret: deps.secret(),
      });
      return user;
    },
    async signUp(email, password) {
      await ensureReal();
      const guestToken =
        (session?.user.isGuest ? session.token : undefined) ?? undefined;
      return adopt(
        await authRequest("/auth/signup", { email, password }, guestToken)
      );
    },
    logIn,
    async logOut() {
      await begin();
      const token = session?.token;
      dropPending(() => true, {
        code: "signed_out",
        error: "You logged out before this change was saved.",
      });
      setSession(null);
      if (token && deps.network.isOnline()) {
        transport.post("/auth/logout", {}, token).catch(() => {});
      }
    },
    registerPasskey,
    logInWithPasskey,
    preparePasskey,
    async addEmail(email, password) {
      await begin();
      if (!session?.token)
        throw new SyncError("Sign in first.", "not_signed_in");
      return adopt(
        await authRequest("/auth/email", { email, password }, session.token)
      );
    },
    async signOutOthers() {
      await begin();
      if (!session?.token)
        throw new SyncError("Sign in first.", "not_signed_in");
      await authRequest(
        "/auth/sessions/revoke-others",
        {},
        session.token,
        null
      );
    },
    async listPasskeys() {
      await begin();
      if (!session?.token)
        throw new SyncError("Sign in first.", "not_signed_in");
      const { passkeys } = await transport.get<{ passkeys?: PasskeyInfo[] }>(
        "/auth/passkeys",
        session.token
      );
      return passkeys ?? [];
    },
    async deletePasskey(id) {
      await begin();
      const asked = session;
      if (!asked?.token) throw new SyncError("Sign in first.", "not_signed_in");
      await transport.delete(
        `/auth/passkeys/${encodeURIComponent(id)}`,
        asked.token
      );
      // The passkey count is part of the user.
      await checkSession();
    },
    async deleteAccount() {
      await begin();
      const asked = session;
      if (!asked?.token) throw new SyncError("Sign in first.", "not_signed_in");
      if (!deps.network.isOnline())
        throw new SyncError(OFFLINE_MESSAGE, "offline");
      await transport.delete("/auth/me", asked.token, { confirm: "DELETE" });
      // A push that was in flight may have got a 401 and cleared the session
      // already; the deleted user's queue goes either way.
      dropPending((entry) => entry.userId === asked.user.id, {
        code: "signed_out",
        error: "You deleted your account before this change was saved.",
      });
      if (session?.token === asked.token) setSession(null);
    },
    async setPassword(password) {
      await begin();
      if (!session?.token)
        throw new SyncError("Sign in first.", "not_signed_in");
      await authRequest("/auth/password", { password }, session.token, null);
    },
    async resetPassword(token, password) {
      return adopt(await authRequest("/auth/reset", { token, password }));
    },
    async createResetLink(email) {
      await begin();
      if (!session?.token)
        throw new SyncError("Sign in first.", "not_signed_in");
      const { url } = await authRequest<{ url: string }>(
        "/auth/reset-link",
        { email },
        session.token,
        (json) => typeof json.url === "string"
      );
      return url;
    },
    async claimAdmin(token) {
      await begin();
      if (!session?.token)
        throw new SyncError("Sign in first.", "not_signed_in");
      const claimedBy = session;
      await authRequest("/auth/claim-admin", { token }, claimedBy.token!, null);
      // Show the new role now: ask the server, or assume it if we can't.
      if (session?.token !== claimedBy.token) return;
      await checkSession();
      if (session?.token === claimedBy.token && !session.user.isAdmin) {
        session = {
          token: session.token,
          user: { ...session.user, isAdmin: true },
        };
        saveSession(session);
        rebuild();
      }
    },
  };
}

export const sync = createSyncClient();
export const isConfirmed = sync.isConfirmed;
if (typeof window !== "undefined") void sync.start();
