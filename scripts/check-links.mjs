import { join } from "path";
import { homedir } from "os";

const { CONFIG, initConfig } = await import(join(homedir(), ".brain/plugin/dist/config.js"));
initConfig(join(homedir(), ".brain"));

const { shardManager } = await import(join(homedir(), ".brain/plugin/dist/storage/shard-manager.js"));
const { getDatabase } = await import(join(homedir(), ".brain/plugin/dist/storage/db.js"));
const { getAllMemories, getLinkedMemories } = await import(join(homedir(), ".brain/plugin/dist/storage/memories.js"));

const allShards = [
  ...shardManager.getAllShards("user", ""),
  ...shardManager.getAllShards("project", ""),
];

let totalLinks = 0;
for (const shard of allShards) {
  const db = getDatabase(shard.dbPath);
  const memories = getAllMemories(db);
  console.log(`\nShard ${shard.id} (${shard.scope}): ${memories.length} memories`);
  for (const mem of memories) {
    const links = getLinkedMemories(db, mem.id);
    totalLinks += links.length;
    if (links.length > 0) {
      console.log(`  ${mem.content.substring(0, 55)}`);
      for (const l of links) {
        const neighbor = l.sourceId === mem.id ? l.targetId : l.sourceId;
        console.log(`    → ${neighbor.substring(0, 20)} (${l.linkType})`);
      }
    }
  }
}
console.log(`\nTotal links: ${totalLinks}`);
