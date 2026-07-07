import { describe, expect, it } from "vitest";

describe("config", () => {
  it("should load with defaults and expected shape", async () => {
    const { CONFIG } = await import("../plugin/dist/config.js");
    expect(CONFIG).toHaveProperty("storagePath");
    expect(CONFIG).toHaveProperty("embeddingModel");
    expect(CONFIG).toHaveProperty("similarityThreshold");
    expect(CONFIG).toHaveProperty("maxMemories");
    expect(CONFIG).toHaveProperty("memory");
    expect(CONFIG).toHaveProperty("humanMemoryModel");
    expect(CONFIG.humanMemoryModel.enabled).toBe(false);
  });
});
