import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);

interface Database {
  run(sql: string, ...params: unknown[]): void;
  prepare(sql: string): { run(...params: unknown[]): void; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
  close(): void;
  exec(sql: string): void;
}

let DatabaseSyncCompat: new (path: string) => Database;

function initDriver(): void {
  if (DatabaseSyncCompat) return;

  if (typeof (globalThis as any).Bun !== "undefined") {
    const { Database } = req("bun:sqlite") as { Database: new (path: string) => Database };
    DatabaseSyncCompat = Database;
    return;
  }

  try {
    const { DatabaseSync } = req("node:sqlite") as { DatabaseSync: new (path: string) => Database };
    class Adapter implements Database {
      private db: Database;
      constructor(path: string) { this.db = new DatabaseSync(path); }
      run(sql: string, ...params: unknown[]): void {
        if (params.length === 0) { this.db.exec(sql); return; }
        if (params.length === 1 && Array.isArray(params[0])) {
          this.db.prepare(sql).run(...params[0]);
        } else {
          this.db.prepare(sql).run(...params);
        }
      }
      prepare(sql: string) { return this.db.prepare(sql); }
      close() { (this.db as any).close(); }
      exec(sql: string) { this.db.exec(sql); }
    }
    DatabaseSyncCompat = Adapter as unknown as new (path: string) => Database;
    return;
  } catch { /* try better-sqlite3 */ }

  try {
    const BetterSqlite3 = req("better-sqlite3") as new (path: string) => Database;
    DatabaseSyncCompat = BetterSqlite3;
    return;
  } catch {
    throw new Error(
      "brain plugin: no SQLite binding available. " +
      "Node 22.5+ has built-in node:sqlite. Alternatively install better-sqlite3."
    );
  }
}

export function openDatabase(dbPath: string): Database {
  initDriver();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSyncCompat(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA cache_size = -64000");
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export type { Database };
