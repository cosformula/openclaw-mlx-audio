# @cosformula/mlx-audio

Local OpenClaw plugin that exposes mlx-audio as an OpenAI-compatible TTS endpoint.

## Install

```bash
npm install @cosformula/mlx-audio
```

Then configure as an OpenClaw plugin using `openclaw.plugin.json`.

## Configuration

`configSchema` fields supported by the plugin include:

- `port` (default: `19280`) – local `mlx_audio.server` port
- `proxyPort` (default: `19281`) – local proxy port
- `model` (default: `mlx-community/Kokoro-82M-bf16`)
- `speed` (default: `1.0`)
- `langCode` (`a`, `z`, or `j`)
- `refAudio` / `refText` – optional voice-clone reference inputs

Example:

```json
{
  "port": 19280,
  "proxyPort": 19281,
  "model": "mlx-community/Kokoro-82M-bf16",
  "speed": 1.0,
  "langCode": "a"
}
```

## Notes

The package publishes compiled JavaScript (`dist/`) for runtime and keeps source maps/TS sources out of consumers’ dependency tree.
