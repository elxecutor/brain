import { beforeEach, describe, expect, it, vi } from "vitest";

describe("embedding", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should export embeddingService with embed and embedWithTimeout", async () => {
    const { embeddingService } = await import("./embedding.js");
    expect(embeddingService).toBeDefined();
    expect(typeof embeddingService.embed).toBe("function");
    expect(typeof embeddingService.embedWithTimeout).toBe("function");
  });
});
