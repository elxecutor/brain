import { CONFIG } from "../config.js";

export function computeRetrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 1.0;
  const factor = (1 - CONFIG.humanMemoryModel.retrievabilityFactor) / CONFIG.humanMemoryModel.retrievabilityFactor;
  const base = 1 + (factor * elapsedDays) / stability;
  return Math.max(0, Math.min(1, Math.pow(base, CONFIG.humanMemoryModel.decayExponent)));
}

export function computeReinforcedStability(oldStability: number, rAtAccess: number): { newStability: number } {
  const gapBonus = 1 - rAtAccess;
  const growth = CONFIG.humanMemoryModel.growthFactor * gapBonus;
  const newStability = oldStability * (1 + growth);
  return { newStability };
}
