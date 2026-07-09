#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
  },
  strict: false,
});

const DRY_RUN = values["dry-run"] ?? true;
const BRAIN_DIR = join(homedir(), ".brain");
const PLUGIN_DIR = join(BRAIN_DIR, "plugin");

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;
const CLUSTER_MIN_STRENGTH = 0.5;
const CLUSTER_MIN_SIZE = 3;

function log(msg) {
  process.stdout.write(`[consolidate] ${msg}\n`);
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function main() {
  const { CONFIG, initConfig } = await import(join(PLUGIN_DIR, "dist/config.js"));
  const { computeRetrievability } = await import(join(PLUGIN_DIR, "dist/text/strength.js"));
  const { getDatabase } = await import(join(PLUGIN_DIR, "dist/storage/db.js"));

  initConfig(BRAIN_DIR);

  const consolidate = CONFIG.humanMemoryModel.consolidation;

  const metadataPath = join(CONFIG.storagePath, "metadata.db");
  log(`Storage: ${CONFIG.storagePath}`);
  log(`Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);

  if (!existsSync(metadataPath)) {
    log("No metadata.db found — nothing to consolidate.");
    return;
  }

  const metadataDb = getDatabase(metadataPath);
  const shardRows = metadataDb.prepare("SELECT db_path FROM shards WHERE is_active = 1").all();
  const shardDbs = shardRows.map(r => join(CONFIG.storagePath, r.db_path)).filter(p => existsSync(p));
  metadataDb.close();

  if (shardDbs.length === 0) {
    log("No shard databases found — nothing to consolidate.");
    return;
  }

  let totalPruned = 0;
  let totalMerged = 0;
  let totalLinksPruned = 0;
  let totalClustersFound = 0;

  for (const shardPath of shardDbs) {
    log(`Processing: ${shardPath}`);
    const db = getDatabase(shardPath);
    const now = Date.now();

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type=?").all("table").map(r => r.name);
    if (!tables.includes("memories")) {
      db.close();
      continue;
    }

    const columns = db.prepare("PRAGMA table_info(memories)").all().map(r => r.name);
    const hasStability = columns.includes("stability");
    const hasLastAccessed = columns.includes("last_accessed_at");

    const memories = db.prepare(`
      SELECT id, content, container_tag, created_at
      FROM memories
      WHERE type = 'fact'
    `).all();

    // Fetch stability/last_accessed_at if columns exist
    if (hasStability || hasLastAccessed) {
      const selectCols = ["id"];
      if (hasStability) selectCols.push("stability");
      if (hasLastAccessed) selectCols.push("last_accessed_at");
      const extra = db.prepare(`SELECT ${selectCols.join(", ")} FROM memories WHERE type = 'fact'`).all();
      const extraMap = new Map(extra.map(r => [r.id, r]));
      for (const mem of memories) {
        const e = extraMap.get(mem.id);
        if (e) {
          if (e.stability !== undefined) mem.stability = e.stability;
          if (e.last_accessed_at !== undefined) mem.last_accessed_at = e.last_accessed_at;
        }
      }
    }

    // 1. Prune low-retrievability memories (requires stability column)
    if (hasStability) {
      const toPrune = [];
      for (const mem of memories) {
        const createdAt = mem.created_at ? new Date(mem.created_at).getTime() : now;
        if (now - createdAt < GRACE_PERIOD_MS) continue;

        const linkCount = db.prepare(
          "SELECT COUNT(*) as cnt FROM links WHERE source_id = ? OR target_id = ?"
        ).get(mem.id, mem.id)?.cnt ?? 0;
        if (linkCount >= 2) continue;

        const stability = mem.stability ?? 1.0;
        const lastAccessed = mem.last_accessed_at ? new Date(mem.last_accessed_at).getTime() : createdAt;
        const elapsedDays = (now - lastAccessed) / (1000 * 60 * 60 * 24);
        const R = computeRetrievability(elapsedDays, stability);

        if (R < consolidate.pruneRetrievabilityFloor) {
          toPrune.push({ id: mem.id, content: (mem.content ?? "").substring(0, 50), R });
        }
      }

      for (const p of toPrune) {
        if (DRY_RUN) {
          log(`  [dry-run] would prune memory ${p.id} (R=${p.R.toFixed(4)}): "${p.content}..."`);
        } else {
          db.prepare("DELETE FROM links WHERE source_id = ? OR target_id = ?").run(p.id, p.id);
          db.prepare("DELETE FROM memories WHERE id = ?").run(p.id);
        }
        totalPruned++;
      }
    } else {
      log(`  skipping retrievability pruning (stability column not present)`);
    }

    // 2. Merge near-duplicate memories
    if (memories.length > 1) {
      const containerGroups = new Map();
      for (const mem of memories) {
        const key = mem.container_tag ?? "__global__";
        if (!containerGroups.has(key)) containerGroups.set(key, []);
        containerGroups.get(key).push(mem);
      }

      const merged = new Set();
      for (const [, group] of containerGroups) {
        for (let i = 0; i < group.length; i++) {
          if (merged.has(group[i].id)) continue;

          for (let j = i + 1; j < group.length; j++) {
            if (merged.has(group[j].id)) continue;

            const vecA = group[i].vector;
            const vecB = group[j].vector;
            if (!vecA || !vecB) continue;

            const sim = cosineSimilarity(vecA, vecB);
            if (sim >= consolidate.mergeSimilarityThreshold) {
              const older = new Date(group[i].created_at).getTime() <= new Date(group[j].created_at).getTime()
                ? group[i] : group[j];
              const younger = older === group[i] ? group[j] : group[i];

              if (DRY_RUN) {
                log(`  [dry-run] would merge ${younger.id} into ${older.id} (sim=${sim.toFixed(4)})`);
              } else {
                const newContent = (older.content ?? "") + "\n\n" + (younger.content ?? "");
                const maxStability = Math.max(older.stability ?? 1, younger.stability ?? 1);
                db.prepare("UPDATE memories SET content = ?, stability = ?, updated_at = datetime('now') WHERE id = ?")
                  .run(newContent, maxStability, older.id);
                db.prepare("UPDATE links SET source_id = ? WHERE source_id = ?").run(older.id, younger.id);
                db.prepare("UPDATE links SET target_id = ? WHERE target_id = ?").run(older.id, younger.id);
                db.prepare("DELETE FROM memories WHERE id = ?").run(younger.id);
              }
              totalMerged++;
              merged.add(younger.id);
            }
          }
        }
      }
    }

    // 3. Prune low-strength links
    if (tables.includes("links")) {
      const linkColumns = db.prepare("PRAGMA table_info(links)").all().map(r => r.name);
      if (linkColumns.includes("strength")) {
        const links = db.prepare(`
          SELECT id, source_id, target_id, strength, created_at
          FROM links
          WHERE strength < ? AND strength > 0
        `).all(consolidate.pruneLinkStrengthFloor);

        for (const link of links) {
          const createdAt = link.created_at ? new Date(link.created_at).getTime() : now;
          if (now - createdAt < LINK_GRACE_PERIOD_MS) continue;

          if (DRY_RUN) {
            log(`  [dry-run] would prune link ${link.id} (strength=${link.strength})`);
          } else {
            db.prepare("DELETE FROM links WHERE id = ?").run(link.id);
          }
          totalLinksPruned++;
        }
      } else {
        log(`  skipping link pruning (strength column not present)`);
      }
    }

    // 4. Detect and store clusters
    if (tables.includes("links") && tables.includes("memories")) {
      const linkColumns = db.prepare("PRAGMA table_info(links)").all().map(r => r.name);
      if (linkColumns.includes("strength")) {
        const links = db.prepare(`
          SELECT source_id, target_id, strength FROM links WHERE link_type = 'semantic' AND strength >= ?
        `).all(CLUSTER_MIN_STRENGTH);

        const adj = new Map();
        for (const link of links) {
          if (!adj.has(link.source_id)) adj.set(link.source_id, new Set());
          if (!adj.has(link.target_id)) adj.set(link.target_id, new Set());
          adj.get(link.source_id).add(link.target_id);
          adj.get(link.target_id).add(link.source_id);
        }

        const visited = new Set();
        const clusters = [];
        for (const start of adj.keys()) {
          if (visited.has(start)) continue;
          const component = [];
          const queue = [start];
          visited.add(start);
          while (queue.length > 0) {
            const node = queue.shift();
            component.push(node);
            for (const neighbor of (adj.get(node) || [])) {
              if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
              }
            }
          }
          if (component.length >= CLUSTER_MIN_SIZE) {
            clusters.push(component.sort());
          }
        }

        // Ensure clusters table exists
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

        for (const memberIds of clusters) {
          const key = JSON.stringify(memberIds);
          const existing = db.prepare("SELECT id FROM clusters WHERE scope = ? AND member_ids = ?").get("project", key);
          if (existing) continue;

          // Compute average strength for this cluster
          let totalStrength = 0;
          let linkCount = 0;
          for (const link of links) {
            if (memberIds.includes(link.source_id) && memberIds.includes(link.target_id)) {
              totalStrength += link.strength;
              linkCount++;
            }
          }
          const avgStrength = linkCount > 0 ? totalStrength / linkCount : 0;

          if (DRY_RUN) {
            log(`  [dry-run] would store cluster with ${memberIds.length} members (avg_strength=${avgStrength.toFixed(4)})`);
          } else {
            db.prepare("INSERT INTO clusters (scope, member_ids, avg_strength, created_at) VALUES (?, ?, ?, ?)")
              .run("project", key, avgStrength, now);
          }
          totalClustersFound++;
        }
      } else {
        log(`  skipping cluster detection (strength column not present)`);
      }
    }

    // 5. Replay hippocampal memories into neocortex
    if (CONFIG.hippocampus.enabled) {
      const hippMemories = db.prepare(
        "SELECT id, content, created_at FROM memories WHERE tier = 'hippocampus'"
      ).all();

      if (hippMemories.length > 0) {
        const hippIds = new Set(hippMemories.map(m => m.id));
        const hippLinks = db.prepare(
          "SELECT source_id, target_id FROM links WHERE link_type = 'semantic' AND strength >= ?"
        ).all(CLUSTER_MIN_STRENGTH).filter(l => hippIds.has(l.source_id) && hippIds.has(l.target_id));

        // Build adjacency graph from links between hippocampal memories
        const adj = new Map();
        for (const link of hippLinks) {
          if (!adj.has(link.source_id)) adj.set(link.source_id, new Set());
          if (!adj.has(link.target_id)) adj.set(link.target_id, new Set());
          adj.get(link.source_id).add(link.target_id);
          adj.get(link.target_id).add(link.source_id);
        }

        // BFS clustering
        const visited = new Set();
        const hippClusters = [];
        for (const start of adj.keys()) {
          if (visited.has(start)) continue;
          const component = [];
          const queue = [start];
          visited.add(start);
          while (queue.length > 0) {
            const node = queue.shift();
            component.push(node);
            for (const neighbor of (adj.get(node) || [])) {
              if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
              }
            }
          }
          if (component.length >= 2) {
            hippClusters.push(component.sort());
          }
        }

        if (DRY_RUN) {
          for (const cluster of hippClusters) {
            log(`  [dry-run] would replay hippocampal cluster (${cluster.length} members)`);
          }
          log(`  [dry-run] would prune ${hippMemories.length} hippocampal memories`);
        } else if (hippClusters.length > 0 && CONFIG.synthesis.enabled) {
          const { synthesizeCluster } = await import("./synthesize.mjs");
          for (const cluster of hippClusters) {
            const members = cluster.map(id => hippMemories.find(m => m.id === id)).filter(Boolean);
            const contents = members.map(m => m.content).filter(Boolean);
            if (contents.length < 2) continue;

            log(`  replaying hippocampal cluster (${contents.length} members)...`);
            const summary = await synthesizeCluster(contents, CONFIG.synthesis);

            if (summary) {
              const { embeddingService } = await import(join(PLUGIN_DIR, "dist/vector/embedding.js"));
              const { addMemory, addLink } = await import(join(PLUGIN_DIR, "dist/storage/memories.js"));
              const { insertVector } = await import(join(PLUGIN_DIR, "dist/vector/index.js"));

              const now = Date.now();
              const synthId = `synth_${now}_${Math.random().toString(36).substring(2, 11)}`;
              const vector = await embeddingService.embedWithTimeout(summary);

              addMemory(db, shard, {
                id: synthId,
                content: summary,
                vector,
                containerTag: `synth_${shard.scope}_${shard.scopeHash}`,
                tags: ["synthesis", "replayed"],
                type: "synthesis",
                createdAt: now,
                updatedAt: now,
                stability: 5.0,
                lastAccessedAt: now,
                tier: "neocortex",
              });
              await insertVector(synthId, vector, undefined, shard);

              for (const memberId of cluster) {
                addLink(db, synthId, memberId, "replayed_from", undefined, 1.0);
              }

              log(`    → replayed as ${synthId}`);
            }
          }
        }

        // Prune old hippocampal memories past TTL
        if (!DRY_RUN) {
          const ttlMs = CONFIG.hippocampus.ttlDays * 24 * 60 * 60 * 1000;
          const cutoff = Date.now() - ttlMs;
          const expired = db.prepare("SELECT id FROM memories WHERE tier = 'hippocampus' AND created_at < ?").all(cutoff);
          for (const mem of expired) {
            db.prepare("DELETE FROM links WHERE source_id = ? OR target_id = ?").run(mem.id, mem.id);
            db.prepare("DELETE FROM memories WHERE id = ?").run(mem.id);
          }
          if (expired.length > 0) {
            log(`  pruned ${expired.length} expired hippocampal memories`);
          }
        }
      }
    }

    db.close();
  }

  log(`--- Summary ---`);
  log(`Memories pruned:  ${totalPruned}`);
  log(`Memories merged:  ${totalMerged}`);
  log(`Links pruned:     ${totalLinksPruned}`);
  log(`Clusters found:   ${totalClustersFound}`);

  // Synthesis step
  if (CONFIG.synthesis.enabled) {
    log(`--- Synthesis ---`);
    const { main: synthesize } = await import("./synthesize.mjs");
    await synthesize(DRY_RUN);
  }
}

main().catch((err) => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
