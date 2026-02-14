# Codex Task: Build mlx-audio OpenClaw Plugin MVP

## What to Build

An OpenClaw plugin (`@cosformula/mlx-audio`) that provides local TTS via mlx-audio on Apple Silicon Macs.

## Architecture

1. **Plugin entry** (`index.ts`) — registers service, tool, commands with OpenClaw plugin API
2. **Process Manager** (`src/process-manager.ts`) — starts/stops/restarts `mlx_audio.server` Python subprocess
3. **Proxy** (`src/proxy.ts`) — lightweight HTTP proxy on port 19281 that injects TTS preset params before forwarding to mlx_audio.server on port 19280
4. **Health Check** (`src/health.ts`) — periodic health check + auto-restart
5. **Config** (`src/config.ts`) — config schema + parsing

## OpenClaw Plugin API

Plugins export a function `(api) => { ... }` or object `{ id, name, register(api) }`.

Key APIs:
- `api.registerService({ id, start, stop })` — background service
- `api.registerTool({ name, description, parameters })` — agent tool  
- `api.registerCommand({ name, description, handler })` — slash commands
- `api.logger` — logging
- `api.config` — current config

Plugin manifest: `openclaw.plugin.json` with `id`, `name`, `configSchema`, etc.

## Config Schema

See `docs/design.md` for full config. Key fields:
- `port` (default 19280) — mlx_audio.server port
- `proxyPort` (default 19281) — proxy port
- `model` — HuggingFace model ID
- `speed`, `langCode`, `refAudio`, `refText` — TTS params
- `autoStart`, `healthCheckIntervalMs`, `restartOnCrash`, `maxRestarts` — process management

## File Structure to Create

```
mlx-audio/
├── package.json              # @cosformula/mlx-audio, type: module
├── tsconfig.json
├── openclaw.plugin.json      # plugin manifest
├── index.ts                  # plugin entry
├── src/
│   ├── config.ts             # config types + defaults + validation
│   ├── proxy.ts              # HTTP proxy server
│   ├── process-manager.ts    # mlx_audio.server subprocess management
│   └── health.ts             # health check logic
├── skills/
│   └── mlx-audio/
│       └── SKILL.md          # skill for the agent
└── docs/
    └── design.md             # (already exists)
```

## Proxy Logic

The proxy receives OpenAI-compatible TTS requests:
```json
{ "model": "...", "input": "text", "voice": "default" }
```

And injects configured params before forwarding:
```json
{ "model": "full-hf-model-id", "input": "text", "speed": 1.0, "lang_code": "z", "ref_audio": "...", "ref_text": "...", "temperature": 0.7, "response_format": "mp3" }
```

Response is streamed back as audio.

## Process Manager

- Spawns: `python -m mlx_audio.server --port 19280`
- Handles: stdout/stderr logging, crash detection, auto-restart (up to maxRestarts)
- Provides: start(), stop(), restart(), isRunning(), getStatus()

## Tool

```
name: mlx_audio_tts
actions: generate | list_models | load_model | status
```

## Commands

```
/mlx-tts status — server status, loaded model, memory
/mlx-tts test <text> — generate test audio
```

## Important

- Use TypeScript, ESM (type: module)
- No external deps besides node built-ins (http, child_process, path, etc.)
- The proxy and process manager should be robust (error handling, timeouts)
- Follow OpenClaw plugin conventions from the docs
- Keep it simple — this is MVP
