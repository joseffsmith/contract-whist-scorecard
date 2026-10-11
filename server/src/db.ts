// SQLite storage: synced tables (with version + tombstones), users, sessions.
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { StateError, TABLES } from "../../shared/types";
import type {
  ChangeSet,
  GameRow,
  PlayerRow,
  ReadState,
  RoundRow,
  RowOp,
  SeatRow,
  TableName,
  Tables,
  TurnRow,
} from "../../shared/types";

// Not a static import: vite (vitest) can't resolve "node:sqlite" yet.
const sqlite = process.getBuiltinModule?.("node:sqlite");
if (!sqlite) {
  throw new Error(
    "This server needs Node 22.13 or newer (it uses the built-in node:sqlite)."
  );
}
const { DatabaseSync } = sqlite;
type DatabaseSync = DatabaseSyncType;

type SqlValue = string | number | null;
type SqlRow = Record<string, unknown>;

// Column names match the row fields in shared/types.ts; mergeLog is JSON text.
const COLUMNS: Record<TableName, string[]> = {
  players: [
    "id",
    "name",
    "claimedBy",
    "mergedInto",
    "mergedAt",
    "mergeLog",
    "createdAt",
  ],
  games: ["id", "createdAt", "createdBy", "deletedAt", "initialDealerId"],
  seats: ["id", "gameId", "playerId", "orderNumber"],
  rounds: ["id", "gameId", "roundNumber"],
  turns: ["id", "roundId", "playerId", "bid", "score"],
};

const MIGRATIONS = [
  `
  CREATE TABLE meta (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO meta (key, value) VALUES ('version', '0');

  CREATE TABLE players (
    id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL, "claimedBy" TEXT, "mergedInto" TEXT,
    "mergedAt" TEXT, "mergeLog" TEXT, "createdAt" TEXT,
    version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE games (
    id TEXT NOT NULL PRIMARY KEY, "createdAt" TEXT NOT NULL, "createdBy" TEXT NOT NULL,
    "deletedAt" TEXT, "initialDealerId" TEXT,
    version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE seats (
    id TEXT NOT NULL PRIMARY KEY, "gameId" TEXT NOT NULL, "playerId" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE rounds (
    id TEXT NOT NULL PRIMARY KEY, "gameId" TEXT NOT NULL, "roundNumber" INTEGER NOT NULL,
    version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE turns (
    id TEXT NOT NULL PRIMARY KEY, "roundId" TEXT NOT NULL, "playerId" TEXT NOT NULL,
    bid INTEGER, score INTEGER,
    version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX players_claimedBy ON players ("claimedBy");
  CREATE INDEX games_initialDealerId ON games ("initialDealerId");
  CREATE INDEX seats_gameId ON seats ("gameId");
  CREATE INDEX seats_playerId ON seats ("playerId");
  CREATE INDEX rounds_gameId ON rounds ("gameId");
  CREATE INDEX turns_roundId ON turns ("roundId");
  CREATE INDEX turns_playerId ON turns ("playerId");
  CREATE INDEX players_version ON players (version);
  CREATE INDEX games_version ON games (version);
  CREATE INDEX seats_version ON seats (version);
  CREATE INDEX rounds_version ON rounds (version);
  CREATE INDEX turns_version ON turns (version);

  CREATE TABLE applied_actions (
    id TEXT NOT NULL PRIMARY KEY, user_id TEXT, version INTEGER NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE users (
    id TEXT NOT NULL PRIMARY KEY, email TEXT UNIQUE, is_guest INTEGER NOT NULL DEFAULT 0, is_admin INTEGER NOT NULL DEFAULT 0,
    password_salt TEXT, password_hash TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user_id ON sessions (user_id);
  CREATE TABLE reset_tokens (
    token_hash TEXT NOT NULL PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
    used_at TEXT
  );
  `,
  `
  CREATE INDEX games_createdBy ON games ("createdBy");
  `,
  `
  -- Guests made offline prove they own their client-chosen id with a secret.
  ALTER TABLE users ADD COLUMN guest_secret_hash TEXT;
  -- Imported rows name users (old InstantDB ids) that have no users row. Keep
  -- those ids from being registered as guests: add placeholder users.
  INSERT OR IGNORE INTO users (id, is_guest, created_at)
    SELECT DISTINCT "createdBy", 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM games
    WHERE "createdBy" IS NOT NULL AND "createdBy" != '';
  INSERT OR IGNORE INTO users (id, is_guest, created_at)
    SELECT DISTINCT "claimedBy", 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM players
    WHERE "claimedBy" IS NOT NULL AND "claimedBy" != '';
  `,
];

