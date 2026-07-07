import { describe, expect, it } from "vitest";

describe("strength", () => {
  it("computeRetrievability with zero elapsed days returns ~1.0", async () => {
    const { computeRetrievability } = await import("../plugin/dist/text/strength.js");
    const r = computeRetrievability(0, 1.0);
    expect(r).toBeCloseTo(1.0, 2);
  });

  it("computeRetrievability at t=stability returns retrievabilityFactor", async () => {
    const { computeRetrievability } = await import("../plugin/dist/text/strength.js");
    const r = computeRetrievability(1.0, 1.0);
    expect(r).toBeCloseTo(0.9, 1);
  });

  it("computeRetrievability after a long time approaches 0", async () => {
    const { computeRetrievability } = await import("../plugin/dist/text/strength.js");
    const r = computeRetrievability(1000, 1.0);
    expect(r).toBeLessThan(0.1);
  });

  it("computeReinforcedStability: long gap produces larger growth", async () => {
    const { computeReinforcedStability } = await import("../plugin/dist/text/strength.js");
    const low = computeReinforcedStability(1.0, 0.9);
    const high = computeReinforcedStability(1.0, 0.1);
    expect(high.newStability).toBeGreaterThan(low.newStability);
  });
});
