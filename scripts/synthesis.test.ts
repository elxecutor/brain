import { describe, expect, it, beforeEach } from "vitest";
import { CONFIG } from "../plugin/dist/config.js";

describe("synthesis", () => {
  beforeEach(() => {
    CONFIG.synthesis.maxSynthesizedFacts = 10;
  });

  it("should synthesize age from birth year", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m1", content: "User was born in 1990", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("1990"))).toBe(true);
  });

  it("should detect year references", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m2", content: "User started working in 2020", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("2020"))).toBe(true);
  });

  it("should synthesize elapsed time from year", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m3", content: "Started working in 2015", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("since"))).toBe(true);
  });

  it("should infer location hierarchy", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m4", content: "I live in Tokyo", createdAt: Date.now() },
      { id: "m5", content: "Tokyo is in Japan", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("Japan"))).toBe(true);
  });

  it("should infer workplace duration", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m6", content: "I work at Google", createdAt: Date.now() },
      { id: "m7", content: "Started at Google in 2020", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("Google") && f.fact.includes("years"))).toBe(true);
  });

  it("should infer likes category", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m8", content: "I like Python", createdAt: Date.now() },
      { id: "m9", content: "Python is a programming language", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("Interest"))).toBe(true);
  });

  it("should detect relationships", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m10", content: "My wife Alice is a doctor", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("wife") || f.fact.includes("Alice"))).toBe(true);
  });

  it("should detect goals", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m11", content: "My goal is to learn Japanese", createdAt: Date.now() },
    ]);
    expect(result.some((f) => f.fact.includes("Goal"))).toBe(true);
  });

  it("should return empty for content without patterns", async () => {
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m12", content: "The weather is nice today", createdAt: Date.now() },
    ]);
    expect(result).toEqual([]);
  });

  it("should respect maxSynthesizedFacts", async () => {
    CONFIG.synthesis.maxSynthesizedFacts = 2;
    const { synthesizeMemories } = await import("../plugin/dist/text/synthesis.js");
    const result = await synthesizeMemories([
      { id: "m13", content: "Born in 1990", createdAt: Date.now() },
      { id: "m14", content: "I live in Tokyo", createdAt: Date.now() },
      { id: "m15", content: "My goal is to travel", createdAt: Date.now() },
    ]);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});
