import { describe, expect, it, beforeEach } from "vitest";
import { CONFIG } from "../plugin/dist/config.js";

describe("synthesis", () => {
  beforeEach(() => {
    CONFIG.synthesis.maxSynthesizedFacts = 20;
  });

  it("should extract years and compute elapsed time", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m1", content: "User was born in 1990", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("1990"))).toBe(true);
  });

  it("should extract named entities", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m2", content: "I work at Google", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("Google"))).toBe(true);
  });

  it("should extract numbers", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m3", content: "The price is 42.50", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("42.50"))).toBe(true);
  });

  it("should find shared concepts across memories", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m4", content: "I love Python programming", createdAt: Date.now() },
      { id: "m5", content: "Python is my favorite language", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("Shared") && f.fact.includes("python"))).toBe(true);
  });

  it("should handle any topic", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m6", content: "The mitochondria is the powerhouse of the cell", createdAt: Date.now() },
      { id: "m7", content: "Mitochondria produce ATP through cellular respiration", createdAt: Date.now() },
    ]);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should handle random text", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m8", content: "asdfgh jkl qwer", createdAt: Date.now() },
    ]);
    expect(result).toEqual([]);
  });

  it("should respect maxSynthesizedFacts", async () => {
    CONFIG.synthesis.maxSynthesizedFacts = 2;
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m9", content: "Born in 1990", createdAt: Date.now() },
      { id: "m10", content: "I live in Tokyo", createdAt: Date.now() },
      { id: "m11", content: "My goal is to travel", createdAt: Date.now() },
      { id: "m12", content: "I work at Google", createdAt: Date.now() },
    ]);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});
