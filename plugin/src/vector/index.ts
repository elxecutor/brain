import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { CONFIG } from "../config.js";
import type { Database } from "../storage/db.js";
import { getLinkedMemories, addLink } from "../storage/memories.js";
import type { Shard } from "../storage/shard-manager.js";
import { cosineSimilarity } from "../text/cosine.js";
import { computeRetrievability } from "../text/strength.js";
import { extractKeywords } from "../text/tokenize.js";

const require = createRequire(import.meta.url);
const usearch = require("usearch");

function idToKey(id: string): bigint {
  return BigInt(`0x${createHash("sha256").update(id).digest("hex").slice(0, 16)}`);
}

interface IndexEntry {
  id: string;
  distance: number;
}

interface VectorIndex {
  insert(id: string, vector: Float32Array): Promise<void> | void;
  delete(id: string): Promise<void> | void;
  search(vector: Float32Array, limit: number): Promise<IndexEntry[]> | IndexEntry[];
  name(): string;
  clear(): void;
}

class USearchIndex implements VectorIndex {
  private index: any = null;
  private ready = false;
  private ndim: number;
  private keyToStr = new Map<bigint, string>();

  constructor(dims: number) {
    this.ndim = dims;
  }

  ensure(): void {
    if (this.ready) return;
    this.index = new usearch.Index(this.ndim, usearch.MetricKind.Cos, undefined, 16, 128, 64);
    this.ready = true;
  }

  async insert(id: string, vector: Float32Array): Promise<void> {
    this.ensure();
    const key = idToKey(id);
    this.keyToStr.set(key, id);
    this.index.add(key, vector);
  }

  async delete(id: string): Promise<void> {
    this.ensure();
    const key = idToKey(id);
    this.keyToStr.delete(key);
    try {
      this.index.remove(key);
    } catch {
      /* ignore */
    }
  }

  async search(vector: Float32Array, limit: number): Promise<IndexEntry[]> {
    this.ensure();
    const result = this.index.search(vector, limit);
    const keys = result.keys as bigint[];
    const distances = result.distances as Float32Array;
    const out: IndexEntry[] = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const strId = this.keyToStr.get(k);
      out.push({
        id: strId !== undefined ? strId : String(k),
        distance: distances[i],
      });
    }
    return out;
  }

  name(): string {
    return "usearch";
  }
  clear(): void {
    this.index = null;
    this.ready = false;
    this.keyToStr.clear();
  }
}

class ExactScanIndex implements VectorIndex {
  private vectors = new Map<string, Float32Array>();

  insert(id: string, vector: Float32Array): void {
    this.vectors.set(id, vector);
  }

  delete(id: string): void {
    this.vectors.delete(id);
  }

  search(vector: Float32Array, limit: number): IndexEntry[] {
    const results: IndexEntry[] = [];
    for (const [id, v] of this.vectors) {
      const sim = cosineSimilarity(vector, v);
      results.push({ id, distance: 1 - sim });
    }
    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, limit);
  }

  name(): string {
    return "exact-scan";
  }
  clear(): void {
    this.vectors.clear();
  }
}

interface ShardIndexes {
  content: VectorIndex;
  tags: VectorIndex;
}

const shardIndexes = new Map<number, ShardIndexes>();

function getOrCreateIndexes(shardId: number): ShardIndexes {
  let idx = shardIndexes.get(shardId);
  if (!idx) {
    const dims = CONFIG.embeddingDimensions;
    const primary = CONFIG.vectorBackend === "exact-scan" ? new ExactScanIndex() : new USearchIndex(dims);
    idx = { content: primary, tags: new ExactScanIndex() };
    shardIndexes.set(shardId, idx);
  }
  return idx;
}

