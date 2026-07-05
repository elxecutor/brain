#!/usr/bin/env node
import { join } from "path";
import { homedir } from "os";

const BRAIN_DIR = join(homedir(), ".brain");
const PLUGIN_DIR = join(BRAIN_DIR, "plugin");

async function main() {
  const { CONFIG, initConfig } = await import(join(PLUGIN_DIR, "dist/config.js"));
  const { shardManager } = await import(join(PLUGIN_DIR, "dist/storage/shard-manager.js"));
  const { getDatabase } = await import(join(PLUGIN_DIR, "dist/storage/db.js"));
  const { getAllMemories, deleteMemoryById, addLink, getLinkedMemories } = await import(join(PLUGIN_DIR, "dist/storage/memories.js"));
  const { deleteVector } = await import(join(PLUGIN_DIR, "dist/vector/index.js"));

  initConfig(BRAIN_DIR);

  function isTrivial(content) {
    const t = content.trim();
    if (t.endsWith("?")) return true;
    if (t.length < 15) return true;
    return false;
  }

  const allShards = [
    ...shardManager.getAllShards("user", ""),
    ...shardManager.getAllShards("project", ""),
  ];

  let removed = 0;
  let kept = 0;

  for (const shard of allShards) {
    const db = getDatabase(shard.dbPath);
    const memories = getAllMemories(db);

    for (const mem of memories) {
      if (isTrivial(mem.content)) {
        const links = getLinkedMemories(db, mem.id);
        if (links.length > 0) {
          const keepId = links[0].sourceId === mem.id ? links[0].targetId : links[0].sourceId;
          for (const link of links) {
            const neighbor = link.sourceId === mem.id ? link.targetId : link.sourceId;
            if (neighbor !== keepId) {
              const already = getLinkedMemories(db, keepId);
              const linkedIds = new Set(already.map(l => l.sourceId === keepId ? l.targetId : l.sourceId));
              if (!linkedIds.has(neighbor)) {
                addLink(db, keepId, neighbor, link.linkType || "semantic");
              }
            }
          }
        }
        await deleteVector(mem.id, shard);
        deleteMemoryById(db, shard.id, mem.id, shard.dbPath);
        console.log(`  REMOVED ${mem.id.slice(0, 24)} "${mem.content.slice(0, 60)}"`);
        removed++;
      } else {
        kept++;
      }
    }
  }

  console.log(`\nDone: ${removed} trivial/question memories removed, ${kept} kept`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
