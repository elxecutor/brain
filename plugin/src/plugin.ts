import type { PluginInput, PluginModule } from "@opencode-ai/plugin";
import { initConfig, CONFIG } from "./config.js";
import { embeddingService } from "./vector/embedding.js";

const pluginId = "brain";

async function brainPlugin(input: PluginInput): ReturnType<PluginModule["server"]> {
  process.stderr.write(`[brain] init cwd=${input.directory}\n`);
  initConfig(input.directory);
  process.stderr.write(`[brain] storagePath=${CONFIG.storagePath}\n`);

  // Start embedding warmup in background (non-blocking)
  embeddingService.warmup().catch((err) => {
    process.stderr.write(`[brain] embedding warmup error: ${err}\n`);
  });

  return {};
}

export const id = pluginId;
export { brainPlugin as server };
export default { id, server: brainPlugin } satisfies PluginModule;