export function rebuildFromDb(db: Database, shard: Shard): void {
  const rows = db.prepare(`SELECT id, vector, tags_vector FROM memories`).all() as {
    id: string;
    vector: Uint8Array;
    tags_vector: Uint8Array | null;
  }[];
  const dims = CONFIG.embeddingDimensions;
  const primary = CONFIG.vectorBackend === "exact-scan" ? new ExactScanIndex() : new USearchIndex(dims);
  const tagsIdx = new ExactScanIndex();
  const existing = shardIndexes.get(shard.id);
  if (existing) {
    existing.content.clear();
    existing.tags.clear();
  }
  for (const row of rows) {
    const vec = new Float32Array(row.vector.buffer);
    primary.insert(row.id, vec);
    if (row.tags_vector) {
      const tv = new Float32Array(row.tags_vector.buffer);
      tagsIdx.insert(row.id, tv);
    }
  }
  shardIndexes.set(shard.id, { content: primary, tags: tagsIdx });
}

export async function insertVector(
  id: string,
  vector: Float32Array,
  tagsVector: Float32Array | undefined,
  shard: Shard,
): Promise<void> {
  const idx = getOrCreateIndexes(shard.id);
  await idx.content.insert(id, vector);
  if (tagsVector) await idx.tags.insert(id, tagsVector);
}

export async function deleteVector(id: string, shard: Shard): Promise<void> {
  const idx = shardIndexes.get(shard.id);
  if (!idx) return;
  await idx.content.delete(id);
  await idx.tags.delete(id);
}

export async function searchVectors(
  vector: Float32Array,
  containerTag: string,
  shard: Shard,
  db: Database,
  limit: number,
  queryText?: string,
): Promise<
  {
    id: string;
    memory: string;
    similarity: number;
    tags: string[];
    metadata?: any;
    containerTag: string;
    tier: string;
  }[]
