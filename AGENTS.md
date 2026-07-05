# AGENTS.md

## brain — opencode memory plugin

This is the brain plugin: persistent vector memory for opencode.

### Commands

- Build: `cd plugin && npx tsc`
- Typecheck: `cd plugin && npx tsc --noEmit`
- Test: `cd plugin && npx vitest run`
- Lint: `cd plugin && npx biome check src/`
- Format: `cd plugin && npx biome format --write src/`

### Conventions

- TypeScript, strict mode, NodeNext module resolution
- ES modules (`"type": "module"`)
- 2-space indent, double quotes, semicolons
- No comments in source code
- Errors thrown, caught in tool's `execute()` → `JSON.stringify`
- Module-level singletons for shared state (CONFIG, shardManager, embeddingService)

### Key paths

- Plugin source: `plugin/src/`
- Custom tool: `~/.config/opencode/tools/memory.ts`
- Config: `~/.config/opencode/brain.jsonc`
- Data: `~/.brain/data/` (gitignored)
