import { describe, expect, it, beforeEach } from "vitest";
import { CONFIG } from "../plugin/dist/config.js";

describe("synthesis", () => {
  beforeEach(() => {
    CONFIG.synthesis.maxSynthesizedFacts = 3;
  });

  it("should synthesize age from birth year", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m1", content: "User was born in 1990", createdAt: Date.now() },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].derivedFrom).toBe("m1");
    expect(result[0].fact).toContain("1990");
    expect(result[0].fact).toContain("age");
  });

  it("should synthesize elapsed time from ISO date", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m2", content: "Project started on 2024-01-01", createdAt: Date.now() },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].derivedFrom).toBe("m2");
    expect(result[0].fact).toContain("2024");
    expect(result[0].fact).toContain("elapsed");
  });

  it("should return empty for content without date patterns", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m3", content: "The sky is blue and the grass is green", createdAt: Date.now() },
    ]);
    expect(result).toEqual([]);
  });

  it("should deduplicate same-date facts from same memory", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m4", content: "Started in 2024 and began in 2024", createdAt: Date.now() },
    ]);
    const year2024Facts = result.filter((f) => f.fact.includes("2024"));
    expect(year2024Facts.length).toBe(1);
  });

  it("should respect maxSynthesizedFacts", async () => {
    CONFIG.synthesis.maxSynthesizedFacts = 2;
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m6", content: "Born in 1990", createdAt: Date.now() },
      { id: "m7", content: "Started in 2020", createdAt: Date.now() },
      { id: "m8", content: "Created in 2021", createdAt: Date.now() },
    ]);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});
