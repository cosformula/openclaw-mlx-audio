# AGENTS.md

## Project Overview

`openclaw-mlx-audio` is an OpenClaw plugin that provides local text-to-speech on Apple Silicon Macs using `mlx-audio`. The TypeScript plugin manages:
- plugin config and OpenClaw integration
- Python server lifecycle (`mlx_audio.server`)
- a local proxy that maps OpenClaw OpenAI-style TTS calls to mlx-audio model parameters

## Tech Stack

- TypeScript (ESM, strict mode)
- Node.js runtime
- Python runtime managed by the plugin at user scope (`~/.openclaw/mlx-audio/venv/`)

## Repository Layout

- `index.ts`: plugin entrypoint
- `src/config.ts`: typed config parsing/defaults
- `src/process-manager.ts`: Python server process start/stop/restart
- `src/venv-manager.ts`: Python venv/bootstrap utilities
- `src/proxy.ts`: OpenAI-compatible proxy endpoint logic
- `src/health.ts`: health checks and restart/backoff logic
- `openclaw.plugin.json`: plugin metadata + config schema
- `scripts/check-schema-sync.mjs`: validates schema consistency
- `skills/mlx-audio/SKILL.md`: agent-facing skill instructions
- `README.md`: English user documentation
- `README.zh-CN.md`: Chinese user documentation
- `docs/design.md`: internal design document

## Development Commands

- `npm run build`: compile TS to `dist/` and verify schema sync
- `npm run check-schema`: run schema consistency check only

## Documentation Consistency Rules

This project has four documentation surfaces. They must stay in sync:

1. **README.md** (English, user-facing)
2. **README.zh-CN.md** (Chinese, user-facing)
3. **skills/mlx-audio/SKILL.md** (agent-facing)
4. **docs/design.md** (internal design)

When changing any of the following, update all four documents:
- Default model or language
- Model list (add/remove/rename)
- Model descriptions or capabilities (e.g. what VoiceDesign does vs Base)
- Config fields (add/remove/rename/change defaults)
- Architecture or proxy behavior
- Commands or tool actions

**README.md and README.zh-CN.md must always be updated together.** Do not change one without the other.

## Writing Style

User-facing documentation (README, SKILL.md):
- Neutral, technical tone. State facts, not opinions.
- Avoid em dashes. Use commas, periods, or restructure sentences.
- No subjective evaluations ("best", "great", "mediocre"). Let specs speak for themselves.
- Recommendations expressed through objective constraints ("8 GB memory limits models to..."), not value judgments.
- Model table format follows mlx-audio upstream: Model / Description / Languages / Repo.

## Coding Guidelines

- Keep changes minimal and scoped to the request.
- Do not commit generated artifacts unless explicitly requested.
- Preserve compatibility with OpenClaw's OpenAI-style TTS integration.
- Treat Python process management and proxy behavior as production-critical paths:
  avoid changing runtime behavior unless required by the task.
- If config schema fields change, update both TypeScript config handling and
  `openclaw.plugin.json`, then run `npm run check-schema`.

## Config Schema

`openclaw.plugin.json` is the single source of truth for plugin config fields.
`src/config.ts` reads defaults from the schema at build time.
`scripts/check-schema-sync.mjs` validates consistency between the two.

When adding or changing config fields:
1. Edit `openclaw.plugin.json` configSchema first
2. Update `src/config.ts` types and defaults to match
3. Run `npm run build` (includes schema sync check)
4. Update all documentation (see rules above)

## Release

- Version lives in both `package.json` and `openclaw.plugin.json` (keep in sync)
- Git tag `v*` triggers CI publish to npm via `.github/workflows/publish.yml`
- npm package: `@cosformula/openclaw-mlx-audio`
- Plugin ID: `openclaw-mlx-audio`
