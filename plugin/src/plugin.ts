import type { PluginInput, PluginModule } from "@opencode-ai/plugin";
import { initConfig, CONFIG } from "./config.js";
import { embeddingService } from "./vector/embedding.js";
import { handleChatMessage } from "./capture.js";
import { startWebServer } from "./web/server.js";

const pluginId = "brain";

async function brainPlugin(input: PluginInput): ReturnType<PluginModule["server"]> {
  process.stderr.write(`[brain] init cwd=${input.directory}\n`);
  initConfig(input.directory);
  process.stderr.write(`[brain] storagePath=${CONFIG.storagePath}\n`);

  embeddingService.warmup().catch((err) => {
    process.stderr.write(`[brain] embedding warmup error: ${err}\n`);
  });

  const memoryToolInstructions = `You have access to a memory tool called "memory" that stores and retrieves information as a semantic knowledge graph (mesh).

Key capabilities:
- When you learn something new or want to save context, use memory mode=add content="..." to store it.
- Related memories are automatically linked as you capture them.
- Use memory mode=search query="..." to find relevant past information.
- Use memory mode=link sourceId=... targetId=... to manually connect related memories (types: "semantic", "related", "depends", "reference").
- Use memory mode=traverse memoryId=... to explore the graph of linked memories from a starting point.
- Use memory mode=list to see recent stored memories.

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
