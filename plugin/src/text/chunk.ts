import { CONFIG } from "../config.js";
import { segmentSentences } from "./tokenize.js";

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

function centroid(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(0);
  const dim = vectors[0].length;
  const sum = new Float32Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  return sum;
}

export async function chunkContent(content: string, embed: (text: string) => Promise<Float32Array>): Promise<string[]> {
  const trimmed = content.trim();
  if (trimmed.length < CONFIG.chunkMaxChars) return [trimmed];

  const sentences = segmentSentences(trimmed);
  if (sentences.length <= 1) return [trimmed];

  const minChunk = CONFIG.chunkMinChars;
  const maxChunk = CONFIG.chunkMaxChars;
  const coherenceThreshold = CONFIG.chunkCoherenceThreshold;

  const embeddings = await Promise.all(sentences.map((s) => embed(s)));

  const chunks: string[] = [];
  let currentSentences: string[] = [];
  let currentVectors: Float32Array[] = [];
  let currentLen = 0;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const vec = embeddings[i];

    if (currentSentences.length === 0) {
      currentSentences.push(s);
      currentVectors.push(vec);
      currentLen = s.length;
      continue;
    }

    const cohere = cosineSimilarity(vec, centroid(currentVectors));

    if (currentLen + s.length <= maxChunk && cohere >= coherenceThreshold) {
      currentSentences.push(s);
      currentVectors.push(vec);
      currentLen += s.length + 1;
    } else {
      const merged = currentSentences.join(" ");
      if (merged.length >= minChunk) {
        chunks.push(merged);
        currentSentences = [s];
        currentVectors = [vec];
        currentLen = s.length;
      } else if (chunks.length > 0) {
        chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${merged}`;
        currentSentences = [s];
        currentVectors = [vec];
        currentLen = s.length;
      } else {
        currentSentences.push(s);
        currentVectors.push(vec);
        currentLen += s.length + 1;
      }
    }
  }

  if (currentSentences.length > 0) {
    const merged = currentSentences.join(" ");
    const last = chunks.length > 0 ? chunks[chunks.length - 1] : null;
    if (last && merged.length < minChunk) {
      chunks[chunks.length - 1] = `${last} ${merged}`;
    } else {
      chunks.push(merged);
    }
  }

  return chunks.length > 0 ? chunks : [trimmed];
}
