#!/usr/bin/env node
import { join } from "node:path";
import { homedir } from "node:os";

const BRAIN_DIR = join(homedir(), ".brain");
const PLUGIN_DIR = join(BRAIN_DIR, "plugin");

async function main() {
  const { CONFIG, initConfig } = await import(join(PLUGIN_DIR, "dist/config.js"));
  const { shardManager } = await import(join(PLUGIN_DIR, "dist/storage/shard-manager.js"));
  const { getDatabase } = await import(join(PLUGIN_DIR, "dist/storage/db.js"));
  const { getAllMemories, getLinkedMemories, addLink } = await import(join(PLUGIN_DIR, "dist/storage/memories.js"));
  const { searchVectors } = await import(join(PLUGIN_DIR, "dist/vector/index.js"));

  initConfig(BRAIN_DIR);

  const allShards = [
    ...shardManager.getAllShards("user", ""),
    ...shardManager.getAllShards("project", ""),
  ];

  let totalLinked = 0;
  let totalSkipped = 0;

  for (const shard of allShards) {
    const db = getDatabase(shard.dbPath);
    db.exec(`CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      link_type TEXT NOT NULL DEFAULT 'related',
      metadata TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(source_id, target_id, link_type)
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id)");
    const memories = getAllMemories(db);
    console.log(`Shard ${shard.id} (${shard.scope}): ${memories.length} memories`);

    for (const mem of memories) {
      const existingLinks = getLinkedMemories(db, mem.id);
      const linkedIds = new Set(
        existingLinks.map(l => l.sourceId === mem.id ? l.targetId : l.sourceId)
      );
      linkedIds.add(mem.id);

      const searchLimit = CONFIG.autoLinkMaxConnections + 5;
      const similar = await searchVectors(
        mem.vector, "", shard, db,
        searchLimit, mem.content,
      );

      let linked = 0;
      for (const match of similar) {
        if (match.id === mem.id) continue;
        if (linkedIds.has(match.id)) continue;
        if (match.similarity < CONFIG.autoLinkSimilarityThreshold - 0.001) continue;
        if (linked >= CONFIG.autoLinkMaxConnections) break;

        addLink(db, mem.id, match.id, "semantic");
        linked++;
        totalLinked++;
        console.log(`  LINK ${mem.id.slice(0, 20)}... → ${match.id.slice(0, 20)}... (${Math.round(match.similarity * 100)}%)`);
      }
      if (linked === 0) totalSkipped++;
    }
  }

  console.log(`\nDone: ${totalLinked} links created across ${allShards.length} shards (${totalSkipped} memories had no new links)`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
