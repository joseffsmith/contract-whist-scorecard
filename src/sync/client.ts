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
} from "../../shared/types";
import { BASE_PATH } from "../lib/paths";
import { openStorage } from "./storage";
import type { PendingEntry, Session, SyncStorage } from "./storage";
import { OFFLINE_MESSAGE, SyncError, createTransport } from "./transport";
import type { StreamHandle } from "./transport";

export type ConnectionStatus = "connected" | "connecting" | "offline";
export type AuthState = { isLoading: boolean; user: PublicUser | null };
export type ActionRejection = { action: Action; error: string; code: string };

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
  network: NetworkSignal;
  apiBase: string;
  backoff: { minMs: number; maxMs: number };
  batchSize: number;
  // How long to wait for the stream to deliver our own pushed changes before
  // pulling them.
  streamGraceMs: number;
  requestTimeoutMs?: number;
  streamIdleMs?: number;
};

export type SyncClient = {
  // Resolves once local data (snapshot, pending queue, session) is loaded.
  ready: Promise<void>;
  start(): Promise<void>;
  stop(): void;
  dispatch<N extends ActionName>(name: N, args: ActionArgs[N]): Promise<void>;
  onActionRejected(callback: (rejection: ActionRejection) => void): () => void;
  subscribe(callback: () => void): () => void;
  getView(): DataState;
  getStatus(): ConnectionStatus;
  getAuth(): AuthState;
  // True until hydrated and we have something to show (data, a first pull,
  // or no connection to wait for).
  isLoading(): boolean;
  getPendingCount(): number;
  signInAsGuest(): Promise<PublicUser>;
  signUp(email: string, password: string): Promise<PublicUser>;
  logIn(email: string, password: string): Promise<PublicUser>;
  logOut(): Promise<void>;
  setPassword(password: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<PublicUser>;
  // Resolves when everything written so far has reached storage.
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
    network: browserNetwork,
    apiBase: `${BASE_PATH}/api`,
    backoff: { minMs: 1000, maxMs: 30_000 },
    batchSize: 50,
    streamGraceMs: 500,
  };
}

