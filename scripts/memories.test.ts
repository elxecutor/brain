import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../plugin/dist/storage/db.js";

describe("memories", () => {
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
        source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        link_type TEXT NOT NULL DEFAULT 'related',
        metadata TEXT, created_at INTEGER NOT NULL,
        strength REAL DEFAULT 0.5,
        UNIQUE(source_id, target_id, link_type)
      )
    `);
    db.prepare(`INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at)
      VALUES ('mem_1', 'test one', X'00', 'test', 1, 1)`).run();
    db.prepare(`INSERT INTO memories (id, content, vector, container_tag, created_at, updated_at)
      VALUES ('mem_2', 'test two', X'00', 'test', 1, 1)`).run();
  });

  beforeEach(() => {
    db.exec("DELETE FROM links");
  });

  afterAll(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("addLink should create a link", async () => {
    const { addLink, getLinkedMemories } = await import("../plugin/dist/storage/memories.js");
    const link = addLink(db, "mem_1", "mem_2", "references");
    expect(link).toBeDefined();
    expect(link.sourceId).toBe("mem_1");
    expect(link.targetId).toBe("mem_2");
    expect(link.linkType).toBe("references");

    const linked = getLinkedMemories(db, "mem_1");
    expect(linked.length).toBeGreaterThanOrEqual(1);
  });

  it("removeLink should delete a link", async () => {
    const { addLink, removeLink, getLinkedMemories } = await import("../plugin/dist/storage/memories.js");
    addLink(db, "mem_1", "mem_2", "test-link");
    removeLink(db, "mem_1", "mem_2", "test-link");
    const linked = getLinkedMemories(db, "mem_1", "test-link");
    expect(linked.length).toBe(0);
  });

  it("removeLink without linkType should remove bidirectional", async () => {
    const { addLink, removeLink, getLinkedMemories } = await import("../plugin/dist/storage/memories.js");
    addLink(db, "mem_1", "mem_2", "bidirectional-test");
    removeLink(db, "mem_1", "mem_2");
    const from1 = getLinkedMemories(db, "mem_1", "bidirectional-test");
    const from2 = getLinkedMemories(db, "mem_2", "bidirectional-test");
    expect(from1.length).toBe(0);
    expect(from2.length).toBe(0);
  });

  it("traverseGraph should find linked nodes", async () => {
    const { addLink, traverseGraph } = await import("../plugin/dist/storage/memories.js");
    addLink(db, "mem_1", "mem_2", "traverse-test");
    const results = traverseGraph(db, "mem_1", 3, "traverse-test");
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.id === "mem_2")).toBe(true);
  });

  it("addLink stores strength correctly", async () => {
    const { addLink, getLinkedMemories } = await import("../plugin/dist/storage/memories.js");
    addLink(db, "mem_1", "mem_2", "strength-test", undefined, 0.8);
    const linked = getLinkedMemories(db, "mem_1", "strength-test");
    expect(linked.length).toBe(1);
    expect(linked[0].strength).toBe(0.8);
  });

  it("strengthenLink bumps strength", async () => {
    const { addLink, strengthenLink, getLinkedMemories } = await import("../plugin/dist/storage/memories.js");
    addLink(db, "mem_1", "mem_2", "bump-test", undefined, 0.5);
    strengthenLink(db, "mem_1", "mem_2", "bump-test", 0.2);
    const linked = getLinkedMemories(db, "mem_1", "bump-test");
    expect(linked.length).toBe(1);
    expect(linked[0].strength).toBeCloseTo(0.7, 5);
  });

  it("strengthenLink caps at 1.0", async () => {
    const { addLink, strengthenLink, getLinkedMemories } = await import("../plugin/dist/storage/memories.js");
    addLink(db, "mem_1", "mem_2", "cap-test", undefined, 0.5);
    strengthenLink(db, "mem_1", "mem_2", "cap-test", 1.0);
    const linked = getLinkedMemories(db, "mem_1", "cap-test");
    expect(linked.length).toBe(1);
    expect(linked[0].strength).toBe(1.0);
  });

  it("getLinkedMemories with minStrength filters correctly", async () => {
    const { addLink, getLinkedMemories } = await import("../plugin/dist/storage/memories.js");
    addLink(db, "mem_1", "mem_2", "weak-link", undefined, 0.3);
    addLink(db, "mem_1", "mem_2", "strong-link", undefined, 0.8);
    const filtered = getLinkedMemories(db, "mem_1", undefined, 0.5);
    expect(filtered.length).toBe(1);
    expect(filtered[0].linkType).toBe("strong-link");
    expect(filtered[0].strength).toBe(0.8);
  });
});
