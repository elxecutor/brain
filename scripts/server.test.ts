import { describe, expect, it } from "vitest";

describe("web server", () => {
  it("should export startWebServer function", async () => {
    const mod = await import("../plugin/dist/web/server.js");
    expect(typeof mod.startWebServer).toBe("function");
  });
});
