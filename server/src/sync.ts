// The action pipeline (the one place rows change), plus pull/stream/push.
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { applyAction } from "../../shared/actions";
import { ActionError } from "../../shared/types";
import type {
  Action,
  ChangeSet,
  PushResponse,
  PushResult,
} from "../../shared/types";
import type { Db } from "./db";
import { HttpError } from "./http";

export type Actor = { id: string; isGuest: boolean };

// One action as run by `apply`. `internal` is only ever set by the server.
export type Step = {
  action: Action;
  actor: Actor;
  internal?: { allowClaimedFrom?: string };
};

const MAX_ACTIONS_PER_PUSH = 500;

export function createSync(db: Db, pingMs = 20_000) {
  const streams = new Set<ServerResponse>();

  const emit = (res: ServerResponse, changes: ChangeSet) =>
    res.write(`data: ${JSON.stringify(changes)}\n\n`);

  // Runs the steps in order in ONE transaction at one new version, and records
  // `id` so repeating it is a no-op. All steps succeed or none do.
  function apply(id: string, steps: Step[]): PushResult {
    const now = new Date().toISOString();
    let changedAt = 0;
    try {
      changedAt = db.transaction(() => {
        if (db.isApplied(id)) return 0;
        const state = db.readState();
        const next = db.version() + 1;
        let wrote = false;
        for (const { action, actor, internal } of steps) {
          const ctx = {
            userId: actor.id,
            isGuest: actor.isGuest,
            now,
            internal,
          };
          const ops = applyAction(state, action, ctx);
          if (ops.length) wrote = true;
          db.writeOps(ops, next); // later steps see these writes
        }
        // An action that changes nothing doesn't bump the version.
        if (wrote) db.setVersion(next);
        db.recordApplied(
          id,
          steps[0]?.actor.id ?? null,
          wrote ? next : db.version()
        );
        return wrote ? next : 0;
      });
    } catch (e) {
      if (e instanceof ActionError) {
        return { id, ok: false, error: e.message, code: e.code };
      }
      console.error(e);
      return {
        id,
        ok: false,
        error: "Something went wrong.",
        code: "server_error",
      };
    }
    if (changedAt) broadcast(db.changesAt(changedAt));
    return { id, ok: true };
  }

  function broadcast(changes: ChangeSet): void {
    for (const res of streams) emit(res, changes);
  }

  const ping = setInterval(() => {
    for (const res of streams) res.write(": ping\n\n");
  }, pingMs);
  ping.unref();

  const sinceParam = (url: URL) => Number(url.searchParams.get("since")) || 0;

  return {
    apply,

    pull: (url: URL): ChangeSet => db.changesSince(sinceParam(url)),

    // Server-sent events: changes since `since`, then one event per version.
    // Computing the first event and registering happen in the same tick, so no
    // version can slip between them.
    stream(req: IncomingMessage, res: ServerResponse, url: URL): void {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      });
      emit(res, db.changesSince(sinceParam(url)));
      streams.add(res);
      req.on("close", () => streams.delete(res));
    },

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
