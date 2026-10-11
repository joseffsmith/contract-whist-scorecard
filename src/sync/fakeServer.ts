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
        ((changes.puts[op.table] ??= []) as unknown[]).push(op.row);
      }
      broadcast(changes);
    },

    addAccount(email: string, password: string, isGuest = false): PublicUser {
      const account = { id: `u-${++userCounter}`, email, isGuest, password };
      accounts.push(account);
      return { id: account.id, email, isGuest };
    },

    tokenFor(user: PublicUser) {
      const token = `t-${++tokenCounter}`;
      tokens.set(token, user);
      return token;
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

      if (path === "/sync/stream")
        return openStream(Number(url.searchParams.get("since")), init?.signal);
      return handle(path, url, body, auth);
    }) as typeof fetch,
  };

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fail = (status: number, error: string, code: string) =>
    json(status, { error, code });

  function handle(path: string, url: URL, body: any, token?: string): Response {
    const user = token ? tokens.get(token) : undefined;
    switch (path) {
      case "/sync/pull":
        return json(200, changesSince(Number(url.searchParams.get("since"))));
      case "/sync/push": {
        if (!user) return fail(401, "Sign in to do that.", "not_signed_in");
        if (server.blockPush) return fail(503, "Busy", "unavailable");
        const results: PushResult[] = (body.actions as Action[]).map(
          (action) => {
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
        const guest = { id: `u-${++userCounter}`, email: null, isGuest: true };
        return json(200, { token: server.tokenFor(guest), user: guest });
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
        };
        return json(200, { token: server.tokenFor(loggedIn), user: loggedIn });
      }
      case "/auth/logout":
        if (token) tokens.delete(token);
        return json(200, { ok: true });
      case "/auth/password":
        return user
          ? json(200, { ok: true })
          : fail(401, "Sign in to do that.", "not_signed_in");
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
        ((changes.puts[op.table] ??= []) as unknown[]).push(op.row);
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

  function snapshotChangeSet(): ChangeSet {
    const changes: ChangeSet = { version, puts: {}, deletes: {}, reset: true };
    for (const table of TABLES) {
      (changes.puts as Record<string, unknown[]>)[table] = [
        ...data[table].values(),
      ];
    }
    return changes;
  }

  function changesSince(since: number): ChangeSet {
    if (since <= 0 || since > version) return snapshotChangeSet();
    const changes: ChangeSet = { version, puts: {}, deletes: {} };
    for (const table of TABLES) {
      for (const row of data[table].values() as Iterable<Tables[TableName]>) {
        if ((rowVersions.get(`${table}:${row.id}`) ?? 0) > since) {
          ((changes.puts[table] ??= []) as unknown[]).push(row);
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
