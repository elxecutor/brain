# brain

persistent vector memory with semantic graph search and clustering for opencode

## how it works

Text is embedded into vectors via a local transformer model ([all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) or [nomic-embed-text-v1](https://huggingface.co/Xenova/nomic-embed-text-v1) running in ONNX Runtime through `@huggingface/transformers`). Vectors are indexed with [usearch](https://github.com/unum-cloud/usearch) for fast approximate nearest-neighbor search, with an exact-scan fallback. Memories are stored per-project (and per-user) in SQLite shards, automatically created and rotated at configurable capacity. Search queries across all shards in parallel, combining vector similarity with link-graph traversal and an optional FSRS-inspired retrievability curve.

## features

- **semantic search** — embed a query and find nearest neighbors across all shards
- **graph linking** — memories are auto-linked by similarity; traverse the graph from any node
- **clustering** — connected-component clustering on the semantic link graph surfaces groups of related memories
- **multi-shard storage** — project- and user-scoped sqlite shards with automatic rotation at max capacity
- **exact + approximate vector search** — usearch (hnsw) by default, falls back to exact scan
- **optional human-memory model** — fsrs-inspired stability/decay, retrievability-weighted search, periodic consolidation
- **web ui** — react + shadcn/vite browser with search, edit/delete, and multi-select batch operations
- **memory tool** — opencode-native tool (`mode=add`, `mode=search`, `mode=list`, `mode=delete`, `mode=traverse`, `mode=link`) available to the model
- **deduplication** — configurable vector-similarity threshold prevents storing near-duplicate memories
- **auto-linking** — new memories linked to existing ones above a similarity threshold, up to a max connections

## configuration

Configured via `~/.config/opencode/brain.jsonc`:

| field | default | description |
|---|---|---|
| `embeddingModel` | `Xenova/nomic-embed-text-v1` | huggingface model id |
| `similarityThreshold` | `0.6` | minimum similarity for search results |
| `maxMemories` | `10` | memories injected into chat context |
| `webServerEnabled` | `false` | enable the web ui |
| `webServerPort` | `4747` | web ui port |
| `deduplicationSimilarityThreshold` | `0.75` | skip storing memories above this similarity |
| `autoLinkEnabled` | `true` | auto-link new memories to existing ones |
| `humanMemoryModel.enabled` | `false` | enable fsrs-style retrievability weighting |

Full schema in `plugin/src/config.ts:64-107`.

## web ui

Browse, search, edit, and delete memories at `http://localhost:4747`.

```sh
# build the plugin
cd plugin && npm run build

# build the ui
npm run build:ui

# start the web server (also started automatically when opencode loads the plugin)
node -e "import('./dist/web/server.js').then(m => m.startWebServer())"
```

## memory tool

The plugin registers a `memory` tool with opencode. Available modes:

- `add content="..." tags="tag1,tag2"` — store a memory
- `search query="..."` — semantic search across all shards
- `list` — recent memories
- `delete memoryId="..."` — remove a memory
- `link sourceId="..." targetId="..." linkType="..."` — manually connect memories
- `traverse memoryId="..." maxDepth=3` — explore the graph from a node

## project structure

```
plugin/src/
  plugin.ts          — opencode plugin entry point, registers memory tool
  config.ts          — config schema, jsonc parsing, defaults
  logger.ts          — writes to ~/.brain/brain.log
  storage/
    db.ts            — sqlite database helpers
    shard-manager.ts — shard lifecycle, metadata, location index
    memories.ts      — crud for memories, links, clusters, graph traversal
  vector/
    index.ts         — usearch + exact-scan vector indexes, search with clustering
    embedding.ts     — transformer embedding via @huggingface/transformers, local/hub models
  text/
    cosine.ts        — cosine similarity
    tokenize.ts      — language detection, keyword extraction
    strength.ts      — fsrs retrievability calculation
  web/
    server.ts        — http server, api routes, static file serving
    ui/              — react + vite + shadcn app

scripts/
  consolidate.mjs    — manual consolidation pass (fsrs pruning + merging)
```

## development

```sh
cd plugin
npm run build        # tsc
npm run build:ui     # vite build
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run lint         # biome check
```
