# Contributing to brain

Thanks for your interest in improving brain. This document covers how to set up the project, the conventions we follow, and how changes get merged.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

> [!NOTE]
> brain requires **Node.js 22.5+** for the built-in `node:sqlite` driver. On older versions, install `better-sqlite3` inside `plugin/`.

```sh
git clone https://github.com/elxecutor/brain
cd brain/plugin
npm install
npm run build
```

To try your changes in a real session, point your opencode config at your local checkout:

```jsonc
{
  "plugin": ["/absolute/path/to/brain/plugin"]
}
```

Runtime state lives in `~/.brain/`. Delete `~/.brain/data/` to start from a clean database, and check `~/.brain/brain.log` when debugging.

## Development workflow

All commands run from `plugin/`:

| Command | Purpose |
|---|---|
| `npm run build` | Compile the plugin (`tsc`) and build the web UI (`vite`) |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the vitest suite |
| `npm run lint` | Lint with Biome |
| `npm run format` | Format with Biome |

Before opening a pull request, make sure `npm run typecheck`, `npm test`, and `npm run lint` all pass.

## Conventions

- **TypeScript**, strict mode, `NodeNext` module resolution
- **ES modules** — the package is `"type": "module"`; use explicit `.js` extensions in relative imports
- **Formatting** — 2-space indent, double quotes, semicolons; enforced by Biome
- **No comments in source code** — prefer clear names and small functions
- **Errors** are thrown and caught in a tool's `execute()`, then returned via `JSON.stringify`
- **Shared state** uses module-level singletons (`CONFIG`, `shardManager`, `embeddingService`)

## Tests

Tests live in `scripts/*.test.ts` and run under vitest in a Node environment. Add or update tests when you:

- change scoring, ranking, or similarity behaviour
- add a config field or change a default
- touch shard rotation, migrations, or the SQLite schema
- add a new `memory` tool mode

Keep tests deterministic. Avoid network calls — stub the embedding service rather than downloading model weights.

## Pull requests

1. Fork the repository and create a branch from `main` (`feat/graph-pruning`, `fix/shard-rotation`).
2. Keep each pull request focused on a single change.
3. Update the README or config table when you change user-facing behaviour.
4. Write a clear description: what changed, why, and how you verified it.

Commit messages should be short and imperative, for example `Add cluster pruning to consolidation pass`.

> [!IMPORTANT]
> Changes to the SQLite schema must be backward compatible or ship a migration. Users have existing shards that cannot be regenerated.

## Reporting bugs

Open an issue including:

- your OS and `node --version`
- your `brain.jsonc` with any secrets removed
- the relevant excerpt from `~/.brain/brain.log`
- steps to reproduce, expected result, and actual result

## Proposing features

Open an issue describing the problem before writing code. Larger changes — new memory tiers, new scoring models, alternative vector backends — benefit from discussion first, so effort is not wasted on an approach that does not fit the project.

## Security

Do not open a public issue for security problems. Report them privately to the maintainers at <oloyedeelijah23@gmail.com> so a fix can be prepared before disclosure.
