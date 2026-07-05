import type { Database } from "./db.js";
import { shardManager, type Shard } from "./shard-manager.js";

export interface MemoryRecord {
  id: string;
  content: string;
  vector: Float32Array;
  tagsVector?: Float32Array;
  containerTag: string;
  tags?: string[];
  type?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: string;
  displayName?: string;
  userName?: string;
  userEmail?: string;
  projectPath?: string;
  projectName?: string;
  gitRepoUrl?: string;
  isPinned?: boolean;
}

function toBlob(v: Float32Array | undefined): Uint8Array | null {
  return v ? new Uint8Array(v.buffer) : null;
}

function parseTags(row: Record<string, unknown>): string[] {
  const t = row.tags as string | undefined;
  return t ? t.split(",").map((s) => s.trim()) : [];
}

function rowToMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    id: row.id as string,
    content: row.content as string,
    vector: new Float32Array((row.vector as Uint8Array).buffer),
    tagsVector: row.tags_vector ? new Float32Array((row.tags_vector as Uint8Array).buffer) : undefined,
    containerTag: row.container_tag as string,
    tags: parseTags(row),
    type: row.type as string | undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    metadata: row.metadata as string | undefined,
    displayName: row.display_name as string | undefined,
    userName: row.user_name as string | undefined,
    userEmail: row.user_email as string | undefined,
    projectPath: row.project_path as string | undefined,
    projectName: row.project_name as string | undefined,
    gitRepoUrl: row.git_repo_url as string | undefined,
    isPinned: (row.is_pinned as number) === 1,
  };
}

export function getMemoryById(db: Database, id: string): MemoryRecord | null {
  const row = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? rowToMemory(row) : null;
}

export function addMemory(
  db: Database,
  shard: Shard,
  mem: MemoryRecord,
): void {
  db.prepare(`
    INSERT INTO memories (
      id, content, vector, tags_vector, container_tag, tags, type,
      created_at, updated_at, metadata,
      display_name, user_name, user_email, project_path, project_name, git_repo_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    mem.id, mem.content, toBlob(mem.vector), toBlob(mem.tagsVector),
    mem.containerTag, mem.tags?.join(",") ?? null, mem.type ?? null,
    mem.createdAt, mem.updatedAt, mem.metadata ?? null,
    mem.displayName ?? null, mem.userName ?? null, mem.userEmail ?? null,
    mem.projectPath ?? null, mem.projectName ?? null, mem.gitRepoUrl ?? null,
  );
  shardManager.incrementCount(shard.id);
}

export function deleteMemoryById(db: Database, shardId: number, id: string): void {
  db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  shardManager.decrementCount(shardId);
}

export function listMemories(db: Database, containerTag: string, limit: number): MemoryRecord[] {
  const rows = db.prepare(
    containerTag === ""
      ? `SELECT * FROM memories ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM memories WHERE container_tag = ? ORDER BY created_at DESC LIMIT ?`
  ).all(...(containerTag === "" ? [limit] : [containerTag, limit])) as Record<string, unknown>[];
  return rows.map(rowToMemory);
}

export function getAllMemories(db: Database): MemoryRecord[] {
  return (db.prepare(`SELECT * FROM memories ORDER BY created_at DESC`).all() as Record<string, unknown>[]).map(rowToMemory);
}

export function searchMemoriesBySessionId(db: Database, sessionID: string): MemoryRecord[] {
  const rows = db.prepare(
    `SELECT * FROM memories WHERE metadata LIKE ? ORDER BY created_at DESC`
  ).all(`%"sessionID":"${sessionID}"%`) as Record<string, unknown>[];
  return rows.map(rowToMemory);
}
