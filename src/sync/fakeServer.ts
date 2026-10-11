import {
  applyAction,
  applyOps,
  createMemoryState,
  memoryReadState,
} from "../../shared/actions";
import { ActionError, TABLES } from "../../shared/types";
import type {
  Action,
  ChangeSet,
  PublicUser,
  PushResponse,
  PushResult,
  RowOp,
  TableName,
  Tables,
} from "../../shared/types";

// A tiny in-memory stand-in for the real server, speaking the SPEC'd HTTP
// API through a stubbed `fetch`. For tests only.

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Account = PublicUser & { password?: string };

export function createFakeServer() {
  const data = createMemoryState();
  let version = 0;
  const rowVersions = new Map<string, number>(); // "table:id" -> version
  const tombstones = new Map<string, number>(); // "table:id" -> version
  const applied = new Map<string, number>(); // action id -> version
  const tokens = new Map<string, Account>();
  const accounts: Account[] = [];
  const streams = new Set<{
    send(text: string): void;
    end(error?: unknown): void;
  }>();
  let tokenCounter = 0;
  let userCounter = 0;
  const knownIds = new Set<string>();
  const guestSecrets = new Map<string, string>();
  // credential id -> owner, for the passkey endpoints
  const passkeys = new Map<string, { userId: string; name: string | null }>();
  let challengeCounter = 0;

  const server = {
    data,
    log: [] as string[], // ids of actions applied, in order
    requests: [] as {
      method: string;
      path: string;
      body?: any;
      token?: string;
    }[],
    offline: false, // every request fails like a dead network
    blockPush: false, // pushes answer 503
    loseNextPushResponse: false, // apply, then fail as if the reply was lost
    holdStream: false, // buffer stream events
    held: [] as string[],
    maxPushBytes: Infinity, // bigger push bodies get 413
    pushStatus: 0, // answer pushes with this status (e.g. 503) when set
    serverErrors: 0, // next N push results are { ok: false, code: "server_error" } (not applied)
    portal: false, // every answer is a 200 page of HTML, like a captive portal
    rateLimited: false, // pulls answer 429
    streamLimited: false, // streams answer 429
    dropStreams: false, // streams end right after their first event
    forceReset: false, // the next pull answers with a full snapshot
    guestFail: null as null | { status: number; code: string }, // /auth/guest answers this
    loseNextGuestResponse: false, // register the guest, then fail like a lost reply
    takenIds: new Set<string>(), // guest ids the server pretends are in use
    streamOpens: 0,
    pullCount: 0,

    get version() {
      return version;
    },

    // Another client's write, straight into the database.
    act(user: PublicUser, action: Action) {
      return runAction(user, action);
    },

    // Bulk-load rows as one version, bypassing the rules (for big fixtures).
    seed(ops: RowOp[]) {
      applyOps(data, ops);
      version += 1;
      const changes: ChangeSet = { version, puts: {}, deletes: {} };
      for (const op of ops) {
        if (op.op !== "put") continue;
        rowVersions.set(`${op.table}:${op.row.id}`, version);
        ((changes.puts[op.table] ??= []) as unknown[]).push(clean(op.row));
      }
      broadcast(changes);
    },

    addAccount(email: string, password: string, isGuest = false): PublicUser {
      const account = {
        id: `u-${++userCounter}`,
        email,
        isGuest,
        hasPassword: !isGuest,
        passkeyCount: 0,
        password,
      };
      knownIds.add(account.id);
      accounts.push(account);
      return {
        id: account.id,
        email,
        isGuest,
        hasPassword: !isGuest,
        passkeyCount: 0,
      };
    },

    tokenFor(user: PublicUser) {
      const token = `t-${++tokenCounter}`;
      tokens.set(token, user);
      return token;
    },

    // A copy of the database, to restore later (a server rolled back).
    backup() {
      return {
        version,
        rows: TABLES.map((t) => [t, [...data[t].entries()]] as const),
        rowVersions: new Map(rowVersions),
        tombstones: new Map(tombstones),
        applied: new Map(applied),
      };
    },

    restore(copy: ReturnType<typeof server.backup>) {
      for (const [table, entries] of copy.rows) {
        (data[table] as Map<string, unknown>).clear();
        for (const [id, row] of entries)
          (data[table] as Map<string, unknown>).set(id, row);
      }
      version = copy.version;
      rowVersions.clear();
      copy.rowVersions.forEach((v, k) => rowVersions.set(k, v));
      tombstones.clear();
      copy.tombstones.forEach((v, k) => tombstones.set(k, v));
      applied.clear();
      copy.applied.forEach((v, k) => applied.set(k, v));
      broadcast(snapshotChangeSet());
    },

    makeAdmin(userId: string) {
      for (const [token, u] of tokens) {
        if (u.id === userId) tokens.set(token, { ...u, isAdmin: true });
      }
      for (const account of accounts) {
        if (account.id === userId) account.isAdmin = true;
      }
    },

    forgetTokens() {
      tokens.clear();
    },

    cutStreams() {
      for (const stream of [...streams]) stream.end(new Error("cut"));
    },

    // A full snapshot to every stream (e.g. after a server restore).
    broadcastReset() {
      broadcast(snapshotChangeSet());
    },

    releaseStream() {
      server.holdStream = false;
      for (const text of server.held.splice(0)) {
        for (const stream of streams) stream.send(text);
      }
    },

    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (server.offline) throw new TypeError("Failed to fetch");
      const url = new URL(String(input), "http://fake");
      const path = url.pathname.replace(/^.*\/api/, "");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = new Headers(init?.headers);
      const auth = headers.get("authorization")?.replace(/^Bearer /, "");
      server.requests.push({ method, path, body, token: auth });

      if (server.portal) {
        return new Response("<html>Please sign in to the wifi</html>", {
          headers: { "content-type": "text/html" },
        });
      }
      if (path === "/sync/stream") {
        if (server.streamLimited) {
          return fail(429, "Too many open connections.", "too_many_streams");
        }
        server.streamOpens += 1;
        return openStream(Number(url.searchParams.get("since")), init?.signal);
      }
      return handle(
        method,
        path,
        url,
        body,
        auth,
        String(init?.body ?? "").length
      );
    }) as typeof fetch,
  };

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fail = (status: number, error: string, code: string) =>
    json(status, { error, code });

  function handle(
    method: string,
    path: string,
    url: URL,
    body: any,
    token?: string,
    size = 0
  ): Response {
    const user = token ? tokens.get(token) : undefined;
    const countPasskeys = (userId: string) =>
      [...passkeys.values()].filter((p) => p.userId === userId).length;
    if (method === "DELETE" && path.startsWith("/auth/passkeys/")) {
      if (!user) return fail(401, "Sign in to do that.", "not_signed_in");
      const id = decodeURIComponent(path.slice("/auth/passkeys/".length));
      if (passkeys.get(id)?.userId !== user.id)
        return fail(404, "No such passkey.", "not_found");
      passkeys.delete(id);
      return json(200, { ok: true });
    }
    switch (path) {
      case "/sync/pull":
        server.pullCount += 1;
        if (server.rateLimited)
          return fail(429, "Too many requests. Slow down.", "rate_limited");
        if (server.forceReset) {
          server.forceReset = false;
          return json(200, snapshotChangeSet());
        }
        return json(200, changesSince(Number(url.searchParams.get("since"))));
      case "/sync/push": {
        if (!user) return fail(401, "Sign in to do that.", "not_signed_in");
        if (server.blockPush) return fail(503, "Busy", "unavailable");
        if (server.pushStatus)
          return fail(server.pushStatus, "Nope.", "bad_request");
        if (size > server.maxPushBytes)
          return fail(413, "Request too large.", "too_large");
        const results: PushResult[] = (body.actions as Action[]).map(
          (action) => {
            if (server.serverErrors > 0) {
              server.serverErrors -= 1;
              return {
                id: action.id,
                ok: false as const,
                error: "Something went wrong. Try again.",
                code: "server_error",
              };
            }
            try {
              runAction(user, action);
              return { id: action.id, ok: true as const };
            } catch (error) {
              if (!(error instanceof ActionError)) throw error;
              return {
                id: action.id,
                ok: false as const,
                error: error.message,
                code: error.code,
              };
            }
          }
        );
        if (server.loseNextPushResponse) {
          server.loseNextPushResponse = false;
          throw new TypeError("Failed to fetch");
        }
        return json(200, { results, version } satisfies PushResponse);
      }
      case "/auth/guest": {
        if (server.guestFail) {
          return fail(server.guestFail.status, "No.", server.guestFail.code);
        }
        let id = `u-${++userCounter}`;
        if (body?.id !== undefined) {
          if (typeof body.id !== "string" || !UUID_V4.test(body.id)) {
            return fail(400, "Bad request.", "invalid_id");
          }
          const mine =
            typeof body.secret === "string" &&
            guestSecrets.get(body.id) === body.secret;
          if (
            !mine &&
            (server.takenIds.has(body.id) || knownIds.has(body.id))
          ) {
            return fail(409, "That id is already in use.", "id_taken");
          }
          id = body.id;
          if (typeof body.secret === "string")
            guestSecrets.set(id, body.secret);
        }
        knownIds.add(id);
        const guest = {
          id,
          email: null,
          isGuest: true,
          hasPassword: false,
          passkeyCount: 0,
        };
        const token = server.tokenFor(guest);
        if (server.loseNextGuestResponse) {
          server.loseNextGuestResponse = false;
          throw new TypeError("Failed to fetch");
        }
        return json(200, { token, user: guest });
      }
      case "/auth/signup": {
        if (accounts.some((a) => a.email === body.email)) {
          return fail(
            409,
            "That email already has an account. Log in instead.",
            "has_account"
          );
        }
        if (user?.isGuest) {
          const upgraded = {
            id: user.id,
            email: body.email as string,
            isGuest: false,
            hasPassword: true,
            passkeyCount: 0,
          };
          tokens.set(token!, upgraded);
          accounts.push({ ...upgraded, password: body.password });
          return json(200, { token: token!, user: upgraded });
        }
        const created = server.addAccount(body.email, body.password);
        return json(200, { token: server.tokenFor(created), user: created });
      }
      case "/auth/login": {
        const account = accounts.find(
          (a) => a.email === body.email && a.password === body.password
        );
        if (!account)
          return fail(401, "Wrong email or password.", "bad_credentials");
        const loggedIn = {
          id: account.id,
          email: account.email,
          isGuest: false,
          hasPassword: true,
          passkeyCount: countPasskeys(account.id),
          ...(account.isAdmin ? { isAdmin: true } : {}),
        };
        return json(200, { token: server.tokenFor(loggedIn), user: loggedIn });
      }
      case "/auth/me":
        if (!user) return fail(401, "Sign in to do that.", "not_signed_in");
        if (method === "DELETE") {
          if (body?.confirm !== "DELETE")
            return fail(400, "Type DELETE to confirm.", "confirm_required");
          for (const [t, u] of [...tokens])
            if (u.id === user.id) tokens.delete(t);
          for (const [id, p] of [...passkeys]) {
            if (p.userId === user.id) passkeys.delete(id);
          }
          const at = accounts.findIndex((a) => a.id === user.id);
          if (at >= 0) accounts.splice(at, 1);
          return json(200, { ok: true });
        }
        return json(200, {
          user: { ...user, passkeyCount: countPasskeys(user.id) },
        });
      case "/auth/claim-admin":
        if (!user) return fail(401, "Sign in to do that.", "not_signed_in");
        if (user.isGuest) return fail(403, "Create an account first.", "guest");
        if (body.token !== "bootstrap")
          return fail(403, "Wrong token.", "forbidden");
        server.makeAdmin(user.id);
        return json(200, { ok: true });
      case "/auth/logout":
        if (token) tokens.delete(token);
        return json(200, { ok: true });
      case "/auth/password":
        return user
          ? json(200, { ok: true })
          : fail(401, "Sign in to do that.", "not_signed_in");
      case "/auth/passkey/register/options":
        if (!user) return fail(401, "Sign in to do that.", "not_signed_in");
        return json(200, {
          challengeId: `c-${++challengeCounter}`,
          options: { challenge: "x", user: { id: "h", name: "n" } },
        });
      case "/auth/passkey/register/verify": {
        if (!user) return fail(401, "Sign in to do that.", "not_signed_in");
        passkeys.set(body.response.id, {
          userId: user.id,
          name: body.name ?? null,
        });
        // A guest becomes an account, keeping the id (and the session here).
        const owner = {
          ...user,
          isGuest: false,
          passkeyCount: countPasskeys(user.id),
        };
        tokens.set(token!, owner);
        if (!accounts.some((a) => a.id === owner.id)) accounts.push(owner);
        return json(200, { token: token!, user: owner });
      }
      case "/auth/passkey/login/options":
        return json(200, {
          challengeId: `c-${++challengeCounter}`,
          options: { challenge: "x" },
        });
      case "/auth/passkey/login/verify": {
        const found = passkeys.get(body.response?.id);
        const account = accounts.find((a) => a.id === found?.userId);
        if (!account) {
          return fail(401, "That passkey isn't recognised.", "unknown_passkey");
        }
        const loggedIn = {
          id: account.id,
          email: account.email,
          isGuest: false,
          hasPassword: !!account.password,
          passkeyCount: countPasskeys(account.id),
        };
        return json(200, { token: server.tokenFor(loggedIn), user: loggedIn });
      }
      case "/auth/passkeys":
        if (!user) return fail(401, "Sign in to do that.", "not_signed_in");
        return json(200, {
          passkeys: [...passkeys]
            .filter(([, p]) => p.userId === user.id)
            .map(([id, p]) => ({
              id,
              name: p.name,
              createdAt: "2026-01-01T00:00:00.000Z",
              lastUsedAt: null,
              deviceType: "multiDevice",
              backedUp: true,
            })),
        });

      default:
        return fail(404, "Not found", "not_found");
    }
  }

  function runAction(user: PublicUser, action: Action) {
    if (applied.has(action.id)) return applied.get(action.id)!;
    const ops = applyAction(memoryReadState(data), action, {
      userId: user.id,
      isGuest: user.isGuest,
      now: new Date().toISOString(),
    });
    applyOps(data, ops);
    version += 1;
    const changes: ChangeSet = { version, puts: {}, deletes: {} };
    for (const op of ops) {
      const key = `${op.table}:${op.op === "put" ? op.row.id : op.id}`;
      if (op.op === "put") {
        rowVersions.set(key, version);
        tombstones.delete(key);
        ((changes.puts[op.table] ??= []) as unknown[]).push(clean(op.row));
      } else {
        rowVersions.delete(key);
        tombstones.set(key, version);
        (changes.deletes[op.table] ??= []).push(op.id);
      }
    }
    applied.set(action.id, version);
    server.log.push(action.id);
    broadcast(changes);
    return version;
  }

  // The real server leaves out null fields.
  const clean = <R extends object>(row: R): R =>
    Object.fromEntries(Object.entries(row).filter(([, v]) => v != null)) as R;

  function snapshotChangeSet(): ChangeSet {
    const changes: ChangeSet = { version, puts: {}, deletes: {}, reset: true };
    for (const table of TABLES) {
      (changes.puts as Record<string, unknown[]>)[table] = [
        ...data[table].values(),
      ].map(clean);
    }
    return changes;
  }

  function changesSince(since: number): ChangeSet {
    if (since <= 0 || since > version) return snapshotChangeSet();
    const changes: ChangeSet = { version, puts: {}, deletes: {} };
    for (const table of TABLES) {
      for (const row of data[table].values() as Iterable<Tables[TableName]>) {
        if ((rowVersions.get(`${table}:${row.id}`) ?? 0) > since) {
          ((changes.puts[table] ??= []) as unknown[]).push(clean(row));
        }
      }
    }
    for (const [key, v] of tombstones) {
      if (v <= since) continue;
      const [table, id] = key.split(":") as [TableName, string];
      (changes.deletes[table] ??= []).push(id);
    }
    return changes;
  }

  function broadcast(changes: ChangeSet) {
    const text = `data: ${JSON.stringify(changes)}\n\n`;
    if (server.holdStream) return void server.held.push(text);
    for (const stream of streams) stream.send(text);
  }

  function openStream(since: number, signal?: AbortSignal | null) {
    const encoder = new TextEncoder();
    let handle: { send(text: string): void; end(error?: unknown): void };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        handle = {
          send: (text) => controller.enqueue(encoder.encode(text)),
          end: (error) => {
            streams.delete(handle);
            if (error) controller.error(error);
            else controller.close();
          },
        };
        streams.add(handle);
        controller.enqueue(encoder.encode(": hello\n\n"));
        handle.send(`data: ${JSON.stringify(changesSince(since))}\n\n`);
        if (server.dropStreams) handle.end();
        signal?.addEventListener("abort", () => {
          streams.delete(handle);
          try {
            controller.error(new DOMException("aborted", "AbortError"));
          } catch {
            // already closed
          }
        });
      },
    });
    return new Response(body, {
      headers: { "content-type": "text/event-stream" },
    });
  }

  return server;
}

export type FakeServer = ReturnType<typeof createFakeServer>;
