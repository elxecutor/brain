#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const BRAIN_DIR = join(homedir(), ".brain");
const PLUGIN_DIR = join(BRAIN_DIR, "plugin");
const OUTPUT_DIR = join(BRAIN_DIR, "_synced");

async function main() {
  const { CONFIG, initConfig } = await import(join(PLUGIN_DIR, "dist/config.js"));
  const { shardManager } = await import(join(PLUGIN_DIR, "dist/storage/shard-manager.js"));
  const { getDatabase } = await import(join(PLUGIN_DIR, "dist/storage/db.js"));
  const { getAllMemories } = await import(join(PLUGIN_DIR, "dist/storage/memories.js"));

  initConfig(BRAIN_DIR);

  const allShards = [
    ...shardManager.getAllShards("user", ""),
    ...shardManager.getAllShards("project", ""),
  ];

  let exported = 0;
  for (const shard of allShards) {
    const db = getDatabase(shard.dbPath);
    const memories = getAllMemories(db);

    for (const mem of memories) {
      const meta = mem.metadata ? JSON.parse(mem.metadata) : {};
      if (meta.sourceFile) continue;

      const tags = mem.tags && mem.tags.length > 0 ? mem.tags : ["uncategorized"];
      const dirPath = join(OUTPUT_DIR, ...tags);
      const filePath = join(dirPath, `${mem.id}.md`);
      mkdirSync(dirPath, { recursive: true });

      const frontmatter = [
        "---",
        `id: "${mem.id}"`,
        mem.type ? `type: ${mem.type}` : null,
        `created_at: ${mem.createdAt}`,
        `updated_at: ${mem.updatedAt}`,
        `tags: [${(mem.tags || []).join(", ")}]`,
        mem.metadata ? `metadata: ${mem.metadata}` : null,
        "---",
      ].filter(Boolean).join("\n");

      writeFileSync(filePath, `${frontmatter}\n\n${mem.content}\n`);
      console.log(`  OK  ${filePath}`);
      exported++;
    }
  }

  console.log(`\nDone: ${exported} memories exported to ${OUTPUT_DIR}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
