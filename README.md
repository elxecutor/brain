<div align="center">

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="96" height="96" fill="none">
  <path d="M24 4C18 4 12 8 12 14c0 3 1.5 5.5 3.5 7.5C13 26 10 31 10 36c0 5 4 8 8 8h12c4 0 8-3 8-8 0-5-3-10-5.5-14.5C34.5 19.5 36 17 36 14c0-6-6-10-12-10z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M18 24c0 4 2 8 6 8s6-4 6-8-2-8-6-8-6 4-6 8z" fill="currentColor" opacity="0.15"/>
  <path d="M20 28c0 2 1.5 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>

# brain

*Persistent vector memory with semantic graph search and clustering for opencode*

[Features](#features) • [How it works](#how-it-works) • [Installation](#installation) • [Configuration](#configuration) • [Memory tool](#memory-tool) • [Web UI](#web-ui) • [Scripts](#scripts) • [Development](#development)

</div>

**brain** is an opencode plugin that gives the model a long-term, queryable memory. Text is embedded into vectors with a local transformer model, indexed for approximate nearest-neighbor search, and stored as a semantic knowledge graph that the model can search, traverse, and extend during a conversation.

## Features

- **Two memory tiers** — `neocortex` for permanent, model-driven facts and `hippocampus` for ephemeral, fast-decaying context that is auto-pruned
- **Semantic search** — embed a query and find nearest neighbors across every shard in parallel
- **Graph linking** — memories are auto-linked by similarity; results are enriched by traversing links from direct hits
- **Clustering** — connected-component clustering on the semantic link graph surfaces groups of related memories
- **Active workspace** — a small, session-scoped working set (capacity 5, FIFO eviction) for deliberate multi-step reasoning
- **Human-memory model** — optional FSRS-inspired stability/decay curve that weights search results by retrievability
- **Hebbian learning** — co-activated memories get their semantic links strengthened automatically
- **Deduplication** — configurable similarity threshold prevents storing near-duplicate memories
- **Multi-shard storage** — project- and user-scoped SQLite shards with automatic rotation at max capacity
- **Exact + approximate vector search** — usearch (HNSW) by default, with an exact-scan fallback
- **Web UI** — a React + Vite browser app for browsing, searching, editing, and batch-deleting memories
- **Memory tool** — an opencode-native `memory` tool with `add`, `search`, `link`, `traverse`, `list`, and workspace modes

## How it works

1. **Embed** — content is embedded with a local transformer model ([`all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2), [`nomic-embed-text-v1`](https://huggingface.co/Xenova/nomic-embed-text-v1), or [`all-mpnet-base-v2`](https://huggingface.co/Xenova/all-mpnet-base-v2)) running in ONNX Runtime through `@huggingface/transformers`. API-based models (`text-embedding-3-*`) are supported as an alternative. Models are cached under `~/.brain/.model-cache` so they only download once.
2. **Store** — vectors are written to per-scope SQLite shards (`project` and `user`). Shards rotate automatically once they reach `maxVectorsPerShard`, and orphaned shard files are discovered on startup. SQLite runs in WAL mode via Node's built-in `node:sqlite` (Node 22.5+) or `better-sqlite3`/`bun:sqlite` as fallbacks.
3. **Index** — vectors are inserted into a [usearch](https://github.com/unum-cloud/usearch) HNSW index (cosine metric) with an exact-scan backend for tags and as a fallback.
4. **Search** — queries run across all shards in parallel. The final score combines content-vector similarity, tag similarity (with an exact keyword boost), and — when the human-memory model is enabled — a retrievability multiplier. Results are enriched with linked neighbors and cluster membership.
5. **Learn** — new memories are deduplicated, auto-linked to similar existing ones, and co-activated results strengthen their links (Hebbian learning).

```
embed → SQLite shard (memories + links + clusters) → usearch HNSW index
                                                          ↓
                        query ──→ parallel shard search ──→ graph enrichment ──→ results
```

## Installation

> [!NOTE]
> Requires **Node.js 22.5+** for the built-in `node:sqlite` driver. On older versions, install `better-sqlite3` in the plugin folder.

```sh
cd plugin
npm install
npm run build
```

Then add the plugin to your opencode config (`~/.config/opencode/opencode.json` or `.opencode/opencode.json` in your project):

```jsonc
{
  "plugin": ["/path/to/brain/plugin"]
}
```

The plugin injects `memory` tool instructions into the model's system prompt. Pair it with the companion custom tool at `~/.config/opencode/tools/memory.ts` (see [Memory tool](#memory-tool)).

## Configuration

brain is configured through `~/.config/opencode/brain.jsonc`, optionally overridden per-project in `.opencode/brain.jsonc`. All values are optional.

| Field | Default | Description |
|---|---|---|
| `embeddingModel` | `Xenova/nomic-embed-text-v1` | Hugging Face model id or `text-embedding-3-*` API model |
| `embeddingApiKey` | — | API key required when using API-based embedding |
| `similarityThreshold` | `0.6` | Minimum similarity for search results |
| `maxMemories` | `10` | Memories injected into chat context |
| `language` | — | Force language detection (overrides auto-detect via `franc`) |
| `vectorBackend` | `usearch-first` | `usearch-first`, `usearch`, or `exact-scan` |
| `maxVectorsPerShard` | `50000` | Capacity before a shard rotates |
| `webServerEnabled` | `false` | Enable the web UI |
| `webServerPort` / `webServerHost` | `4747` / `127.0.0.1` | Web UI bind address |
| `deduplicationEnabled` | `true` | Skip storing memories above `deduplicationSimilarityThreshold` (`0.75`) |
| `autoLinkEnabled` | `true` | Auto-link new memories above `autoLinkSimilarityThreshold` (`0.5`), up to `autoLinkMaxConnections` (`3`) |
| `humanMemoryModel.enabled` | `false` | Enable FSRS-style retrievability weighting |
| `hippocampus.enabled` | `false` | Enable the ephemeral memory tier (`capacity` 100, `ttlDays` 7) |
| `synthesis.enabled` | `false` | Summarize clusters into synthesized facts with an LLM |
| `backgroundProcessing.enabled` | `true` | Bound background tasks (queue size 50, 30s timeout) |

The full schema — including consolidation, synthesis, chat-message injection, and compaction settings — is in `plugin/src/config.ts`.

## Memory tool

The plugin registers a `memory` tool with opencode. Available modes:

- `add content="..." tags="tag1,tag2"` — store a permanent memory in neocortex
- `addEphemeral content="..."` — store short-lived context in hippocampus (decays, auto-pruned)
- `search query="..."` — semantic search across all shards; pass `workspace=true` to add top results to the active workspace
- `list` — recent memories
- `link sourceId="..." targetId="..." linkType="semantic|related|depends|reference"` — manually connect memories
- `traverse memoryId="..." maxDepth=3` — explore the graph from a node
- `addToWorkspace memoryId="..."` — explicitly add a memory to the active workspace
- `workspace` — show what's currently active in the session workspace

When the workspace has entries, new `add` calls preferentially link against the active ones.

## Web UI

Browse, search, edit, and batch-delete memories in a browser at `http://127.0.0.1:4747`.

```sh
cd plugin
npm run build          # build the plugin + UI
```

Enable it with `"webServerEnabled": true` and start opencode — the server starts automatically when the plugin loads. For a standalone start:

```sh
node -e "import('./dist/web/server.js').then(m => m.startWebServer())"
```

## Scripts

Operational tooling lives in `scripts/` and expects the plugin to be built (`plugin/dist`):

| Script | Purpose |
|---|---|
| `consolidate.mjs` | Consolidation pass: prune low-retrievability memories, merge near-duplicates, prune weak links, detect clusters, replay hippocampus → neocortex. Use `--dry-run` to preview |
| `synthesize.mjs` | Summarize stored clusters into synthesized facts via an LLM (requires `synthesis` config or `OPENCODE_API_KEY`) |
| `backfill-links.mjs` | Auto-link memories that missed linking at insert time |
| `dedup-cleanup.mjs` | Remove near-duplicate and trivial memories |
| `check-links.mjs` | Report per-shard link statistics |
| `calibrate-coherence.mjs` | Measure embedding coherence against a reference corpus |
| `sync-to-db.mjs` / `sync-to-fs.mjs` | Import markdown files into memory / export memories as markdown |
| `query-test.mjs` | Smoke-test search against a real query |

## Project structure

```
plugin/src/
  plugin.ts          — opencode plugin entry point, injects memory-tool instructions
  config.ts          — config schema, jsonc parsing, defaults
  logger.ts          — writes to ~/.brain/brain.log
  background.ts      — bounded background task queue
  active/workspace.ts — session-scoped active workspace (FIFO eviction)
  storage/
    db.ts            — sqlite driver (node:sqlite, better-sqlite3, bun), WAL, caching
    shard-manager.ts — shard lifecycle, metadata db, location index
    memories.ts      — CRUD for memories, links, clusters, graph traversal
  vector/
    index.ts         — usearch + exact-scan indexes, graph search, hebbian learning
    embedding.ts     — transformer embedding, local model cache, API fallback
  text/
    cosine.ts        — cosine similarity
    tokenize.ts      — language detection, keyword extraction
    strength.ts      — FSRS retrievability calculation
    synthesis.ts     — synthesized-fact types
  web/
    server.ts        — HTTP server, API routes, static file serving
    ui/              — React + Vite + shadcn app

scripts/             — maintenance tooling (see table above)
```

## Development

```sh
cd plugin
npm run build       # tsc + vite build
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run lint        # biome check
npm run format      # biome format
```
