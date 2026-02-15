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

## Commands

| Command | Description |
|---|---|
| `/mlx-tts status` | Server status and loaded model |
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
- First generation may be slower due to model warmup.
- The server runs as a background subprocess and auto-restarts on crash.
- Config is set in `openclaw.json` under `plugins.entries.openclaw-mlx-audio.config`. Model, language, and voice changes require a gateway restart.
