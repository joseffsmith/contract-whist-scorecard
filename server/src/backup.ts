// Daily copies of the database (VACUUM INTO) in ${DATA_DIR}/backups.
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import type { Db } from "./db";

export type BackupOptions = {
  dataDir: string;
  keep: number; // newest copies to keep; 0 disables backups
  intervalMs?: number;
  now?: () => Date; // tests
};

const NAME = /^whist-\d{4}-\d{2}-\d{2}\.db$/;

export function createBackups(db: Db, opts: BackupOptions) {
  const dir = join(opts.dataDir, "backups");
  const now = opts.now ?? (() => new Date());
  let timer: NodeJS.Timeout | undefined;

  // Makes today's copy unless it exists, then deletes the oldest. Never
  // throws: a failed backup is logged and tried again at the next run.
  function run(): "created" | "exists" | "failed" | "disabled" {
    if (opts.keep < 1) return "disabled";
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      const file = join(dir, `whist-${now().toISOString().slice(0, 10)}.db`);
      let result: "created" | "exists" = "exists";
      if (!existsSync(file)) {
        // Write beside it and rename, so a half-written copy never counts.
        const partial = `${file}.partial`;
        rmSync(partial, { force: true });
        db.stmt("VACUUM INTO ?").run(partial);
        chmodSync(partial, 0o600);
        renameSync(partial, file);
        result = "created";
      }
      const copies = readdirSync(dir)
        .filter((f) => NAME.test(f))
        .sort();
      for (const old of copies.slice(
        0,
        Math.max(copies.length - opts.keep, 0)
      )) {
        rmSync(join(dir, old), { force: true });
      }
      return result;
    } catch (e) {
      console.error("Backup failed:", e);
      return "failed";
    }
  }

  return {
    run,
    // Now, and then every day. Does nothing when disabled.
    start(): void {
      if (opts.keep < 1) return;
      run();
      timer = setInterval(run, opts.intervalMs ?? 24 * 60 * 60 * 1000);
      timer.unref();
    },
    stop: () => clearInterval(timer),
  };
}
