// The action pipeline (the one place rows change), plus pull/stream/push.
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { applyAction } from "../../shared/actions";
import { ActionError } from "../../shared/types";
import type {
  Action,
  ReadState,
  RowOp,
  ChangeSet,
  PushResponse,
  PushResult,
} from "../../shared/types";
import type { Db } from "./db";
import { HttpError } from "./http";
import type { Limiter } from "./http";

export type Actor = { id: string; isGuest: boolean };

// One step of `apply`: an action, or a server-internal row update (never
// built from client input). `internal` is only ever set by the server.
export type Step =
  | {
      action: Action;
      actor: Actor;
      internal?: { allowClaimedFrom?: string };
    }
  | { rows: (state: ReadState) => RowOp[] };

const MAX_ACTIONS_PER_PUSH = 500;
const MAX_STREAM_BACKLOG = 2 * 1024 * 1024; // bytes a slow client may fall behind
const SNAPSHOTS_PER_MINUTE = 20;

export type SyncOptions = {
  pingMs?: number;
  maxStreams?: number; // open streams in total
  maxStreamsPerIp?: number;
};

const busy = () =>
  new HttpError(503, "Something went wrong. Try again.", "server_error");

export function createSync(db: Db, limiter: Limiter, opts: SyncOptions = {}) {
  const { pingMs = 20_000, maxStreams = 500, maxStreamsPerIp = 10 } = opts;
  const streams = new Set<ServerResponse>();
  const perIp = new Map<string, number>();

  // Writes to a stream, dropping clients that have fallen too far behind.
  function write(res: ServerResponse, chunk: string): void {
    if (res.writableLength > MAX_STREAM_BACKLOG) res.destroy();
    else res.write(chunk);
  }

  function broadcast(changes: ChangeSet): void {
    const event = `data: ${JSON.stringify(changes)}\n\n`; // serialised once
    for (const res of streams) write(res, event);
  }

  // Runs the steps in order in ONE transaction at one new version, and records
  // `id` so repeating it is a no-op. All steps succeed or none do. Throws a 503
  // HttpError for anything that isn't the action's fault (retry is safe).
  function apply(id: string, steps: Step[]): PushResult {
    const now = new Date().toISOString();
    const first = steps.find((step) => "actor" in step);
    const by = first && "actor" in first ? first.actor.id : null;
    let changedAt = 0;
    try {
      changedAt = db.transaction(() => {
        const earlier = db.appliedBy(id);
        if (earlier) {
          if (earlier.user_id === by) return 0;
          throw new ActionError(
            "That action id is already in use.",
            "conflict"
          );
        }
        const state = db.readState();
        const next = db.version() + 1;
        let wrote = false;
        for (const step of steps) {
          let ops: RowOp[];
          if ("rows" in step) {
            ops = step.rows(state);
          } else {
            const { actor, internal } = step;
            const ctx = {
              userId: actor.id,
              isGuest: actor.isGuest,
              now,
              internal,
            };
            ops = applyAction(state, step.action, ctx);
          }
          if (ops.length) wrote = true;
          db.writeOps(ops, next); // later steps see these writes
        }
        // An action that changes nothing doesn't bump the version.
        if (wrote) db.setVersion(next);
        db.recordApplied(id, by, wrote ? next : db.version());
        return wrote ? next : 0;
      });
    } catch (e) {
      if (e instanceof ActionError) {
        return { id, ok: false, error: e.message, code: e.code };
      }
      console.error(e);
      throw busy();
    }
    if (changedAt) broadcast(db.changesAt(changedAt));
    return { id, ok: true };
  }

  const ping = setInterval(() => {
    for (const res of streams) write(res, ": ping\n\n");
  }, pingMs);
  ping.unref();

  // Changes since the `since` query parameter. Full snapshots are the
  // expensive case, so they are rate limited per client.
  function changesFor(url: URL, ip: string): ChangeSet {
    const since = Number(url.searchParams.get("since")) || 0;
    if (!(since > 0) || since > db.version()) {
      if (limiter.limited(`snapshot:${ip}`, SNAPSHOTS_PER_MINUTE, 60_000)) {
        throw new HttpError(
          429,
          "Too many requests. Slow down.",
          "rate_limited"
        );
      }
    }
    return db.changesSince(since);
  }

  return {
    apply,
    broadcast,

    pull: (url: URL, ip: string): ChangeSet => changesFor(url, ip),

    // Server-sent events: changes since `since`, then one event per version.
    // Computing the first event and registering happen in the same tick, so no
    // version can slip between them.
    stream(res: ServerResponse, url: URL, ip: string): void {
      if (
        streams.size >= maxStreams ||
        (perIp.get(ip) ?? 0) >= maxStreamsPerIp
      ) {
        throw new HttpError(
          429,
          "Too many open connections.",
          "too_many_streams"
        );
      }
      const first = `data: ${JSON.stringify(changesFor(url, ip))}\n\n`;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      });
      res.write(first);
      streams.add(res);
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      res.on("close", () => {
        streams.delete(res);
        const left = (perIp.get(ip) ?? 1) - 1;
        if (left > 0) perIp.set(ip, left);
        else perIp.delete(ip);
      });
    },

    // Applies the actions in order. A rejected action only fails itself; any
    // other failure throws 503 for the whole request (earlier actions stay
    // committed and the client retries idempotently).
    push(actor: Actor, body: Record<string, unknown>): PushResponse {
      const actions = body.actions;
      if (!Array.isArray(actions) || actions.length > MAX_ACTIONS_PER_PUSH) {
        throw new HttpError(400, "Bad request.", "bad_request");
      }
      const results = actions.map((a: Action): PushResult => {
        const valid =
          a &&
          typeof a.id === "string" &&
          a.id !== "" &&
          a.id.length <= 100 &&
          typeof a.name === "string";
        if (!valid) {
          return {
            id: String(a?.id ?? ""),
            ok: false,
            error: "Invalid action.",
            code: "invalid",
          };
        }
        return apply(a.id, [
          { action: { id: a.id, name: a.name, args: a.args }, actor },
        ]);
      });
      return { results, version: db.version() };
    },

    close(): void {
      clearInterval(ping);
      for (const res of streams) res.end();
      streams.clear();
    },
  };
}
export type Sync = ReturnType<typeof createSync>;

export const newActionId = () => randomUUID();
