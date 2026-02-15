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

## Development Commands

- `npm run build`: compile TS to `dist/` and verify schema sync
- `npm run check-schema`: run schema consistency check only

## Coding Guidelines For Agents

- Keep changes minimal and scoped to the request.
- Do not commit generated artifacts unless explicitly requested.
- Preserve compatibility with OpenClaw's OpenAI-style TTS integration.
- Treat Python process management and proxy behavior as production-critical paths:
  avoid changing runtime behavior unless required by the task.
- If config schema fields change, update both TypeScript config handling and
  `openclaw.plugin.json`, then run `npm run check-schema`.
