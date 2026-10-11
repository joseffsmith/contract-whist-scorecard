import { randomUUID } from "node:crypto";
import fs from "node:fs";
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
const running: { server: Running; dir: string }[] = [];

afterEach(async () => {
  for (const { server, dir } of running.splice(0)) {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

export type Api = ReturnType<typeof makeApi>;

function makeApi(url: string, dir: string) {
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whist-test-"));
  const server = await startServer({ port: 0, dataDir: dir, ...opts });
  running.push({ server, dir });
  return makeApi(server.url, dir);
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
