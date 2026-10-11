import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBackups } from "../src/backup";
import { openDb } from "../src/db";
import { newGame, start, tempDir } from "./helpers";

const backupDir = (dir: string) => path.join(dir, "backups");
const names = (dir: string) => fs.readdirSync(backupDir(dir)).sort();

function setup(keep = 14) {
  const dir = tempDir();
  const db = openDb(dir);
  let day = new Date("2026-03-01T10:00:00Z");
  const backups = createBackups(db, { dataDir: dir, keep, now: () => day });
  return {
    dir,
    db,
    backups,
    setDay: (iso: string) => (day = new Date(iso)),
  };
}

describe("backups", () => {
  it("copies the database privately, once a day", () => {
    const { dir, db, backups } = setup();
    db.sql.exec(
      "INSERT INTO players (id, name, version) VALUES ('p1', 'Ann', 1)"
    );
    expect(backups.run()).toBe("created");
    expect(names(dir)).toEqual(["whist-2026-03-01.db"]);
    const file = path.join(backupDir(dir), "whist-2026-03-01.db");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(backupDir(dir)).mode & 0o777).toBe(0o700);

    // The copy is a real database with the data in it.
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite")!;
    const copy = new DatabaseSync(file);
    expect(copy.prepare("SELECT name FROM players").all()).toEqual([
      { name: "Ann" },
    ]);
    copy.close();

    // Same day: left alone.
    const before = fs.statSync(file).mtimeMs;
    db.sql.exec(
      "INSERT INTO players (id, name, version) VALUES ('p2', 'Bob', 2)"
    );
    expect(backups.run()).toBe("exists");
    expect(fs.statSync(file).mtimeMs).toBe(before);
    db.close();
  });

  it("keeps only the newest copies", () => {
    const { dir, db, backups, setDay } = setup(3);
    for (let d = 1; d <= 6; d++) {
      setDay(`2026-03-0${d}T10:00:00Z`);
      backups.run();
    }
    expect(names(dir)).toEqual([
      "whist-2026-03-04.db",
      "whist-2026-03-05.db",
      "whist-2026-03-06.db",
    ]);
    db.close();
  });

  it("does nothing when disabled", () => {
    const { dir, db, backups } = setup(0);
    expect(backups.run()).toBe("disabled");
    backups.start();
    expect(fs.existsSync(backupDir(dir))).toBe(false);
    db.close();
  });

  it("logs a failure instead of throwing", () => {
    const { dir, db, backups } = setup();
    fs.writeFileSync(backupDir(dir), "not a directory");
    expect(backups.run()).toBe("failed");
    db.close();
  });

  it("runs at startup and then on its interval, without disturbing requests", async () => {
    let now = new Date("2026-03-01T10:00:00Z");
    const api = await start({
      backupIntervalMs: 40,
      now: () => now,
    });
    expect(names(api.dir)).toEqual(["whist-2026-03-01.db"]);

    const user = await api.guest();
    await api.push(user.token, ...newGame().actions);
    now = new Date("2026-03-02T10:00:00Z");
    await new Promise((r) => setTimeout(r, 150));
    expect(names(api.dir)).toEqual([
      "whist-2026-03-01.db",
      "whist-2026-03-02.db",
    ]);
    expect((await api.get("/health")).body.version).toBe(2);
  });

  it("can be turned off for the server", async () => {
    const api = await start({ backupDays: 0 });
    expect(fs.existsSync(backupDir(api.dir))).toBe(false);
  });

  it("keeps the configured number of copies", async () => {
    const dir = tempDir();
    fs.mkdirSync(backupDir(dir), { mode: 0o700 });
    for (const day of ["01", "02", "03", "04"]) {
      fs.writeFileSync(
        path.join(backupDir(dir), `whist-2026-02-${day}.db`),
        ""
      );
    }
    await start({
      dataDir: dir,
      backupDays: 2,
      now: () => new Date("2026-03-01T00:00:00Z"),
    });
    expect(names(dir)).toEqual(["whist-2026-02-04.db", "whist-2026-03-01.db"]);
  });
});
