#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";

const BRAIN_DIR = join(homedir(), ".brain");
const PLUGIN_DIR = join(BRAIN_DIR, "plugin");
const EXCLUDE_DIRS = new Set(["node_modules", "data", "plans", "_synced", ".git", ".model-cache", "dist"]);

async function main() {
  const { CONFIG, initConfig } = await import(join(PLUGIN_DIR, "dist/config.js"));
  const { shardManager } = await import(join(PLUGIN_DIR, "dist/storage/shard-manager.js"));
  const { getDatabase } = await import(join(PLUGIN_DIR, "dist/storage/db.js"));
  const { addMemory, getMemoryById } = await import(join(PLUGIN_DIR, "dist/storage/memories.js"));
  const { embeddingService } = await import(join(PLUGIN_DIR, "dist/vector/embedding.js"));
  const { insertVector } = await import(join(PLUGIN_DIR, "dist/vector/index.js"));

  initConfig(BRAIN_DIR);

  const files = scanMarkdownFiles(BRAIN_DIR, BRAIN_DIR);
  console.log(`Found ${files.length} markdown files`);

  let indexed = 0, skipped = 0, errors = 0;

  for (const file of files) {
    try {
      const contentHash = createHash("sha256").update(file.content).digest("hex");
      const containerTag = `${CONFIG.containerTagPrefix}_project_${createHash("sha256").update(file.relPath).digest("hex").slice(0, 16)}`;
      const { scope, hash } = extractScope(containerTag);
      const shard = shardManager.getWriteShard(scope, hash);
      const db = getDatabase(shard.dbPath);

      const existingId = findExistingMemory(db, file.relPath);
      if (existingId) {
        const existing = getMemoryById(db, existingId);
        if (existing && existing.content === file.content) {
          skipped++;
          continue;
        }
      }

      const tags = pathToTags(file.relPath);
      const memType = pathToType(file.relPath);
      const vector = await embeddingService.embedWithTimeout(file.content);
      const id = existingId || `sync_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const now = Date.now();

      addMemory(db, shard, {
        id, content: file.content, vector,
        containerTag, tags,
        type: memType,
        createdAt: now, updatedAt: now,
        metadata: JSON.stringify({ sourceFile: file.relPath }),
        displayName: file.relPath,
        projectPath: file.relPath,
        projectName: "brain",
      });
      await insertVector(id, vector, undefined, shard);
      shardManager.recordMemoryLocation(id, shard.dbPath);
      indexed++;
      console.log(`  OK  ${file.relPath}`);
    } catch (err) {
      console.error(`  ERR  ${file.relPath} — ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${indexed} indexed, ${skipped} skipped, ${errors} errors`);
  process.exit(errors > 0 ? 1 : 0);
}

function scanMarkdownFiles(dir, baseDir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry) || entry.startsWith(".")) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...scanMarkdownFiles(fullPath, baseDir));
    } else if (extname(entry) === ".md") {
      const content = readFileSync(fullPath, "utf-8");
      results.push({ path: fullPath, relPath: relative(baseDir, fullPath), content });
    }
  }
  return results;
}

function pathToTags(relPath) {
  const parts = relPath.replace(/\.md$/, "").split("/");
  return parts.filter(p => p.length > 0);
}

function pathToType(relPath) {
  const first = relPath.split("/")[0];
  const typeMap = { profile: "profile", projects: "project", logs: "log", notes: "note", scripts: "script" };
  return typeMap[first] || "reference";
}

function extractScope(tag) {
  const parts = tag.split("_");
  if (parts.length >= 3) {
    return { scope: parts[1], hash: parts.slice(2).join("_") };
  }
  return { scope: "user", hash: tag };
}

function findExistingMemory(db, relPath) {
  const rows = db.prepare(
    `SELECT id FROM memories WHERE metadata LIKE ?`
  ).all(`%"sourceFile":"${relPath}"%`);
  return rows.length > 0 ? rows[0].id : null;
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
