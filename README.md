<div align="center">

<img src="assets/logo.svg" width="96" alt="brain logo">

# brain

*local-first vector memory plugin for opencode with semantic graph search and clustering*

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.5-3c873a?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6?style=flat-square)](https://www.typescriptlang.org)
[![Biome](https://img.shields.io/badge/code_style-biome-60a5fa?style=flat-square)](https://biomejs.dev)

If this project is useful to you, star it on GitHub.

[Features](#features) • [How it works](#how-it-works) • [Quickstart](#quickstart) • [Configuration](#configuration) • [Memory tool](#memory-tool) • [Web UI](#web-ui) • [Scripts](#scripts) • [Development](#development)

</div>

**brain** gives [opencode](https://opencode.ai) a long-term, queryable memory. Text is embedded into vectors with a local transformer model, indexed for approximate nearest-neighbor search, and stored as a semantic knowledge graph the model can search, traverse, and extend mid-conversation.

Everything runs on your machine: embeddings are computed locally with ONNX Runtime, and memories live in SQLite shards under `~/.brain`. No data leaves your device unless you explicitly opt into an API-based embedding model.

## Features

- **Two memory tiers** — `neocortex` for permanent, model-driven facts; `hippocampus` for ephemeral, fast-decaying context that is auto-pruned
- **Semantic search** — embed a query and find nearest neighbors across every shard in parallel
- **Graph linking** — memories are auto-linked by similarity, and results are enriched by traversing links from direct hits
- **Clustering** — connected-component clustering over the semantic link graph surfaces groups of related memories
- **Active workspace** — a session-scoped working set (capacity 5, FIFO eviction) for deliberate multi-step reasoning
- **Human-memory model** — optional FSRS-inspired stability/decay curve that weights results by retrievability
- **Hebbian learning** — co-activated memories have their semantic links strengthened automatically
- **Deduplication** — a configurable similarity threshold prevents storing near-duplicates
- **Multi-shard storage** — project- and user-scoped SQLite shards with automatic rotation at max capacity
- **Exact + approximate search** — usearch (HNSW) by default, with an exact-scan fallback
- **Web UI** — a React + Vite app for browsing, searching, editing, and batch-deleting memories

## How it works

```
embed → SQLite shard (memories + links + clusters) → usearch HNSW index
                                                          ↓
                        query ──→ parallel shard search ──→ graph enrichment ──→ results
```

1. **Embed** — content is embedded with a local transformer model ([`all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2), [`nomic-embed-text-v1`](https://huggingface.co/Xenova/nomic-embed-text-v1), or [`all-mpnet-base-v2`](https://huggingface.co/Xenova/all-mpnet-base-v2)) running in ONNX Runtime through `@huggingface/transformers`. API models (`text-embedding-3-*`) are supported as an alternative. Weights are cached in `~/.brain/.model-cache` and download once.
2. **Store** — vectors are written to per-scope SQLite shards (`project` and `user`). Shards rotate once they reach `maxVectorsPerShard`, and orphaned shard files are rediscovered on startup. SQLite runs in WAL mode via Node's built-in `node:sqlite`, with `better-sqlite3` and `bun:sqlite` as fallbacks.
3. **Index** — vectors are inserted into a [usearch](https://github.com/unum-cloud/usearch) HNSW index using the cosine metric, backed by an exact-scan index for tags and as a fallback.
4. **Search** — queries run across all shards in parallel. The final score blends content-vector similarity, tag similarity (with an exact keyword boost), and — when the human-memory model is enabled — a retrievability multiplier. Results are enriched with linked neighbors and cluster membership.
5. **Learn** — new memories are deduplicated, auto-linked to similar existing ones, and co-activated results strengthen their links.

## Quickstart

> [!NOTE]
> Requires **Node.js 22.5+** for the built-in `node:sqlite` driver. On older versions, install `better-sqlite3` inside `plugin/`.

```sh
git clone https://github.com/elxecutor/brain
cd brain/plugin
npm install
npm run build
```

Register the plugin in your opencode config (`~/.config/opencode/opencode.json`, or `.opencode/opencode.json` for a single project):

```jsonc
{
  "plugin": ["/path/to/brain/plugin"]
}
```

Start opencode. The plugin injects `memory` tool instructions into the system prompt, and the model can begin storing and recalling facts immediately.

> [!TIP]
> Pair the plugin with the companion custom tool at `~/.config/opencode/tools/memory.ts` so the model can call `memory` directly. See [Memory tool](#memory-tool).

## Configuration

brain reads `~/.config/opencode/brain.jsonc`, optionally overridden per project by `.opencode/brain.jsonc`. Every field is optional.

| Field | Default | Description |
|---|---|---|
| `embeddingModel` | `Xenova/nomic-embed-text-v1` | Hugging Face model id, or a `text-embedding-3-*` API model |
| `embeddingApiKey` | — | API key, required for API-based embedding |
| `similarityThreshold` | `0.6` | Minimum similarity for search results |
| `maxMemories` | `10` | Memories injected into chat context |
| `language` | — | Force a language, overriding auto-detection via `franc` |
| `vectorBackend` | `usearch-first` | `usearch-first`, `usearch`, or `exact-scan` |
| `maxVectorsPerShard` | `50000` | Capacity before a shard rotates |
| `webServerEnabled` | `false` | Enable the web UI |
| `webServerPort` / `webServerHost` | `4747` / `127.0.0.1` | Web UI bind address |
| `deduplicationEnabled` | `true` | Skip memories above `deduplicationSimilarityThreshold` (`0.75`) |
| `autoLinkEnabled` | `true` | Auto-link above `autoLinkSimilarityThreshold` (`0.5`), up to `autoLinkMaxConnections` (`3`) |
| `humanMemoryModel.enabled` | `false` | Enable FSRS-style retrievability weighting |
| `hippocampus.enabled` | `false` | Enable the ephemeral tier (`capacity` 100, `ttlDays` 7) |
| `synthesis.enabled` | `false` | Summarize clusters into synthesized facts with an LLM |
| `backgroundProcessing.enabled` | `true` | Bounded background task queue (size 50, 30s timeout) |

Example:

```jsonc
{
  // Larger model, better recall, slower first run
  "embeddingModel": "Xenova/all-mpnet-base-v2",
  "similarityThreshold": 0.55,
  "webServerEnabled": true,
  "hippocampus": { "enabled": true, "ttlDays": 3 },
  "humanMemoryModel": { "enabled": true }
}
```

The full schema — including consolidation, synthesis, chat-message injection, and compaction settings — lives in [`plugin/src/config.ts`](plugin/src/config.ts).

## Memory tool

The plugin registers a `memory` tool with opencode. Available modes:

| Mode | Example | Description |
|---|---|---|
| `add` | `add content="..." tags="ts,vector"` | Store a permanent memory in neocortex |
| `addEphemeral` | `addEphemeral content="..."` | Store short-lived context in hippocampus |
| `search` | `search query="..." workspace=true` | Semantic search across all shards |
| `list` | `list` | Show recent memories |
| `link` | `link sourceId="..." targetId="..." linkType="semantic"` | Manually connect two memories |
| `traverse` | `traverse memoryId="..." maxDepth=3` | Explore the graph from a node |
| `addToWorkspace` | `addToWorkspace memoryId="..."` | Pin a memory to the active workspace |
| `workspace` | `workspace` | Show the current session workspace |

Link types are `semantic`, `related`, `depends`, and `reference`. When the workspace is non-empty, new `add` calls preferentially link against the active entries.

## Web UI

Browse, search, edit, and batch-delete memories at `http://127.0.0.1:4747`.

```sh
cd plugin
npm run build   # builds the plugin and the UI
```

Set `"webServerEnabled": true` and the server starts automatically when the plugin loads. To run it standalone:

```sh
node -e "import('./dist/web/server.js').then(m => m.startWebServer())"
```

> [!WARNING]
> The web server has no authentication. Keep it bound to `127.0.0.1` unless you place it behind a trusted reverse proxy.

## Scripts

Maintenance tooling lives in `scripts/` and expects a built plugin (`plugin/dist`).

| Script | Purpose |
|---|---|
| `consolidate.mjs` | Prune low-retrievability memories, merge near-duplicates, prune weak links, detect clusters, replay hippocampus → neocortex. Supports `--dry-run` |
| `synthesize.mjs` | Summarize stored clusters into synthesized facts via an LLM |
| `backfill-links.mjs` | Auto-link memories that missed linking at insert time |
| `dedup-cleanup.mjs` | Remove near-duplicate and trivial memories |
| `check-links.mjs` | Report per-shard link statistics |
| `calibrate-coherence.mjs` | Measure embedding coherence against a reference corpus |
| `sync-to-db.mjs` / `sync-to-fs.mjs` | Import markdown into memory / export memories as markdown |
| `query-test.mjs` | Smoke-test search with a real query |

```sh
node scripts/consolidate.mjs --dry-run
```

## Project structure

```
plugin/src/
  plugin.ts            opencode entry point, injects memory-tool instructions
  config.ts            config schema, jsonc parsing, defaults
  logger.ts            writes to ~/.brain/brain.log
  background.ts        bounded background task queue
  active/workspace.ts  session-scoped active workspace (FIFO eviction)
  storage/
    db.ts              sqlite driver (node:sqlite, better-sqlite3, bun), WAL, caching
    shard-manager.ts   shard lifecycle, metadata db, location index
    memories.ts        CRUD for memories, links, clusters, graph traversal
  vector/
    index.ts           usearch + exact-scan indexes, graph search, hebbian learning
    embedding.ts       transformer embedding, local model cache, API fallback
  text/
    cosine.ts          cosine similarity
    tokenize.ts        language detection, keyword extraction
    strength.ts        FSRS retrievability calculation
    synthesis.ts       synthesized-fact types
  web/
    server.ts          HTTP server, API routes, static file serving
    ui/                React + Vite + shadcn app

scripts/               maintenance tooling and tests
```

## Development

```sh
cd plugin
npm run build       # tsc + vite build
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run lint        # biome check
npm run format      # biome format --write
```

Data is stored under `~/.brain/data/` and logs under `~/.brain/brain.log`. Both are safe to delete — brain recreates them on next run.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE)