const copyData = (data: DataState): DataState => ({
  players: new Map(data.players),
  games: new Map(data.games),
  seats: new Map(data.seats),
  rounds: new Map(data.rounds),
  turns: new Map(data.turns),
});

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
  let storage: SyncStorage;
  let snapshot = createMemoryState();
  let version = 0;
  let pending: PendingEntry[] = [];
  let nextSeq = 1;
  let session: Session | null = null;
  let view = createMemoryState();

  let hydrated = false;
  let firstPull = false;
  let status: ConnectionStatus = "connecting";
  let loading = true;
  let auth: AuthState = { isLoading: true, user: null };

  const listeners = new Set<() => void>();
  const rejectionListeners = new Set<(rejection: ActionRejection) => void>();

  let resolveReady: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));
  let starting: Promise<void> | null = null;
  let running = false;
  let stopNetwork = () => {};

  // Storage writes run one after another, in call order.
  let writes: Promise<void> = Promise.resolve();
  const persist = (write: () => Promise<void>) =>
    (writes = writes.then(write).catch(() => {}));

  // ── Derived view ────────────────────────────────────────────────────────

  function entryContext(entry: PendingEntry): ActionContext {
    const user = session?.user.id === entry.userId ? session.user : null;
    return {
      userId: entry.userId,
      isGuest: user ? user.isGuest : entry.isGuest,
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

  const hasData = () => TABLES.some((table) => snapshot[table].size > 0);

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

  // ── Snapshot ────────────────────────────────────────────────────────────

  const versionWaiters = new Set<{ target: number; resolve: () => void }>();

  function dropPending(test: (entry: PendingEntry) => boolean) {
    const gone = pending.filter(test);
    if (!gone.length) return false;
    pending = pending.filter((entry) => !gone.includes(entry));
    persist(() => storage.deletePending(gone.map((entry) => entry.seq)));
    return true;
  }

  // Acked actions leave the queue only once the snapshot contains them.
  const pruneAcked = () =>
    dropPending((e) => e.ackVersion !== undefined && e.ackVersion <= version);

  function receive(changes: ChangeSet) {
    if (!changes.reset && changes.version <= version) return;
    if (changes.reset) snapshot = createMemoryState();
    for (const table of TABLES) {
      const rows = snapshot[table] as Map<string, { id: string }>;
      for (const row of changes.puts[table] ?? []) rows.set(row.id, row);
      for (const id of changes.deletes[table] ?? []) rows.delete(id);
    }
    version = changes.version;
    persist(() => storage.applyChanges(changes));
    pruneAcked();
    rebuild();
    for (const waiter of [...versionWaiters]) {
      if (version >= waiter.target) waiter.resolve();
    }
  }

  function waitForVersion(target: number, ms: number) {
    return new Promise<void>((resolve) => {
      const waiter = { target, resolve: () => {} };
      const timer = setTimeout(waiter.resolve, ms);
      waiter.resolve = () => {
        clearTimeout(timer);
        versionWaiters.delete(waiter);
        resolve();
      };
      versionWaiters.add(waiter);
    });
  }

  // Make sure the snapshot reaches `target` (a push response's version):
  // give the stream a moment, then pull.
  async function catchUp(target: number) {
    if (version >= target) return;
    if (status === "connected")
      await waitForVersion(target, deps.streamGraceMs);
    if (version >= target || !running) return;
    try {
      receive(await transport.pull(version));
    } catch {
      // The connection loop will catch up; the acked actions stay queued.
    }
  }

  // ── Connection: pull, then stream, reconnecting with backoff ────────────

  let attempt = 0;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
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

  function connect() {
    if (!running) return;
    clearTimeout(retryTimer);
    closeStream();
    const id = ++attempt;
    if (!deps.network.isOnline()) return setStatus("offline");
    void (async () => {
      try {
        const changes = await transport.pull(version);
        if (id !== attempt) return;
        firstPull = true;
        receive(changes);
        notify();
        stream = transport.openStream(
          version,
          (cs) => id === attempt && receive(cs),
          (event) => {
            if (id !== attempt) return;
            if (event === "open") {
              failures = 0;
              setStatus("connected");
              void push();
            } else {
              fail();
            }
          }
        );
      } catch {
        if (id === attempt) fail();
      }
    })();
  }

  function fail() {
    closeStream();
    failures += 1;
    // A drop after being connected is "connecting" until the retry fails too.
    setStatus(status === "connected" ? "connecting" : "offline");
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, delayFor(failures));
  }

  function onNetworkChange() {
    if (!running) return;
    if (deps.network.isOnline()) {
      failures = 0;
      pushFailures = 0;
      connect();
      void push();
    } else {
      attempt += 1;
      clearTimeout(retryTimer);
      closeStream();
      setStatus("offline");
    }
  }

  // ── Push ────────────────────────────────────────────────────────────────

  let pushing = false;
  let pushDone: Promise<void> = Promise.resolve();
  let pushFailures = 0;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;

  const unacked = () =>
    pending.filter((entry) => entry.ackVersion === undefined);
  const canPush = () =>
    running && hydrated && !!session && deps.network.isOnline();

  function push(): Promise<void> {
    if (pushing) return pushDone;
    clearTimeout(pushTimer);
    pushDone = pushLoop();
    return pushDone;
  }

  async function pushLoop() {
    pushing = true;
    try {
      while (canPush()) {
        const batch = unacked().slice(0, deps.batchSize);
        if (!batch.length) return;
        let response: PushResponse;
        try {
          response = await transport.push(
            batch.map((entry) => entry.action),
            session!.token
          );
        } catch (error) {
          return pushFailed(error);
        }
        if (!handlePushResponse(batch, response)) {
          return pushFailed(new SyncError("Incomplete push response", "error"));
        }
        pushFailures = 0;
      }
    } finally {
      pushing = false;
    }
  }

  function pushFailed(error: unknown) {
    if (error instanceof SyncError && error.status === 401) {
      // The server no longer knows this session. Keep the queue; signing in
      // again as the same user resumes it.
      setSession(null);
      return;
    }
    pushFailures += 1;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void push(), delayFor(pushFailures));
  }

  // Returns false if the server answered none of the batch (avoids a hot loop).
  function handlePushResponse(batch: PendingEntry[], response: PushResponse) {
    const byId = new Map(batch.map((entry) => [entry.action.id, entry]));
    const acked: PendingEntry[] = [];
    const rejected: ActionRejection[] = [];
    const rejectedEntries: PendingEntry[] = [];
    for (const result of response.results) {
      const entry = byId.get(result.id);
      if (!entry || !pending.includes(entry)) continue;
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
    if (!acked.length && !rejected.length)
      return !batch.some((e) => pending.includes(e));

    if (acked.length) persist(() => storage.putPending(acked));
    dropPending((entry) => rejectedEntries.includes(entry));
    const pruned = pruneAcked();
    if (rejected.length || pruned) rebuild();
    for (const rejection of rejected) {
      for (const listener of [...rejectionListeners]) listener(rejection);
    }
    void catchUp(response.version);
    return true;
  }

  // ── Session ─────────────────────────────────────────────────────────────

  function setSession(next: Session | null) {
    session = next;
    persist(() => storage.setSession(next));
    if (next) dropPending((entry) => entry.userId !== next.user.id);
    rebuild();
    if (next) {
      pushFailures = 0;
      void push();
    }
  }

  async function authRequest(path: string, body: unknown, token?: string) {
    await start();
    if (!deps.network.isOnline())
      throw new SyncError(OFFLINE_MESSAGE, "offline");
    return transport.post<AuthResponse>(path, body, token);
  }

  const adopt = (response: AuthResponse) => {
    setSession({ token: response.token, user: response.user });
    return response.user;
  };

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async function hydrate() {
    storage = await deps.openStorage().catch(() => openStorage(null));
    const stored = await storage.load();
    snapshot = stored.data;
    version = stored.version;
    pending = stored.pending;
    nextSeq = pending.reduce((max, entry) => Math.max(max, entry.seq), 0) + 1;
    session = stored.session;
    if (session) dropPending((entry) => entry.userId !== session!.user.id);
    pruneAcked();
    view = buildView();
    hydrated = true;
    resolveReady();
    notify();
  }

  function start(): Promise<void> {
    starting ??= (async () => {
      await hydrate();
      running = true;
      stopNetwork = deps.network.subscribe(onNetworkChange);
      connect();
      void push();
    })();
    return starting;
  }

  function stop() {
    running = false;
    attempt += 1;
    stopNetwork();
    clearTimeout(retryTimer);
    clearTimeout(pushTimer);
    closeStream();
    for (const waiter of [...versionWaiters]) waiter.resolve();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  async function dispatch<N extends ActionName>(name: N, args: ActionArgs[N]) {
    await start();
    const user = session?.user;
    if (!user) throw new ActionError("Sign in to do that.", "not_signed_in");
    const now = new Date(deps.now()).toISOString();
    const action = { id: deps.uuid(), name, args, clientTime: now } as Action;
    // Throws the ActionError if this isn't valid on top of what we have.
    const ops = applyAction(memoryReadState(view), action, {
      userId: user.id,
      isGuest: user.isGuest,
      now,
    });
    const entry: PendingEntry = {
      seq: nextSeq++,
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
    const saved = persist(() => storage.putPending([entry]));
    void push();
    await saved;
  }

  async function logIn(email: string, password: string) {
    await start();
    const guestToken = session?.user.isGuest ? session.token : undefined;
    // The guest's queued work goes up under the guest before we leave it.
    if (guestToken && unacked().length && canPush()) await push();
    return adopt(
      await authRequest("/auth/login", { email, password, guestToken })
    );
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
    getStatus: () => status,
    getAuth: () => auth,
    isLoading: () => loading,
    getPendingCount: () => pending.length,
    async signInAsGuest() {
      await start();
      if (session) return session.user;
      return adopt(await authRequest("/auth/guest", {}));
    },
    async signUp(email, password) {
      await start();
      const guestToken = session?.user.isGuest ? session.token : undefined;
      return adopt(
        await authRequest("/auth/signup", { email, password }, guestToken)
      );
    },
    logIn,
    async logOut() {
      await start();
      const token = session?.token;
      dropPending(() => true);
      setSession(null);
      if (token && deps.network.isOnline()) {
        transport.post("/auth/logout", {}, token).catch(() => {});
      }
    },
    async setPassword(password) {
      await start();
      if (!session) throw new SyncError("Sign in first.", "not_signed_in");
      await authRequest("/auth/password", { password }, session.token);
    },
    async resetPassword(token, password) {
      return adopt(await authRequest("/auth/reset", { token, password }));
    },
  };
}

export const sync = createSyncClient();
if (typeof window !== "undefined") void sync.start();
