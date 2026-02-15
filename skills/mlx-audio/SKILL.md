---
name: mlx-audio
description: "Local TTS on Apple Silicon via mlx-audio. Use when the user asks to generate speech, read text aloud, or manage local TTS settings. Requires the mlx-audio OpenClaw plugin to be installed and enabled."
---

# MLX Audio — Local TTS

Generate speech locally on Apple Silicon using mlx-audio. No API key, no cloud dependency.

## Tool: mlx_audio_tts

### Generate Speech

```json
{
  "action": "generate",
  "text": "Text to synthesize",
  "outputPath": "/optional/path/to/output.mp3"
}
```

Returns path to generated audio file. `outputPath` is restricted to `/tmp` or `~/.openclaw/mlx-audio/outputs`, and symbolic-link path segments are rejected.

### Check Status

```json
{
  "action": "status"
}
```

Returns server status, loaded model, uptime, and config.
Also includes startup phase and approximate model cache download progress when warming up.

## Commands

| Command | Description |
|---|---|
| `/mlx-tts status` | Server status, startup phase, and approximate model cache progress |
| `/mlx-tts test <text>` | Generate and send a test audio |

## Models

| Model | Languages | Description |
|---|---|---|
| Kokoro-82M (default) | EN, JA, ZH, FR, ES, IT, PT, HI | Lightweight, multilingual, 54 preset voices |
| Qwen3-TTS-0.6B-Base | ZH, EN, JA, KO, and more | Higher Chinese quality. Supports 3-second reference audio voice cloning |
| Qwen3-TTS-1.7B-VoiceDesign | ZH, EN, JA, KO, and more | Generates voices from natural language descriptions. Requires 16 GB+ |
| Chatterbox | 16 languages | Widest language coverage. Requires 16 GB+ |

## Notes

- Audio is generated locally. No data leaves the machine.
- Proxy starts first. The server warms up in the background when `autoStart` is enabled, otherwise it starts on first generation request or `GET /v1/models`.
- Startup readiness requires `/v1/models` to pass health check within about 10 seconds. If not ready, the request returns unavailable and startup is retried on the next request.
- Startup status tracks phase and approximate model cache progress (text bar + percentage). The same status appears in startup timeout error details returned to OpenClaw.
- `pythonEnvMode: managed` (default) bootstraps `uv`, syncs `~/.openclaw/mlx-audio/runtime/` from bundled `pyproject.toml` and `uv.lock`, and launches with `uv run --project ...`.
- `pythonEnvMode: external` uses `pythonExecutable` directly after validating Python 3.11-3.13 and required modules.
- First generation may be slower due to model warmup.
- The server runs as a background subprocess and auto-restarts on crash.
- Proxy requests are canceled upstream when the downstream client disconnects before completion.
- Generated audio is streamed to disk, and payloads larger than 64 MB are rejected to avoid memory spikes.
- Output path safety checks use async filesystem operations and still reject symbolic-link path segments.
- Config is set in `openclaw.json` under `plugins.entries.openclaw-mlx-audio.config`. Model, language, voice, or Python runtime mode changes require a gateway restart.
