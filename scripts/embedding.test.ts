import { beforeEach, describe, expect, it, vi } from "vitest";

describe("embedding", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should export embeddingService with embed and embedWithTimeout", async () => {
    const { embeddingService } = await import("../plugin/dist/vector/embedding.js");
    expect(embeddingService).toBeDefined();
    expect(typeof embeddingService.embed).toBe("function");
    expect(typeof embeddingService.embedWithTimeout).toBe("function");
  });

  it("should have getDetectedDimensions method", async () => {
    const { embeddingService } = await import("../plugin/dist/vector/embedding.js");
    expect(typeof embeddingService.getDetectedDimensions).toBe("function");
    expect(embeddingService.getDetectedDimensions()).toBeNull();
  });
});
