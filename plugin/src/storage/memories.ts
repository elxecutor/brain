import { CONFIG } from "../config.js";
import type { Database } from "./db.js";
import { type Shard, shardManager } from "./shard-manager.js";

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

export function addMemory(db: Database, shard: Shard, mem: MemoryRecord): void {
  db.prepare(`
    INSERT INTO memories (
      id, content, vector, tags_vector, container_tag, tags, type,
      created_at, updated_at, metadata,
      display_name, user_name, user_email, project_path, project_name, git_repo_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    mem.id,
    mem.content,
    toBlob(mem.vector),
    toBlob(mem.tagsVector),
    mem.containerTag,
    mem.tags?.join(",") ?? null,
    mem.type ?? null,
    mem.createdAt,
    mem.updatedAt,
    mem.metadata ?? null,
    mem.displayName ?? null,
    mem.userName ?? null,
    mem.userEmail ?? null,
    mem.projectPath ?? null,
    mem.projectName ?? null,
    mem.gitRepoUrl ?? null,
  );
  shardManager.incrementCount(shard.id);
  shardManager.recordMemoryLocation(mem.id, shard.dbPath);
}

export function deleteMemoryById(db: Database, shardId: number, id: string, _shardDbPath: string): void {
  db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  shardManager.decrementCount(shardId);
  shardManager.removeMemoryLocation(id);
}

export function listMemories(db: Database, containerTag: string, limit: number): MemoryRecord[] {
  const rows = db
    .prepare(
      containerTag === ""
        ? `SELECT * FROM memories ORDER BY created_at DESC LIMIT ?`
        : `SELECT * FROM memories WHERE container_tag = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...(containerTag === "" ? [limit] : [containerTag, limit])) as Record<string, unknown>[];
  return rows.map(rowToMemory);
}

export function getAllMemories(db: Database): MemoryRecord[] {
  return (db.prepare(`SELECT * FROM memories ORDER BY created_at DESC`).all() as Record<string, unknown>[]).map(
    rowToMemory,
  );
}

export function searchMemoriesBySessionId(db: Database, sessionID: string): MemoryRecord[] {
  const rows = db
    .prepare(`SELECT * FROM memories WHERE metadata LIKE ? ORDER BY created_at DESC`)
    .all(`%"sessionID":"${sessionID}"%`) as Record<string, unknown>[];
  return rows.map(rowToMemory);
}

export interface Link {
  id: number;
  sourceId: string;
  targetId: string;
  linkType: string;
  metadata?: string;
  createdAt: number;
}

export function addLink(db: Database, sourceId: string, targetId: string, linkType?: string, metadata?: string): Link {
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO links (source_id, target_id, link_type, metadata, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sourceId, targetId, linkType ?? CONFIG.defaultLinkType ?? "related", metadata ?? null, now);
  const row = db.prepare(`SELECT last_insert_rowid() as id`).get() as any;
  return {
    id: row.id,
    sourceId,
    targetId,
    linkType: linkType ?? "related",
    metadata,
    createdAt: now,
  };
}

export function removeLink(db: Database, sourceId: string, targetId: string, linkType?: string): void {
  db.prepare("BEGIN").run();
  try {
    if (linkType) {
      db.prepare(`DELETE FROM links WHERE source_id = ? AND target_id = ? AND link_type = ?`).run(
        sourceId,
        targetId,
        linkType,
      );
    } else {
      db.prepare(`DELETE FROM links WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)`).run(
        sourceId,
        targetId,
        targetId,
        sourceId,
      );
    }
    db.prepare("COMMIT").run();
  } catch (err) {
    db.prepare("ROLLBACK").run();
    throw err;
  }
}

export function getLinkedMemories(db: Database, memoryId: string, linkType?: string): Link[] {
  let sql = `SELECT * FROM links WHERE source_id = ? OR target_id = ?`;
  const params: any[] = [memoryId, memoryId];
  if (linkType) {
    sql += ` AND link_type = ?`;
    params.push(linkType);
  }
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const neighborId = (r.source_id as string) === memoryId ? (r.target_id as string) : (r.source_id as string);
    if (seen.has(neighborId)) continue;
    seen.add(neighborId);
    links.push({
      id: r.id as number,
      sourceId: r.source_id as string,
      targetId: r.target_id as string,
      linkType: r.link_type as string,
      metadata: r.metadata as string | undefined,
      createdAt: r.created_at as number,
    });
  }
  return links;
}

export function traverseGraph(
  db: Database,
  startId: string,
  maxDepth: number,
  linkType?: string,
): Array<{ id: string; depth: number; linkType: string; path: string[] }> {
  const results: Array<{ id: string; depth: number; linkType: string; path: string[] }> = [];
  const visited = new Set<string>([startId]);
  const queue: Array<{ id: string; depth: number; path: string[] }> = [{ id: startId, depth: 0, path: [startId] }];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    if (current.depth > 0) {
      results.push({ id: current.id, depth: current.depth, linkType: "", path: current.path });
    }
    if (current.depth >= maxDepth) continue;
    const links = getLinkedMemories(db, current.id, linkType);
    for (const link of links) {
      const neighbor = link.sourceId === current.id ? link.targetId : link.sourceId;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, depth: current.depth + 1, path: [...current.path, neighbor] });
      }
    }
  }
  return results;
}
