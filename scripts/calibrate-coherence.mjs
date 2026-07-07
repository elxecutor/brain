import { pipeline } from "@huggingface/transformers";
import { homedir } from "node:os";
import { join } from "node:path";

const MODEL_PATH = join(homedir(), ".brain", ".model-cache", "models--Xenova--nomic-embed-text-v1", "snapshots", "main");

const CORPUS = [
  "The new authentication flow uses OAuth 2.0 with PKCE.",
  "Users can log in with their Google or GitHub accounts.",
  "We implemented refresh tokens that last for 30 days.",
  "The token endpoint returns both access and refresh tokens.",
  "Session management is handled through the auth service.",
  "The database migration is scheduled for next weekend.",
  "We need to add indexes on the user_id and created_at columns.",
  "The migration script will run in a transaction with rollback.",
  "Estimated downtime is under 30 seconds.",
  "The frontend team updated the dashboard layout.",
  "Charts now use the new charting library.",
  "The color scheme follows the design system tokens.",
  "Accessibility improvements include better keyboard navigation.",
  "The weather is nice today.",
  "I need to buy groceries after work.",
  "Cats are known for their independent nature.",
];

const UNRELATED_PAIRS = [
  [0, 13], [4, 14], [8, 15],
];

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
  console.log("Coherence calibration for nomic-embed-text-v1");
  console.log("=============================================");

  console.log("Loading from:", MODEL_PATH);
  const pipe = await pipeline("feature-extraction", MODEL_PATH);

  const embeddings = [];
  for (const text of CORPUS) {
    const output = await pipe(text, { pooling: "mean", normalize: true });
    embeddings.push(output.data);
  }

  console.log(`Sentences: ${CORPUS.length}`);
  console.log(`Adjacent pairs: ${CORPUS.length - 1}`);
  console.log(`Unrelated pairs: ${UNRELATED_PAIRS.length}`);
  console.log("");

  const adjacentSims = [];
  for (let i = 0; i < embeddings.length - 1; i++) {
    adjacentSims.push(cosineSimilarity(embeddings[i], embeddings[i + 1]));
  }

  const adjacentMean = adjacentSims.reduce((s, x) => s + x, 0) / adjacentSims.length;
  const sorted = [...adjacentSims].sort((a, b) => a - b);
  const adjacentMedian = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

  const authSims = adjacentSims.slice(0, 4);
  const migrationSims = adjacentSims.slice(5, 8);
  const frontendSims = adjacentSims.slice(9, 12);

  const unrelatedSims = UNRELATED_PAIRS.map(([a, b]) => cosineSimilarity(embeddings[a], embeddings[b]));
  const unrelatedMean = unrelatedSims.reduce((s, x) => s + x, 0) / unrelatedSims.length;

  console.log("Adjacent sentence similarity:");
  console.log(`  Mean:   ${adjacentMean.toFixed(2)}`);
  console.log(`  Median: ${adjacentMedian.toFixed(2)}`);
  console.log(`  Min:    ${Math.min(...adjacentSims).toFixed(2)}`);
  console.log(`  Max:    ${Math.max(...adjacentSims).toFixed(2)}`);
  console.log(`  Side-by-side group (5 auth sentences):      mean ${authSims.length > 0 ? (authSims.reduce((s, x) => s + x, 0) / authSims.length).toFixed(2) : "N/A"}`);
  console.log(`  Side-by-side group (4 migration sentences): mean ${migrationSims.length > 0 ? (migrationSims.reduce((s, x) => s + x, 0) / migrationSims.length).toFixed(2) : "N/A"}`);
  console.log(`  Side-by-side group (4 frontend sentences):  mean ${frontendSims.length > 0 ? (frontendSims.reduce((s, x) => s + x, 0) / frontendSims.length).toFixed(2) : "N/A"}`);
  console.log("");

  console.log("Unrelated pair similarity:");
  console.log(`  Mean: ${unrelatedMean.toFixed(2)}`);
  console.log("");

  const buckets = Array(10).fill(0);
  for (const s of adjacentSims) {
    const idx = Math.min(Math.floor(s * 10), 9);
    buckets[idx]++;
  }
  console.log("Distribution (adjacent only):");
  for (let i = 0; i < 10; i++) {
    console.log(`  ${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}: ${buckets[i]}`);
  }
  console.log("");

  const groupMeans = [authSims, migrationSims, frontendSims]
    .filter(g => g.length > 0)
    .map(g => g.reduce((s, x) => s + x, 0) / g.length);
  const lowestGroupMean = Math.min(...groupMeans);
  const recommendation = Math.max(0.1, Math.round((lowestGroupMean - 0.1) * 100) / 100);
  console.log(`Recommended threshold: ${recommendation.toFixed(2)}`);
  console.log("(roughly 0.1 below the lowest within-group mean)");
}

// Results on 2026-07-06 with Xenova/nomic-embed-text-v1:
// Adjacent mean: 0.41, Within-group mean: 0.36, Unrelated mean: 0.32
// Recommend: 0.35 (just below the lowest group mean, above unrelated mean)
// Default changed from 0.7 to 0.35 in plugin/src/config.ts

main().catch((err) => {
  console.error("Calibration failed:", err);
  process.exit(1);
});
