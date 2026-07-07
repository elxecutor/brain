import { CONFIG } from "../config.js";

export enum SalienceLevel {
  Duplicate = "duplicate",
  Related = "related",
  Novel = "novel",
}

export interface SalienceResult {
  level: SalienceLevel;
  similarId: string | null;
  similarity: number;
  stabilityDelta: number;
}

export async function computeSalience(
  content: string,
  embed: (text: string) => Promise<Float32Array>,
  searchExisting: (
    vector: Float32Array,
    limit: number,
  ) => Promise<Array<{ id: string; memory: string; similarity: number }>>,
): Promise<SalienceResult> {
  const vector = await embed(content);
  const results = await searchExisting(vector, 5);

  if (results.length === 0 || results[0].similarity < 0.1) {
    return {
      level: SalienceLevel.Novel,
      similarId: null,
      similarity: results.length > 0 ? results[0].similarity : 0,
      stabilityDelta: Math.max(0.1, (1 - (results.length > 0 ? results[0].similarity : 0)) * 2),
    };
  }

  const top = results[0];

  if (top.similarity >= CONFIG.deduplicationSimilarityThreshold) {
    return {
      level: SalienceLevel.Duplicate,
      similarId: top.id,
      similarity: top.similarity,
      stabilityDelta: 0,
    };
  }

  const relatedThreshold = CONFIG.similarityThreshold * 0.6;

  if (top.similarity >= relatedThreshold) {
    return {
      level: SalienceLevel.Related,
      similarId: top.id,
      similarity: top.similarity,
      stabilityDelta: Math.max(0.1, (1 - top.similarity) * 2),
    };
  }

  if (content.length > CONFIG.chunkMinChars * 2) {
    return {
      level: SalienceLevel.Novel,
      similarId: null,
      similarity: top.similarity,
      stabilityDelta: Math.max(0.1, (1 - top.similarity) * 2),
    };
  }

  return {
    level: SalienceLevel.Related,
    similarId: null,
    similarity: top.similarity,
    stabilityDelta: Math.max(0.1, (1 - top.similarity) * 2),
  };
}
