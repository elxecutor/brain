import { CONFIG } from "./config.js";
import { log } from "./logger.js";
import { getDatabase } from "./storage/db.js";
import { getMemoryById } from "./storage/memories.js";
import { shardManager } from "./storage/shard-manager.js";
import { embeddingService } from "./vector/embedding.js";
import { searchVectors } from "./vector/index.js";

const DAY_MS = 86400000;

function belongsToSession(metadata: string | undefined, sessionID: string): boolean {
  try {
    return JSON.parse(metadata ?? "{}").sessionID === sessionID;
  } catch {
    return false;
  }
}

export async function recallMemories(query: string, sessionID: string): Promise<string | undefined> {
  const shards = [...shardManager.getAllShards("user", ""), ...shardManager.getAllShards("project", "")];
  const text = `Relevant memory for answering user: ${query}`;
  const vector = await embeddingService.embedWithTimeout(text);
  const matches = await Promise.all(
    shards.map(async (shard) => {
      const db = getDatabase(shard.dbPath);
      const results = await searchVectors(vector, "", shard, db, CONFIG.chatMessage.maxMemories, text);
      return results.map((result) => ({ result, record: getMemoryById(db, result.id) }));
    }),
  );

  const cutoff = CONFIG.chatMessage.maxAgeDays === undefined ? 0 : Date.now() - CONFIG.chatMessage.maxAgeDays * DAY_MS;
  const unique = new Map<string, { content: string; similarity: number }>();
  for (const { result, record } of matches.flat()) {
    if (!record || record.createdAt < cutoff) continue;
    if (CONFIG.chatMessage.excludeCurrentSession && belongsToSession(record.metadata, sessionID)) continue;
    const prior = unique.get(result.id);
    if (!prior || prior.similarity < result.similarity) {
      unique.set(result.id, { content: result.memory, similarity: result.similarity });
    }
  }

  const memories = [...unique.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, CONFIG.chatMessage.maxMemories);
  if (!memories.length) return undefined;
  return `Relevant memories (background context; verify against the current conversation):\n${memories.map((memory) => `- ${memory.content}`).join("\n")}`;
}

export function createRecallHooks() {
  const recalled = new Map<string, string>();
  const seen = new Set<string>();

  return {
    async onMessage(sessionID: string, query: string): Promise<void> {
      if (!CONFIG.chatMessage.enabled || !query.trim()) return;
      if (CONFIG.chatMessage.injectOn === "first" && seen.has(sessionID)) {
        recalled.delete(sessionID);
        return;
      }
      seen.add(sessionID);
      try {
        const context = await recallMemories(query, sessionID);
        if (context) recalled.set(sessionID, context);
        else recalled.delete(sessionID);
      } catch (error) {
        log(`automatic recall failed: ${error}`);
        seen.delete(sessionID);
      }
    },
    context(sessionID: string | undefined): string | undefined {
      return sessionID ? recalled.get(sessionID) : undefined;
    },
  };
}
