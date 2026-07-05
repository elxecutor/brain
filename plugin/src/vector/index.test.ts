import { afterEach, describe, expect, it } from "vitest";
import { clearIndexes } from "./index.js";

describe("vector index", () => {
  afterEach(() => {
    clearIndexes();
  });

  it("rebuildFromDb should not throw on empty shard", async () => {
    const { rebuildFromDb } = await import("./index.js");
    const { openDatabase } = await import("../storage/db.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmpDir = mkdtempSync(join(tmpdir(), "brain-test-"));
    const dbPath = join(tmpDir, "empty.db");
    const db = openDatabase(dbPath);
    db.exec("CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, vector BLOB, tags_vector BLOB)");
    const shard = {
      id: Math.floor(Math.random() * 100000),
      scope: "test",
      scopeHash: "test",
      shardIndex: 0,
      dbPath,
      vectorCount: 0,
      isActive: true,
      createdAt: 0,
    };
    expect(() => rebuildFromDb(db, shard)).not.toThrow();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should export rebuildFromDb, insertVector, deleteVector, searchVectors", async () => {
    const mod = await import("./index.js");
    expect(typeof mod.rebuildFromDb).toBe("function");
    expect(typeof mod.insertVector).toBe("function");
    expect(typeof mod.deleteVector).toBe("function");
    expect(typeof mod.searchVectors).toBe("function");
  });
});
