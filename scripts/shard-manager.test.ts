import { describe, expect, it } from "vitest";

describe("shard-manager", () => {
  it("should export shardManager with expected methods", async () => {
    const mod = await import("../plugin/dist/storage/shard-manager.js");
    expect(mod.shardManager).toBeDefined();
    expect(typeof mod.shardManager.getWriteShard).toBe("function");
    expect(typeof mod.shardManager.getAllShards).toBe("function");
  });
});
