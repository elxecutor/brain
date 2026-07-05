import { createHash } from "node:crypto";
import { CONFIG } from "./config.js";
import { getDatabase } from "./storage/db.js";
import { addLink, addMemory } from "./storage/memories.js";
import { shardManager } from "./storage/shard-manager.js";
import { chunkContent } from "./text/chunk.js";
import { isTrivial } from "./text/triviality.js";
import { embeddingService } from "./vector/embedding.js";
import { insertVector, searchVectors } from "./vector/index.js";

function extractScope(tag: string): { scope: string; hash: string } {
  const parts = tag.split("_");
  if (parts.length >= 3) {
    return { scope: parts[1], hash: parts.slice(2).join("_") };
  }
  return { scope: "user", hash: tag };
}

function extractText(parts: unknown[]): string {
  const texts: string[] = [];
  for (const part of parts as any[]) {
    if (part?.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
    }
  }
  return texts.join(" ");
}

async function storeChunk(
  content: string,
  vector: Float32Array,
  containerTag: string,
  shard: any,
  db: any,
  sessionId: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const id = `cap_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = Date.now();

  addMemory(db, shard, {
    id,
    content,
    vector,
    containerTag,
    createdAt: now,
    updatedAt: now,
    metadata: metadata ? JSON.stringify(metadata) : JSON.stringify({ sessionID: sessionId }),
  });

  await insertVector(id, vector, undefined, shard);
  shardManager.recordMemoryLocation(id, shard.dbPath);
  return id;
}

async function autoLinkMemory(
  id: string,
  vector: Float32Array,
  content: string,
  containerTag: string,
  shard: any,
  db: any,
): Promise<void> {
  if (!CONFIG.autoLinkEnabled) return;
  try {
    const similar = await searchVectors(vector, containerTag, shard, db, CONFIG.autoLinkMaxConnections + 1, content);
    let linked = 0;
    for (const match of similar) {
      if (match.id === id) continue;
      if (match.similarity < CONFIG.autoLinkSimilarityThreshold - 0.001) continue;
      if (linked >= CONFIG.autoLinkMaxConnections) break;
      addLink(db, id, match.id, "semantic");
      linked++;
    }
    if (linked === 0 && similar.length > 0) {
      const best = similar.find((m) => m.id !== id);
      if (best) {
        addLink(db, id, best.id, "semantic");
      }
    }
  } catch {
    // auto-linking is best-effort
  }
}

export async function captureChatMessage(
  content: string,
  directory: string,
  sessionId: string,
  metadata?: Record<string, unknown>,
): Promise<string | null> {
  if (!CONFIG.autoCaptureEnabled) return null;
  if (!content || content.length < 10) return null;
  if (await isTrivial(content, (t) => embeddingService.embedWithTimeout(t))) return null;

  const containerTag = `${CONFIG.containerTagPrefix}_project_${createHash("sha256").update(directory).digest("hex").slice(0, 16)}`;
  const { scope, hash } = extractScope(containerTag);
  const shard = shardManager.getWriteShard(scope, hash);
  const db = getDatabase(shard.dbPath);

  const chunks = await chunkContent(content, (t) => embeddingService.embedWithTimeout(t));
  let firstId: string | null = null;
  let prevId: string | null = null;

  for (const chunk of chunks) {
    const vector = await embeddingService.embedWithTimeout(chunk);

    if (CONFIG.deduplicationEnabled) {
      try {
        const similar = await searchVectors(vector, containerTag, shard, db, 1, chunk);
        if (similar.length > 0 && similar[0].similarity >= CONFIG.deduplicationSimilarityThreshold) {
          if (!firstId) firstId = similar[0].id;
          if (prevId && prevId !== similar[0].id) {
            addLink(db, prevId, similar[0].id, "sequence");
          }
          prevId = similar[0].id;
          continue;
        }
      } catch {
        // best-effort
      }
    }

    const id = await storeChunk(chunk, vector, containerTag, shard, db, sessionId, metadata);
    if (!firstId) firstId = id;

    if (prevId) {
      addLink(db, prevId, id, "sequence");
    }
    prevId = id;

    await autoLinkMemory(id, vector, chunk, containerTag, shard, db);
  }

  return firstId;
}

export async function handleChatMessage(
  input: { sessionID: string; agent?: string; messageID?: string },
  output: { message: any; parts: unknown[] },
  directory: string,
): Promise<void> {
  if (!CONFIG.autoCaptureEnabled) return;

  const textContent = extractText(output.parts);
  if (!textContent) return;

  try {
    const id = await captureChatMessage(textContent, directory, input.sessionID, {
      sessionID: input.sessionID,
      agent: input.agent,
      messageID: input.messageID,
    });
    if (id) {
      process.stderr.write(`[brain] auto-captured: ${id}\n`);
    }
  } catch (err) {
    process.stderr.write(`[brain] auto-capture error: ${err}\n`);
  }
}
