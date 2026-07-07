import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("db", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "brain-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should open a database and create WAL mode", async () => {
    const { openDatabase } = await import("../plugin/dist/storage/db.js");
    const db = openDatabase(join(tmpDir, "test.db"));
    const row = db.prepare("PRAGMA journal_mode").get() as any;
    expect(row?.journal_mode?.toLowerCase?.() ?? String(row)).toMatch(/wal/i);
    db.close();
  });

  it("getDatabase should return the same instance for the same path", async () => {
    const { getDatabase, clearConnectionCache } = await import("../plugin/dist/storage/db.js");
    const dbPath = join(tmpDir, "cache-test.db");
    const db1 = getDatabase(dbPath);
    const db2 = getDatabase(dbPath);
    expect(db1).toBe(db2);
    clearConnectionCache();
  });
});
