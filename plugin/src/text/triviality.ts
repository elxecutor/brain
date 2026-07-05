import { CONFIG } from "../config.js";

const EXEMPLAR_CACHE = new Map<string, Float32Array>();

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

const DEFAULT_EXEMPLARS = [
  "ok",
  "okay",
  "sure",
  "got it",
  "i see",
  "right",
  "thanks",
  "thank you",
  "no",
  "yes",
  "yeah",
  "yep",
  "nope",
  "great",
  "nice",
  "good",
  "gotcha",
  "understood",
  "cool",
  "perfect",
  "alright",
  "fine",
  "done",
  "lol",
  "lmao",
  "omg",
  "idk",
];

let exemplarsSeeded = false;

async function seedExemplars(exemplars: string[], embed: (text: string) => Promise<Float32Array>): Promise<void> {
  await Promise.all(
    exemplars.map(async (ex) => {
      if (!EXEMPLAR_CACHE.has(ex)) {
        EXEMPLAR_CACHE.set(ex, await embed(ex));
      }
    })
  );
  exemplarsSeeded = true;
}

export async function isTrivial(content: string, embed: (text: string) => Promise<Float32Array>): Promise<boolean> {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed.endsWith("?")) return true;
  if (trimmed.length < 15) return true;
  if (/^[.!?]+$/.test(trimmed)) return true;

  const exemplars = CONFIG.trivialExemplars.length > 0 ? CONFIG.trivialExemplars : DEFAULT_EXEMPLARS;

  if (!exemplarsSeeded) {
    await seedExemplars(exemplars, embed);
  }

  const contentVec = await embed(content);
  const threshold = CONFIG.trivialSimilarityThreshold;

  for (const ex of exemplars) {
    const exVec = EXEMPLAR_CACHE.get(ex)!;
    if (cosineSimilarity(contentVec, exVec) >= threshold) {
      return true;
    }
  }

  return false;
}
