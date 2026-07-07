import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../plugin/dist/storage/db.js";

describe("clusters", () => {
  let tmpDir: string;
  let db: ReturnType<typeof openDatabase>;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "brain-test-"));
    db = openDatabase(join(tmpDir, "test.db"));
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, content TEXT, vector BLOB,
        container_tag TEXT, tags TEXT, created_at INTEGER, updated_at INTEGER,
        stability REAL DEFAULT 1.0, last_accessed_at INTEGER NOT NULL DEFAULT 0
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        link_type TEXT NOT NULL DEFAULT 'related',
        metadata TEXT, created_at INTEGER NOT NULL,
        strength REAL DEFAULT 0.5,
        UNIQUE(source_id, target_id, link_type)
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS clusters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        member_ids TEXT NOT NULL,
        avg_strength REAL NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(scope, member_ids)
      )
    `);

    for (let i = 1; i <= 6; i++) {
      db.prepare(`INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at)
        VALUES (?, ?, X'00', 'test', 1, 1)`).run(`mem_${i}`, `content ${i}`);
    }
  });

  afterAll(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("findClusters returns connected components with strong links", async () => {
    const { addLink, findClusters } = await import("../plugin/dist/storage/memories.js");
    addLink(db, "mem_1", "mem_2", "semantic", undefined, 0.8);
    addLink(db, "mem_2", "mem_3", "semantic", undefined, 0.7);
    addLink(db, "mem_4", "mem_5", "semantic", undefined, 0.6);
    addLink(db, "mem_5", "mem_6", "semantic", undefined, 0.9);

    const clusters = findClusters(db, 0.5, 3);
    expect(clusters.length).toBe(2);
    expect(clusters.some((c) => c.includes("mem_1") && c.includes("mem_2") && c.includes("mem_3"))).toBe(true);
    expect(clusters.some((c) => c.includes("mem_4") && c.includes("mem_5") && c.includes("mem_6"))).toBe(true);
  });

  it("findClusters ignores weak links", async () => {
    const { addLink, findClusters } = await import("../plugin/dist/storage/memories.js");
    db.exec("DELETE FROM links");
    addLink(db, "mem_1", "mem_2", "semantic", undefined, 0.3);
    addLink(db, "mem_2", "mem_3", "semantic", undefined, 0.2);

    const clusters = findClusters(db, 0.5, 3);
    expect(clusters.length).toBe(0);
  });

  it("findClusters ignores small clusters", async () => {
    const { addLink, findClusters } = await import("../plugin/dist/storage/memories.js");
    db.exec("DELETE FROM links");
    addLink(db, "mem_1", "mem_2", "semantic", undefined, 0.8);

    const clusters = findClusters(db, 0.5, 3);
    expect(clusters.length).toBe(0);
  });

  it("findClusters ignores non-semantic links", async () => {
    const { addLink, findClusters } = await import("../plugin/dist/storage/memories.js");
    db.exec("DELETE FROM links");
    addLink(db, "mem_1", "mem_2", "related", undefined, 0.9);
    addLink(db, "mem_2", "mem_3", "related", undefined, 0.9);

    const clusters = findClusters(db, 0.5, 3);
    expect(clusters.length).toBe(0);
  });

  it("storeCluster persists and deduplicates", async () => {
    const { storeCluster, getAllClusters } = await import("../plugin/dist/storage/memories.js");
    db.exec("DELETE FROM clusters");

    const stored = storeCluster(db, "project", ["a", "b", "c"], 0.7);
    expect(stored).not.toBeNull();
    expect(stored!.memberIds).toEqual(["a", "b", "c"]);

    const duplicate = storeCluster(db, "project", ["a", "b", "c"], 0.7);
    expect(duplicate).toBeNull();

    const all = getAllClusters(db);
    expect(all.length).toBe(1);
  });

  it("getClustersForMemory finds clusters containing a memory", async () => {
    const { storeCluster, getClustersForMemory } = await import("../plugin/dist/storage/memories.js");
    db.exec("DELETE FROM clusters");
    storeCluster(db, "project", ["mem_1", "mem_2", "mem_3"], 0.8);
    storeCluster(db, "project", ["mem_4", "mem_5", "mem_6"], 0.6);

    const clusters = getClustersForMemory(db, "mem_1");
    expect(clusters.length).toBe(1);
    expect(clusters[0].memberIds).toContain("mem_1");
  });
});
