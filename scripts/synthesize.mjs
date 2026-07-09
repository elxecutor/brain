#!/usr/bin/env node
import { join } from "node:path";
import { homedir } from "node:os";

const BRAIN_DIR = join(homedir(), ".brain");
const PLUGIN_DIR = join(BRAIN_DIR, "plugin");

async function getConfig() {
  const { CONFIG, initConfig } = await import(join(PLUGIN_DIR, "dist/config.js"));
  initConfig(BRAIN_DIR);
  return CONFIG;
}

function log(msg) {
  process.stdout.write(`[synthesize] ${msg}\n`);
}

function buildMessages(contents, prompt) {
  const items = contents.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
  return [
    { role: "system", content: prompt },
    { role: "user", content: `Please synthesize these related items:\n\n${items}` },
  ];
}

export async function synthesizeCluster(contents, synthesisConfig) {
  const { provider, model, apiUrl, apiKey, temperature, prompt } = synthesisConfig;

  const effectiveProvider = provider || "openai";
  const effectiveModel = model || "gpt-4o-mini";
  const effectiveApiUrl = (apiUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const effectiveApiKey = apiKey || process.env.OPENCODE_API_KEY;
  const effectiveTemperature = temperature ?? 0.5;
  const effectivePrompt = prompt || "Synthesize the following related pieces of information into a concise, coherent summary. Capture the key insights and relationships.";

  if (!effectiveApiKey) {
    throw new Error("No API key available for synthesis. Set synthesis.apiKey in brain.jsonc or OPENCODE_API_KEY env var.");
  }

  const messages = buildMessages(contents, effectivePrompt);
  const url = `${effectiveApiUrl}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${effectiveApiKey}`,
    },
    body: JSON.stringify({
      model: effectiveModel,
      messages,
      temperature: effectiveTemperature,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

export async function main(dryRun = false) {
  const CONFIG = await getConfig();
  const synthesisCfg = CONFIG.synthesis;

  if (!synthesisCfg.enabled) {
    log("Synthesis is disabled in config.");
    return;
  }

  const { shardManager } = await import(join(PLUGIN_DIR, "dist/storage/shard-manager.js"));
  const { getDatabase } = await import(join(PLUGIN_DIR, "dist/storage/db.js"));
  const { getAllClusters, getMemoryById, addMemory, addLink } = await import(
    join(PLUGIN_DIR, "dist/storage/memories.js")
  );
  const { embeddingService } = await import(join(PLUGIN_DIR, "dist/vector/embedding.js"));
  const { insertVector } = await import(join(PLUGIN_DIR, "dist/vector/index.js"));

  const allShards = [
    ...shardManager.getAllShards("user", ""),
    ...shardManager.getAllShards("project", ""),
  ];

  let totalSynthesized = 0;

  for (const shard of allShards) {
    const db = getDatabase(shard.dbPath);
    const clusters = getAllClusters(db);

    for (const cluster of clusters) {
      if (totalSynthesized >= (synthesisCfg.maxSynthesizedFacts || 3)) {
        log(`Reached maxSynthesizedFacts (${synthesisCfg.maxSynthesizedFacts})`);
        return { totalSynthesized };
      }

      const memberContents = cluster.memberIds
        .map((id) => getMemoryById(db, id))
        .filter(Boolean)
        .map((m) => m.content);

      if (memberContents.length < 2) continue;

      if (dryRun) {
        log(`[dry-run] would synthesize cluster #${cluster.id} (${memberContents.length} members)`);
        totalSynthesized++;
        continue;
      }

      log(`Synthesizing cluster #${cluster.id} (${memberContents.length} members)...`);
      const summary = await synthesizeCluster(memberContents, synthesisCfg);

      if (summary) {
        const now = Date.now();
        const id = `synth_${now}_${Math.random().toString(36).substring(2, 11)}`;
        const vector = await embeddingService.embedWithTimeout(summary);

        const writeShard = shardManager.getWriteShard(shard.scope, shard.scopeHash);
        const writeDb = getDatabase(writeShard.dbPath);

        addMemory(writeDb, writeShard, {
          id,
          content: summary,
          vector,
          containerTag: `synth_${shard.scope}_${shard.scopeHash}`,
          tags: ["synthesis", `cluster_${cluster.id}`],
          type: "synthesis",
          createdAt: now,
          updatedAt: now,
          stability: 5.0,
          lastAccessedAt: now,
        });
        await insertVector(id, vector, undefined, writeShard);

        for (const memberId of cluster.memberIds) {
          addLink(writeDb, id, memberId, "reflection_of", undefined, 1.0);
        }

        log(`  → synthesized as ${id}`);
        totalSynthesized++;
      }
    }
  }

  log(`Synthesized: ${totalSynthesized}`);
  return { totalSynthesized };
}

if (process.argv[1]?.endsWith("synthesize.mjs")) {
  const dryRun = process.argv.includes("--dry-run");
  main(dryRun).catch((err) => {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  });
}
