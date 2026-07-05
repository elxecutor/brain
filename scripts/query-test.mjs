import { join } from "path";
import { homedir } from "os";

const { CONFIG, initConfig } = await import(join(homedir(), ".brain/plugin/dist/config.js"));
initConfig(join(homedir(), ".brain"));

const { shardManager } = await import(join(homedir(), ".brain/plugin/dist/storage/shard-manager.js"));
const { getDatabase } = await import(join(homedir(), ".brain/plugin/dist/storage/db.js"));
const { embeddingService } = await import(join(homedir(), ".brain/plugin/dist/vector/embedding.js"));
const { searchWithGraph } = await import(join(homedir(), ".brain/plugin/dist/vector/index.js"));

const query = "How old is atsuomi?";

const shards = shardManager.getAllShards("project", "");
const qvec = await embeddingService.embedWithTimeout(query);

console.log(`Query: "${query}"`);
console.log();

for (const shard of shards) {
  const db = getDatabase(shard.dbPath);
  const results = await searchWithGraph(qvec, "", shard, db, 10, query);
  console.log(`Shard ${shard.id}: ${results.length} results`);
  for (const r of results) {
    const sim = r.source === "search" ? `${Math.round(r.similarity * 100)}%` : "  —  ";
    const note = r.source === "link" ? ` (linked from ${r.linkedFrom?.slice(0, 16)} via ${r.linkType})` : "";
    console.log(`  ${sim} | ${r.id.slice(0, 24)} | ${r.memory.slice(0, 60)}${note}`);
  }
}
