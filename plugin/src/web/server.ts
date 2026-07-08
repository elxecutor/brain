import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../config.js";
import { log } from "../logger.js";
import { getDatabase } from "../storage/db.js";
import { getAllMemories, getMemoryById } from "../storage/memories.js";
import { shardManager } from "../storage/shard-manager.js";
import { embeddingService } from "../vector/embedding.js";
import { searchVectors } from "../vector/index.js";

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
            memories.push({ id: m.id, content: m.content?.substring(0, 200), tags: m.tags, createdAt: m.createdAt });
          }
        }
        memories.sort((a, b) => b.createdAt - a.createdAt);
        writeJson(res, 200, { count: memories.length, memories: memories.slice(0, 100) });
        return;
      }

      if (path.startsWith("/api/memories/") && req.method === "GET") {
        const id = path.slice("/api/memories/".length);
        for (const shard of [...shardManager.getAllShards("user", ""), ...shardManager.getAllShards("project", "")]) {
          const db = getDatabase(shard.dbPath);
          const mem = getMemoryById(db, id);
          if (mem) {
            writeJson(res, 200, mem);
            return;
          }
        }
        writeJson(res, 404, { error: "Memory not found" });
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
