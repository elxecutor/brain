import { CONFIG } from "../config.js";

export function computeRetrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 1.0;
  const rf = CONFIG.humanMemoryModel.retrievabilityFactor;
  const d = CONFIG.humanMemoryModel.decayExponent;
  const factor = rf ** (1 / d) - 1;
  const base = 1 + (factor * elapsedDays) / stability;
  return Math.max(0, Math.min(1, base ** d));
}

export function computeReinforcedStability(oldStability: number, rAtAccess: number): { newStability: number } {
  const gapBonus = 1 - rAtAccess;
  const growth = CONFIG.humanMemoryModel.growthFactor * gapBonus;
  const newStability = oldStability * (1 + growth);
  return { newStability };
}
