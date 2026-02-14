---
name: mlx-audio
description: "Local TTS on Apple Silicon via mlx-audio. Use when the user asks to generate speech, read text aloud, or manage local TTS settings. Requires the mlx-audio OpenClaw plugin to be installed and enabled."
---

# MLX Audio — Local TTS

Generate speech audio locally on Apple Silicon Macs using mlx-audio models. Zero API key, zero cloud dependency.

## Quick Reference

| Task | How |
|------|-----|
| Check status | `/mlx-tts status` |
| Generate audio | Use `mlx_audio_tts` tool with `action: "generate"` |
| Test voice | `/mlx-tts test Hello world` |

## Tool: mlx_audio_tts

### Generate Speech

```json
{
  "action": "generate",
  "text": "Text to synthesize",
  "outputPath": "/optional/path/to/output.mp3"
}
```

Returns path to generated MP3 file.

### Check Status

```json
{
  "action": "status"
}
```

Returns server status, loaded model, uptime, and config.

## Supported Models

| Model | Best For | Size |
|-------|----------|------|
| Kokoro-82M | Fast English TTS | 82M |
| Qwen3-TTS-0.6B-Base | Chinese/multilingual voice clone | ~1.2G |
| Qwen3-TTS-1.7B-Base | Best quality voice clone | ~3.4G |
| Qwen3-TTS-VoiceDesign | Custom voice design | ~1.2-3.4G |

## Notes

- Audio is generated locally — no data leaves the machine
- First generation after startup may be slower (model warmup)
- Large models (1.7B) may take 30+ seconds for 10s of audio
- Kokoro is recommended for low-latency scenarios
- Server runs as a background subprocess, auto-restarts on crash