> {
  let idx = getOrCreateIndexes(shard.id);
  let contentResults: IndexEntry[];
  let tagsResults: IndexEntry[];

  try {
    contentResults = await idx.content.search(vector, limit * 4);
  } catch {
    contentResults = [];
  }

  if (contentResults.length === 0) {
    rebuildFromDb(db, shard);
    idx = getOrCreateIndexes(shard.id);
    try {
      contentResults = await idx.content.search(vector, limit * 4);
    } catch {
      contentResults = [];
    }
  }

  try {
    tagsResults = await idx.tags.search(vector, limit * 4);
  } catch {
    tagsResults = [];
  }

  const scoreMap = new Map<string, { contentSim: number; tagsSim: number }>();
  for (const r of contentResults) {
    scoreMap.set(r.id, { contentSim: 1 - r.distance, tagsSim: 0 });
  }
  for (const r of tagsResults) {
    const e = scoreMap.get(r.id);
    if (e) e.tagsSim = 1 - r.distance;
    else scoreMap.set(r.id, { contentSim: 0, tagsSim: 1 - r.distance });
  }

  const ids = Array.from(scoreMap.keys());
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  const tagFilter = containerTag === "" ? "" : " AND container_tag = ?";
  const bindings = containerTag === "" ? ids : [...ids, containerTag];
  const rows = db
    .prepare(`SELECT * FROM memories WHERE id IN (${placeholders})${tagFilter}`)
    .all(...bindings) as Record<string, unknown>[];

  const queryWords = queryText ? await extractKeywords(queryText) : [];

  return rows
    .map((row) => {
      const scores = scoreMap.get(row.id as string)!;
      const memoryTags = ((row.tags as string) || "").split(",").map((t) => t.trim().toLowerCase());
      let exactBoost = 0;
      if (queryWords.length > 0 && memoryTags.length > 0) {
        const matches = queryWords.filter((w) => memoryTags.some((t) => t.includes(w))).length;
        exactBoost = matches / Math.max(queryWords.length, 1);
      }
      const finalTagsSim = Math.max(scores.tagsSim, exactBoost);
      const stability = (row.stability as number) ?? CONFIG.humanMemoryModel.initialStability;
      const lastAccessedAt = (row.last_accessed_at as number) ?? (row.created_at as number);
      const daysElapsed = (Date.now() - lastAccessedAt) / 86400000;
      const r = computeRetrievability(daysElapsed, stability);
      const similarity = (scores.contentSim + finalTagsSim * 0.3) * r;

      return {
        id: row.id as string,
        memory: row.content as string,
        similarity,
        tags: memoryTags.filter(Boolean),
        metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
        containerTag: row.container_tag as string,
        tier: (row.tier as string) ?? "neocortex",
      };
    })
    .filter((r) => r.similarity >= CONFIG.similarityThreshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export function clearIndexes(): void {
  shardIndexes.clear();
}

export interface GraphSearchResult {
  id: string;
  memory: string;
  similarity: number;
  tags: string[];
  metadata?: any;
  containerTag: string;
  tier: string;
  source: "search" | "link";
  linkedFrom?: string;
  linkType?: string;
  cluster?: { id: number; memberCount: number; avgStrength: number };
}

export async function searchWithGraph(
  vector: Float32Array,
  containerTag: string,
  shard: Shard,
  db: Database,
  limit: number,
  queryText?: string,
): Promise<GraphSearchResult[]> {
  const direct = await searchVectors(vector, containerTag, shard, db, limit, queryText);
  const directIds = new Set(direct.map((r) => r.id));
  const enriched: GraphSearchResult[] = direct.map((r) => ({
    ...r,
    source: "search" as const,
  }));

  const neighborIds = new Set<string>();
  const neighborMeta = new Map<string, { linkedFrom: string; linkType: string; linkStrength: number }>();

  for (const result of direct) {
    const links = getLinkedMemories(db, result.id);
    for (const link of links) {
      const neighbor = link.sourceId === result.id ? link.targetId : link.sourceId;
      if (directIds.has(neighbor)) continue;
      if (!neighborIds.has(neighbor)) {
        neighborIds.add(neighbor);
        neighborMeta.set(neighbor, {
          linkedFrom: result.id,
          linkType: link.linkType,
          linkStrength: link.strength ?? 0.5,
        });
      }
    }
  }

  if (neighborIds.size > 0) {
    const ids = Array.from(neighborIds);
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`SELECT * FROM memories WHERE id IN (${placeholders})`).all(...ids) as Record<
      string,
      unknown
    >[];
    for (const row of rows) {
      const meta = neighborMeta.get(row.id as string)!;
      enriched.push({
        id: row.id as string,
        memory: row.content as string,
        similarity: meta.linkStrength,
        tags: ((row.tags as string) || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
        containerTag: row.container_tag as string,
        tier: (row.tier as string) ?? "neocortex",
        source: "link",
        linkedFrom: meta.linkedFrom,
        linkType: meta.linkType,
      });
    }
  }

  if (enriched.length > 0) {
    const { getClustersForMemory } = await import("../storage/memories.js");
    for (const r of enriched) {
      const clusters = getClustersForMemory(db, r.id);
      if (clusters.length > 0) {
        const best = clusters.reduce((a, b) => (a.avgStrength > b.avgStrength ? a : b));
        r.cluster = {
          id: best.id,
          memberCount: best.memberIds.length,
          avgStrength: best.avgStrength,
        };
      }
    }
  }

  if (CONFIG.hebbianLearning.enabled && enriched.length > 1) {
    const delta = CONFIG.hebbianLearning.coActivationDelta;
    const directResults = enriched.filter((r) => r.source === "search");
    for (let i = 0; i < directResults.length; i++) {
      for (let j = i + 1; j < directResults.length; j++) {
        const a = directResults[i];
        const b = directResults[j];
        const existing = db
          .prepare(
            `SELECT id FROM links WHERE ((source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)) AND link_type = 'semantic'`,
          )
          .get(a.id, b.id, b.id, a.id) as { id: number } | undefined;
        if (existing) {
          db.prepare(`UPDATE links SET strength = MIN(1.0, strength + ?) WHERE id = ?`).run(delta, existing.id);
        } else {
          addLink(db, a.id, b.id, "semantic", undefined, delta);
        }
      }
    }
  }

  return enriched;
}