function migrate(sql: DatabaseSync): void {
  const row = sql.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let i = row.user_version; i < MIGRATIONS.length; i++) {
    sql.exec("BEGIN");
    try {
      sql.exec(MIGRATIONS[i]);
      sql.exec(`PRAGMA user_version = ${i + 1}`);
      sql.exec("COMMIT");
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  }
}

function toRow<T extends TableName>(table: T, r: SqlRow): Tables[T] {
  const row: SqlRow = {};
  for (const col of COLUMNS[table]) {
    const v = r[col];
    if (v === null || v === undefined) continue; // unset optional fields are omitted
    row[col] = col === "mergeLog" ? JSON.parse(v as string) : v;
  }
  return row as Tables[T];
}

function toValue(col: string, v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  return col === "mergeLog" ? JSON.stringify(v) : (v as SqlValue);
}

export type Snapshot = {
  players: PlayerRow[];
  games: GameRow[];
  seats: SeatRow[];
  rounds: RoundRow[];
  turns: TurnRow[];
  users?: { id: string; email: string | null }[]; // none: users re-register
};

export function openDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "whist.db");
  closeSync(openSync(file, "a", 0o600)); // private from the start
  const sql = new DatabaseSync(file);
  sql.exec(
    "PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;"
  );
  migrate(sql);

  const statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  const stmt = (q: string) => {
    let s = statements.get(q);
    if (!s) statements.set(q, (s = sql.prepare(q)));
    return s;
  };

  const version = () =>
    Number(
      (
        stmt("SELECT value FROM meta WHERE key = 'version'").get() as {
          value: string;
        }
      ).value
    );
  const setVersion = (v: number) =>
    stmt("UPDATE meta SET value = ? WHERE key = 'version'").run(String(v));

  // SQLite failures while running an action are transient, not the client's fault.
  function guard<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof StateError) throw e;
      throw new StateError(`Database error: ${(e as Error).message}`);
    }
  }

  // Reads live (non-tombstoned) rows. Sees writes made earlier in the same transaction.
  function readState(): ReadState {
    return {
      get: (table, id) =>
        guard(() => {
          const r = stmt(
            `SELECT * FROM ${table} WHERE id = ? AND deleted = 0`
          ).get(id) as SqlRow | undefined;
          return r ? toRow(table, r) : undefined;
        }),
      where: (table, field, value) =>
        guard(() => {
          const col = String(field);
          if (!COLUMNS[table].includes(col))
            throw new Error(`Unknown column ${table}.${col}`);
          const where = value == null ? `"${col}" IS NULL` : `"${col}" = ?`;
          const args = value == null ? [] : [toValue(col, value)];
          const rows = stmt(
            `SELECT * FROM ${table} WHERE ${where} AND deleted = 0`
          ).all(...args) as SqlRow[];
          return rows.map((r) => toRow(table, r));
        }),
    };
  }

  function writeOps(ops: RowOp[], v: number): void {
    guard(() => writeAll(ops, v));
  }

  function writeAll(ops: RowOp[], v: number): void {
    for (const op of ops) {
      if (op.op === "delete") {
        stmt(
          `UPDATE ${op.table} SET deleted = 1, version = ? WHERE id = ? AND deleted = 0`
        ).run(v, op.id);
        continue;
      }
      const cols = COLUMNS[op.table];
      const names = [...cols, "version", "deleted"]
        .map((c) => `"${c}"`)
        .join(", ");
      const marks = [...cols, "version", "deleted"].map(() => "?").join(", ");
      const update = [...cols.slice(1), "version", "deleted"]
        .map((c) => `"${c}" = excluded."${c}"`)
        .join(", ");
      const row = op.row as unknown as SqlRow;
      stmt(
        `INSERT INTO ${op.table} (${names}) VALUES (${marks}) ON CONFLICT(id) DO UPDATE SET ${update}`
      ).run(...cols.map((c) => toValue(c, row[c])), v, 0);
    }
  }

  function collect(
    filter: string,
    args: number[],
    current: number,
    reset?: boolean
  ): ChangeSet {
    const changes: ChangeSet = { version: current, puts: {}, deletes: {} };
    for (const table of TABLES) {
      const rows = stmt(`SELECT * FROM ${table} WHERE ${filter}`).all(
        ...args
      ) as SqlRow[];
      const puts = rows.filter((r) => !r.deleted).map((r) => toRow(table, r));
      const deletes = rows.filter((r) => r.deleted).map((r) => r.id as string);
      if (puts.length)
        (changes.puts as Record<string, unknown[]>)[table] = puts;
      if (deletes.length) changes.deletes[table] = deletes;
    }
    if (reset) changes.reset = true;
    return changes;
  }

  // Rows written at exactly this version (what gets broadcast).
  const changesAt = (v: number) => collect("version = ?", [v], v);

  // since = 0 (or a version we haven't reached, e.g. after a DB reset) → full snapshot.
  function changesSince(since: number): ChangeSet {
    const current = version();
    if (!(since > 0) || since > current)
      return collect("deleted = 0", [], current, true);
    return collect("version > ?", [since], current);
  }

  function transaction<T>(fn: () => T): T {
    sql.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      sql.exec("COMMIT");
      return result;
    } catch (e) {
      // SQLite may already have rolled back; don't mask the original error.
      try {
        sql.exec("ROLLBACK");
      } catch {
        /* no transaction left */
      }
      throw e;
    }
  }

  return {
    sql,
    stmt,
    version,
    setVersion,
    readState,
    writeOps,
    changesAt,
    changesSince,
    transaction,
    // Who applied this action id, or undefined if it hasn't been applied.
    appliedBy: (id: string) =>
      stmt("SELECT user_id FROM applied_actions WHERE id = ?").get(id) as
        | { user_id: string | null }
        | undefined,
    recordApplied: (id: string, userId: string | null, v: number) =>
      stmt(
        "INSERT INTO applied_actions (id, user_id, version, at) VALUES (?, ?, ?, ?)"
      ).run(id, userId, v, new Date().toISOString()),
    close: () => sql.close(),
  };
}
export type Db = ReturnType<typeof openDb>;

