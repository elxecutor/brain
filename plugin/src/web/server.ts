import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../config.js";
import { log } from "../logger.js";
import { getDatabase, type Database } from "../storage/db.js";
import { getAllMemories, getMemoryById, deleteMemoryById, type MemoryRecord } from "../storage/memories.js";
import { shardManager, type Shard } from "../storage/shard-manager.js";
import { embeddingService } from "../vector/embedding.js";
import { searchVectors, deleteVector, insertVector } from "../vector/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function serveStatic(pathname: string, res: ServerResponse): boolean {
  const filePath = join(__dirname, pathname === "/" ? "index.html" : pathname);
  if (!existsSync(filePath)) return false;
  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = readFileSync(filePath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
  return true;
}

function writeJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function startWebServer(): void {
  if (!CONFIG.webServerEnabled) return;

  if (!existsSync(join(__dirname, "index.html"))) {
    log(`UI not built — run "npm run build:ui" first`);
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const path = url.pathname;

      if (path === "/api/memories" && req.method === "GET") {
        const allShards = [...shardManager.getAllShards("user", ""), ...shardManager.getAllShards("project", "")];
        const memories: any[] = [];
        for (const shard of allShards) {
          const db = getDatabase(shard.dbPath);
          for (const m of getAllMemories(db)) {
            memories.push({ id: m.id, content: m.content, tags: m.tags, createdAt: m.createdAt });
          }
        }
        memories.sort((a, b) => b.createdAt - a.createdAt);
        writeJson(res, 200, { count: memories.length, memories: memories.slice(0, 100) });
        return;
      }

      function findMemoryAndShard(id: string): { db: Database; shard: Shard; mem: MemoryRecord } | null {
        const dbPath = shardManager.findMemoryShard(id);
        if (dbPath) {
          const shard = shardManager.getShardByDbPath(dbPath);
          if (shard) {
            const db = getDatabase(dbPath);
            const mem = getMemoryById(db, id);
            if (mem) return { db, shard, mem };
          }
        }
        for (const shard of [...shardManager.getAllShards("user", ""), ...shardManager.getAllShards("project", "")]) {
          const db = getDatabase(shard.dbPath);
          const mem = getMemoryById(db, id);
          if (mem) return { db, shard, mem };
        }
        return null;
      }

      if (path.startsWith("/api/memories/") && req.method === "GET") {
        const id = path.slice("/api/memories/".length);
        if (id.includes("/")) {
          writeJson(res, 404, { error: "Not found" });
          return;
        }
        const found = findMemoryAndShard(id);
        if (found) {
          writeJson(res, 200, found.mem);
        } else {
          writeJson(res, 404, { error: "Memory not found" });
        }
        return;
      }

      if (path.startsWith("/api/memories/") && req.method === "PUT") {
        const id = path.slice("/api/memories/".length);
        if (id.includes("/")) {
          writeJson(res, 404, { error: "Not found" });
          return;
        }
        const found = findMemoryAndShard(id);
        if (!found) {
          writeJson(res, 404, { error: "Memory not found" });
          return;
        }
        let body = "";
        for await (const chunk of req) body += chunk;
        const { content } = JSON.parse(body);
        if (!content || typeof content !== "string") {
          writeJson(res, 400, { error: "content required" });
          return;
        }
        const newVector = await embeddingService.embedWithTimeout(content);
        const oldMem = found.mem;
        found.db.prepare(`UPDATE memories SET content = ?, vector = ?, updated_at = ? WHERE id = ?`).run(
          content,
          new Uint8Array(newVector.buffer),
          Date.now(),
          id,
        );
        await deleteVector(id, found.shard);
        await insertVector(id, newVector, oldMem.tagsVector, found.shard);
        writeJson(res, 200, { id, content });
        return;
      }

      if (path.startsWith("/api/memories/") && req.method === "DELETE") {
        const id = path.slice("/api/memories/".length);
        if (id.includes("/")) {
          writeJson(res, 404, { error: "Not found" });
          return;
        }
        const found = findMemoryAndShard(id);
        if (!found) {
          writeJson(res, 404, { error: "Memory not found" });
          return;
        }
        found.db.prepare(`DELETE FROM links WHERE source_id = ? OR target_id = ?`).run(id, id);
        deleteMemoryById(found.db, found.shard.id, id, found.shard.dbPath);
        await deleteVector(id, found.shard);
        writeJson(res, 200, { deleted: id });
        return;
      }

      if (path === "/api/memories/delete" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { ids } = JSON.parse(body);
        if (!Array.isArray(ids) || ids.length === 0) {
          writeJson(res, 400, { error: "ids array required" });
          return;
        }
        const deleted: string[] = [];
        const errors: string[] = [];
        for (const id of ids) {
          const found = findMemoryAndShard(id);
          if (!found) {
            errors.push(id);
            continue;
          }
          found.db.prepare(`DELETE FROM links WHERE source_id = ? OR target_id = ?`).run(id, id);
          deleteMemoryById(found.db, found.shard.id, id, found.shard.dbPath);
          await deleteVector(id, found.shard);
          deleted.push(id);
        }
        writeJson(res, 200, { deleted, errors: errors.length > 0 ? errors : undefined });
        return;
      }

      if (path === "/api/search" && req.method === "GET") {
        const query = url.searchParams.get("q") || "";
        if (!query) {
          writeJson(res, 400, { error: "query required" });
          return;
        }

        const queryVector = await embeddingService.embedWithTimeout(query);
        const allShards = [...shardManager.getAllShards("user", ""), ...shardManager.getAllShards("project", "")];
        const shardResults = await Promise.all(
          allShards.map(async (shard) => {
            const db = getDatabase(shard.dbPath);
            return searchVectors(queryVector, "", shard, db, 10, query);
          }),
        );
        const results = shardResults.flat();
        results.sort((a, b) => b.similarity - a.similarity);
        writeJson(res, 200, { query, count: results.length, results: results.slice(0, 20) });
        return;
      }

      if (path.startsWith("/api/")) {
        writeJson(res, 404, { error: "Not found" });
        return;
      }

      if (path === "/" || path === "") {
        serveStatic("/", res);
        return;
      }

      if (!serveStatic(path, res) && !serveStatic("/", res)) {
        writeJson(res, 404, { error: "Not found" });
      }
    } catch (err: any) {
      writeJson(res, 500, { error: err.message || "Internal error" });
    }
  });

  server.listen(CONFIG.webServerPort, CONFIG.webServerHost, () => {
    log(`web UI at http://${CONFIG.webServerHost}:${CONFIG.webServerPort}`);
  });
}
