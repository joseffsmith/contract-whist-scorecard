import type {
  Action,
  ChangeSet,
  PushRequest,
  PushResponse,
} from "../../shared/types";

// Talks to the server's HTTP API (SPEC "Auth" and "Sync"). Network trouble is
// reported as SyncError with code "network"; server answers keep the
// server's own `error` message and `code`.

export const OFFLINE_MESSAGE = "You're offline. This needs a connection.";
const UNREACHABLE_MESSAGE = "Couldn't reach the server. Check your signal.";

export class SyncError extends Error {
  constructor(message: string, public code: string, public status?: number) {
    super(message);
  }
}

export const isNetworkError = (error: unknown) =>
  error instanceof SyncError &&
  (error.code === "network" || error.code === "offline");

export type StreamEvent = "open" | "closed";
export type StreamHandle = { close(): void };

export interface Transport {
  pull(since: number): Promise<ChangeSet>;
  push(actions: Action[], token: string): Promise<PushResponse>;
  get<T>(path: string, token?: string): Promise<T>;
  post<T>(
    path: string,
    body: unknown,
    token?: string,
    validate?: (json: any) => boolean
  ): Promise<T>;
  delete<T>(path: string, token?: string, body?: unknown): Promise<T>;
  openStream(
    since: number,
    onChangeSet: (changes: ChangeSet) => void,
    onStatus: (event: StreamEvent, error?: unknown) => void
  ): StreamHandle;
}

export type TransportOptions = {
  fetch: typeof fetch;
  base: string; // e.g. "/contract-whist/api"
  requestTimeoutMs?: number;
  // The server sends a heartbeat every 20s; silence for longer means the
  // connection is dead (common after a phone sleeps).
  streamIdleMs?: number;
};

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isChangeSet = (json: any) =>
  isObject(json) &&
  typeof json.version === "number" &&
  (json.puts === undefined || isObject(json.puts)) &&
  (json.deletes === undefined || isObject(json.deletes));

const isPushResponse = (json: any) =>
  isObject(json) &&
  typeof json.version === "number" &&
  Array.isArray(json.results) &&
  json.results.every(
    (r: any) =>
      isObject(r) && typeof r.id === "string" && typeof r.ok === "boolean"
  );

export const isAuthResponse = (json: any) =>
  isObject(json) &&
  typeof json.token === "string" &&
  isObject(json.user) &&
  typeof json.user.id === "string";

// Tolerates a server that leaves out empty maps.
const normalize = (json: any): ChangeSet => ({
  ...json,
  puts: json.puts ?? {},
  deletes: json.deletes ?? {},
});

export function createTransport(options: TransportOptions): Transport {
  const { base } = options;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const streamIdleMs = options.streamIdleMs ?? 45_000;
  // Call through a wrapper so a swapped global fetch (and test stubs) work.
  const doFetch: typeof fetch = (input, init) => options.fetch(input, init);

  // Anything that isn't a well-formed JSON answer to a successful request
  // (a captive portal's HTML, a proxy's error page) counts as no connection.
  async function request<T>(
    method: string,
    path: string,
    {
      body,
      token,
      validate,
    }: {
      body?: unknown;
      token?: string;
      validate?: (json: any) => boolean;
    } = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let res: Response;
    let json: any;
    try {
      res = await doFetch(base + path, {
        method,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      json = await res.json().catch(() => null);
    } catch {
      throw new SyncError(UNREACHABLE_MESSAGE, "network");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new SyncError(
        typeof json?.error === "string"
          ? json.error
          : "Something went wrong. Try again.",
        typeof json?.code === "string" ? json.code : "error",
        res.status
      );
    }
    if (!isObject(json) || (validate && !validate(json))) {
      throw new SyncError(UNREACHABLE_MESSAGE, "network", res.status);
    }
    return json as T;
  }

  return {
    // Reads are public, so no token: a stale session can't block syncing.
    async pull(since) {
      const json = await request("GET", `/sync/pull?since=${since}`, {
        validate: isChangeSet,
      });
      return normalize(json);
    },
    push: (actions, token) =>
      request<PushResponse>("POST", "/sync/push", {
        body: { actions } satisfies PushRequest,
        token,
        validate: isPushResponse,
      }),
    get: (path, token) => request("GET", path, { token }),
    post: (path, body, token, validate) =>
      request("POST", path, { body, token, validate }),
    delete: (path, token, body) => request("DELETE", path, { body, token }),
    openStream(since, onChangeSet, onStatus) {
      const controller = new AbortController();
      let closed = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = (error?: unknown) => {
        if (closed) return;
        closed = true;
        clearTimeout(idleTimer);
        controller.abort();
        onStatus("closed", error);
      };
      const watchdog = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => finish(new SyncError("Stream went quiet", "network")),
          streamIdleMs
        );
      };

      (async () => {
        watchdog();
        const res = await doFetch(`${base}/sync/stream?since=${since}`, {
          cache: "no-store",
          signal: controller.signal,
          headers: { accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) {
          throw new SyncError(
            "Couldn't open the live connection",
            "stream",
            res.status
          );
        }
        if (closed) return;
        watchdog();
        onStatus("open");
        const parse = createSseParser((data) => {
          const json = JSON.parse(data);
          if (!isChangeSet(json)) throw new SyncError("Bad event", "stream");
          onChangeSet(normalize(json));
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done || closed) break;
          watchdog();
          parse(decoder.decode(value, { stream: true }));
        }
        finish();
      })().catch((error) => finish(error));

      return {
        close() {
          // Closing ourselves isn't an event for the caller.
          closed = true;
          clearTimeout(idleTimer);
          controller.abort();
        },
      };
    },
  };
}

// Feeds text chunks in; calls `onData` with the joined `data:` lines of each
// complete event. Comment lines (": ...") and other fields are ignored.
export function createSseParser(onData: (data: string) => void) {
  let buffer = "";
  let data: string[] = [];
  return (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") {
        if (data.length) onData(data.join("\n"));
        data = [];
      } else if (line.startsWith("data:")) {
        const value = line.slice(5);
        data.push(value.startsWith(" ") ? value.slice(1) : value);
      }
    }
  };
}