// Bulk-loads rows (and optionally users) into a database with no synced rows,
// keeping ids (InstantDB migration). Users get no password; everything lands
// at version 1.
export function importSnapshot(db: Db, snapshot: Snapshot): void {
  db.transaction(() => {
    const rows = TABLES.map(
      (t) =>
        (db.stmt(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
    );
    if (rows.some((n) => n > 0) || db.version() > 0) {
      throw new NotEmptyError();
    }
    for (const table of TABLES) {
      const ops: RowOp[] = snapshot[table].map(
        (row) => ({ op: "put", table, row } as RowOp)
      );
      db.writeOps(ops, 1);
    }
    const now = new Date().toISOString();
    for (const u of snapshot.users ?? []) {
      db.stmt(
        "INSERT INTO users (id, email, is_guest, created_at) VALUES (?, ?, 0, ?)"
      ).run(u.id, u.email ? u.email.trim().toLowerCase() : null, now);
    }
    // Rows name creators and claimers (old Instant user ids) who may have no
    // users row; reserve their ids so nobody can register as them.
    for (const column of [
      ["games", "createdBy"],
      ["players", "claimedBy"],
    ]) {
      db.stmt(
        `INSERT OR IGNORE INTO users (id, is_guest, created_at)
         SELECT DISTINCT "${column[1]}", 0, ? FROM ${column[0]}
         WHERE "${column[1]}" IS NOT NULL AND "${column[1]}" != ''`
      ).run(now);
    }
    db.setVersion(1);
  });
}

export class NotEmptyError extends Error {
  constructor() {
    super("importSnapshot needs an empty database.");
  }
}
