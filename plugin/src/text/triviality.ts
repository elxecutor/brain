import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../config.js";
import { cosineSimilarity } from "./cosine.js";
import { detectLanguage } from "./tokenize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadExemplars(): Record<string, string[]> {
  try {
    const raw = readFileSync(join(__dirname, "exemplars/eng.json"), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { eng: [] };
  }
}

const BUILTIN_EXEMPLARS = loadExemplars();
const EXEMPLAR_CACHE = new Map<string, Float32Array>();

let seedPromise: Promise<void> | null = null;

async function seedExemplars(exemplars: string[], embed: (text: string) => Promise<Float32Array>): Promise<void> {
  await Promise.all(
    exemplars.map(async (ex) => {
      if (!EXEMPLAR_CACHE.has(ex)) {
        EXEMPLAR_CACHE.set(ex, await embed(ex));
      }
    }),
  );
}

export async function isTrivial(content: string, embed: (text: string) => Promise<Float32Array>): Promise<boolean> {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (trimmed.endsWith("?")) return true;
  if (trimmed.length < 15) return true;
  if (/^[.!?]+$/.test(trimmed)) return true;

  const lang = detectLanguage(content);
  const langExemplars = BUILTIN_EXEMPLARS[lang] || BUILTIN_EXEMPLARS.eng || [];
  const exemplars = [...langExemplars, ...CONFIG.trivialExemplars];

  if (!seedPromise) {
    seedPromise = seedExemplars(exemplars, embed);
  }
  await seedPromise;

  const contentVec = await embed(content);
  const threshold = CONFIG.trivialSimilarityThreshold;

  for (const ex of exemplars) {
    const exVec = EXEMPLAR_CACHE.get(ex);
    if (exVec && cosineSimilarity(contentVec, exVec) >= threshold) {
      return true;
    }
  }

  return false;
}
