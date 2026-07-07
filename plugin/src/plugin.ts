import type { PluginInput, PluginModule } from "@opencode-ai/plugin";
import { handleChatMessage } from "./capture.js";
import { CONFIG, initConfig } from "./config.js";
import { log } from "./logger.js";
import { embeddingService } from "./vector/embedding.js";
import { startWebServer } from "./web/server.js";

const pluginId = "brain";

async function brainPlugin(input: PluginInput): ReturnType<PluginModule["server"]> {
  log(`init cwd=${input.directory}`);
  initConfig(input.directory);
  log(`storagePath=${CONFIG.storagePath}`);

  embeddingService.warmup().catch((err) => {
    log(`embedding warmup error: ${err}`);
  });

  log(`background processing: ${CONFIG.backgroundProcessing.enabled ? "enabled" : "disabled"}`);

  if (CONFIG.humanMemoryModel.enabled) {
    log(`consolidation interval: ${CONFIG.humanMemoryModel.consolidation.intervalHours}h (manual: node scripts/consolidate.mjs)`);
  }

  const memoryToolInstructions = `You have access to a memory tool called "memory" that stores and retrieves information as a semantic knowledge graph (mesh).

Key capabilities:
- When you learn something new or want to save context, use memory mode=add content="..." to store it.
- Related memories are automatically linked as you capture them.
- Use memory mode=search query="..." to find relevant past information.
- Use memory mode=link sourceId=... targetId=... to manually connect related memories (types: "semantic", "related", "depends", "reference").
- Use memory mode=traverse memoryId=... to explore the graph of linked memories from a starting point.
- Use memory mode=list to see recent stored memories.

INTELLIGENT REASONING:
Search results may include "synthesized" facts — derived information the brain computed from your memories. For example, if a memory says "Born in 1990", the brain synthesizes "Implied age: 36 years". Use these synthesized facts to make intelligent decisions and answer questions without requiring the user to explicitly state derived information.

The brain automatically captures and links chat messages as memories, building a mesh of connected knowledge over time.`;

  if (CONFIG.webServerEnabled) {
    startWebServer();
  }

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(memoryToolInstructions);
    },
    "chat.message": CONFIG.autoCaptureEnabled
      ? async (msgInput, msgOutput) => {
          await handleChatMessage(msgInput, msgOutput, input.directory);
        }
      : undefined,
  };
}

export const id = pluginId;
export { brainPlugin as server };
export default { id, server: brainPlugin } satisfies PluginModule;
