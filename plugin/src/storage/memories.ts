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
  stability: number;
  lastAccessedAt: number;
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
    stability: (row.stability as number) ?? CONFIG.humanMemoryModel.initialStability,
    lastAccessedAt: (row.last_accessed_at as number) ?? (row.created_at as number),
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
      display_name, user_name, user_email, project_path, project_name, git_repo_url,
      stability, last_accessed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    mem.stability ?? CONFIG.humanMemoryModel.initialStability,
    mem.lastAccessedAt ?? mem.createdAt,
  );
  shardManager.incrementCount(shard.id);
  shardManager.recordMemoryLocation(mem.id, shard.dbPath);
}

export function deleteMemoryById(db: Database, shardId: number, id: string, _shardDbPath: string): void {
  db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  shardManager.decrementCount(shardId);
  shardManager.removeMemoryLocation(id);
}

export function updateMemoryStability(db: Database, memoryId: string, newStability: number): void {
  db.prepare(`UPDATE memories SET stability = ?, last_accessed_at = ? WHERE id = ?`).run(
    newStability,
    Date.now(),
    memoryId,
  );
}

export function strengthenLink(
  db: Database,
  sourceId: string,
  targetId: string,
  linkType: string,
  delta: number,
): void {
  db.prepare(`UPDATE links SET strength = MIN(1.0, strength + ?) WHERE source_id = ? AND target_id = ? AND link_type = ?`).run(
    delta,
    sourceId,
    targetId,
    linkType,
  );
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
  strength: number;
}

export function addLink(
  db: Database,
  sourceId: string,
  targetId: string,
  linkType?: string,
  metadata?: string,
  strength?: number,
): Link {
  const now = Date.now();
  const s = strength ?? 0.5;
  db.prepare(`
    INSERT OR IGNORE INTO links (source_id, target_id, link_type, metadata, created_at, strength)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sourceId, targetId, linkType ?? CONFIG.defaultLinkType ?? "related", metadata ?? null, now, s);
  const row = db.prepare(`SELECT last_insert_rowid() as id`).get() as any;
  return {
    id: row.id,
    sourceId,
    targetId,
    linkType: linkType ?? "related",
    metadata,
    createdAt: now,
    strength: s,
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

export function getLinkedMemories(
  db: Database,
  memoryId: string,
  linkType?: string,
  minStrength?: number,
): Link[] {
  let sql = `SELECT * FROM links WHERE (source_id = ? OR target_id = ?)`;
  const params: any[] = [memoryId, memoryId];
  if (linkType) {
    sql += ` AND link_type = ?`;
    params.push(linkType);
  }
  if (minStrength !== undefined) {
    sql += ` AND strength >= ?`;
    params.push(minStrength);
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
      strength: (r.strength as number) ?? 0.5,
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

export interface Cluster {
  id: number;
  scope: string;
  memberIds: string[];
  avgStrength: number;
  createdAt: number;
}

export function findClusters(
  db: Database,
  minStrength: number = 0.5,
  minSize: number = 3,
): string[][] {
  const links = db
    .prepare(`SELECT source_id, target_id, strength FROM links WHERE link_type = 'semantic' AND strength >= ?`)
    .all(minStrength) as Array<{ source_id: string; target_id: string; strength: number }>;

  const adj = new Map<string, Set<string>>();
  for (const link of links) {
    if (!adj.has(link.source_id)) adj.set(link.source_id, new Set());
    if (!adj.has(link.target_id)) adj.set(link.target_id, new Set());
    adj.get(link.source_id)!.add(link.target_id);
    adj.get(link.target_id)!.add(link.source_id);
  }

  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const node = queue.shift()!;
      component.push(node);
      for (const neighbor of adj.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (component.length >= minSize) {
      clusters.push(component.sort());
    }
  }

  return clusters;
}

export function storeCluster(
  db: Database,
  scope: string,
  memberIds: string[],
  avgStrength: number,
): Cluster | null {
  const key = JSON.stringify(memberIds);
  const existing = db
    .prepare(`SELECT id FROM clusters WHERE scope = ? AND member_ids = ?`)
    .get(scope, key) as { id: number } | undefined;
  if (existing) return null;

  const now = Date.now();
  db.prepare(`INSERT INTO clusters (scope, member_ids, avg_strength, created_at) VALUES (?, ?, ?, ?)`).run(
    scope,
    key,
    avgStrength,
    now,
  );
  const row = db.prepare(`SELECT last_insert_rowid() as id`).get() as { id: number };
  return { id: row.id, scope, memberIds, avgStrength, createdAt: now };
}

export function getClustersForMemory(db: Database, memoryId: string): Cluster[] {
  const rows = db
    .prepare(`SELECT * FROM clusters WHERE member_ids LIKE ?`)
    .all(`%${memoryId}%`) as Array<{
    id: number;
    scope: string;
    member_ids: string;
    avg_strength: number;
    created_at: number;
  }>;
  return rows
    .filter((r) => JSON.parse(r.member_ids).includes(memoryId))
    .map((r) => ({
      id: r.id,
      scope: r.scope,
      memberIds: JSON.parse(r.member_ids),
      avgStrength: r.avg_strength,
      createdAt: r.created_at,
    }));
}

export function getAllClusters(db: Database): Cluster[] {
  const rows = db.prepare(`SELECT * FROM clusters`).all() as Array<{
    id: number;
    scope: string;
    member_ids: string;
    avg_strength: number;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    scope: r.scope,
    memberIds: JSON.parse(r.member_ids),
    avgStrength: r.avg_strength,
    createdAt: r.created_at,
  }));
}
