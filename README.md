# brain

Persistent vector memory for opencode. A plugin that stores, searches, and
links knowledge via embeddings and SQLite, with a custom `memory()` tool.

## Quick start

```bash
# Install plugin dependencies
cd plugin && npm install

# Build
npx tsc

# Verify the plugin loads
node --input-type=module -e "import('/home/atsuomi/.config/opencode/tools/memory.ts')"
```

## Project structure

```
plugin/src/          ← TypeScript source
  config.ts          — config loader from ~/.config/opencode/brain.jsonc
  plugin.ts          — opencode plugin entry point
  storage/            — SQLite shard manager, memory CRUD, links
  vector/             — embedding (transformers/API) + ANN index (usearch)
~/.config/opencode/
  tools/memory.ts    — custom memory tool (add/search/link/traverse)
  brain.jsonc        — plugin configuration
```

## Commands

| Command | Purpose |
|---------|---------|
| `npx tsc --noEmit` | Typecheck |
| `npx tsc` | Build to `dist/` |
| `npx vitest run` | Run tests |
| `npx biome check src/` | Lint |
