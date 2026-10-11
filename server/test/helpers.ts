import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";
import { startServer } from "../src/app";
import type { ServerOptions } from "../src/app";
import type {
  Action,
  ActionArgs,
  ActionName,
  AuthResponse,
  PushResponse,
} from "../../shared/types";

type Running = Awaited<ReturnType<typeof startServer>>;
const running: { server: Running }[] = [];

const temp: string[] = [];

afterEach(async () => {
  for (const { server } of running.splice(0)) await server.close();
  for (const dir of temp.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

// A temp directory that is removed after the test.
export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whist-test-"));
  temp.push(dir);
  return dir;
}

export type Api = ReturnType<typeof makeApi>;

function makeApi(server: Running, dir: string) {
  const url = server.url;
  async function call(
    method: string,
    route: string,
    body?: unknown,
    token?: string,
    headers: Record<string, string> = {}
  ) {
    const res = await fetch(url + route, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return {
      status: res.status,
      body: (await res.json()) as any,
      headers: res.headers,
    };
  }
  return {
    url,
    dir,
    // Stops this server early (the data stays in `dir`, so it can be restarted).
    close: () => server.close(),
    get: (route: string, token?: string) =>
      call("GET", route, undefined, token),
    post: (
      route: string,
      body: unknown,
      token?: string,
      headers?: Record<string, string>
    ) => call("POST", route, body, token, headers),
    async guest(): Promise<AuthResponse> {
      return (await call("POST", "/auth/guest", {})).body;
    },
    async signup(
      email: string,
      password = "password123",
      token?: string
    ): Promise<AuthResponse> {
      return (await call("POST", "/auth/signup", { email, password }, token))
        .body;
    },
    async push(token: string, ...actions: Action[]): Promise<PushResponse> {
      return (await call("POST", "/sync/push", { actions }, token)).body;
    },
  };
}

export async function start(opts: Partial<ServerOptions> = {}) {
  const dir = opts.dataDir ?? tempDir();
  const server = await startServer({ port: 0, dataDir: dir, ...opts });
  running.push({ server });
  return makeApi(server, dir);
}

export function action<N extends ActionName>(
  name: N,
  args: ActionArgs[N],
  id: string = randomUUID()
): Action {
  return { id, name, args } as Action;
}

// Actions creating a claimed player and a game (13 rounds, host seated).
export function newGame(playerId: string = randomUUID()) {
  const gameId = randomUUID();
  const roundIds = Array.from({ length: 13 }, () => randomUUID());
  const seatId = randomUUID();
  const actions = [
    action("createPlayer", { playerId, name: "Host", claim: true }),
    action("createGame", { gameId, roundIds, seatId, playerId }),
  ];
  return { actions, gameId, roundIds, seatId, playerId };
}

// Sends raw bytes to the server and returns the status line (for requests
// that fetch() would never send).
export async function rawRequest(
  url: string,
  request: string
): Promise<string> {
  const { port, hostname } = new URL(url);
  const socket = net.connect(Number(port), hostname);
  socket.write(request);
  const chunks: Buffer[] = [];
  for await (const chunk of socket) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).includes("\r\n\r\n")) break;
  }
  socket.destroy();
  return Buffer.concat(chunks).toString().split("\r\n")[0];
}
