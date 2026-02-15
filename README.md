# @cosformula/mlx-audio

OpenClaw plugin for **local text-to-speech** on Apple Silicon Macs, powered by [mlx-audio](https://github.com/ml-explore/mlx-audio). No API keys, no cloud, no latency penalty — audio is generated on-device.

## Why

- **Privacy**: voice data never leaves your machine
- **Free**: no per-request cost, no API quota
- **Offline**: works without internet (after first model download)
- **Low latency**: comparable to cloud TTS on Apple Silicon

## Requirements

- **macOS with Apple Silicon** (M1/M2/M3/M4)
- **Python 3.11+** (plugin manages its own venv)
- **OpenClaw** running locally

### Memory

| Model | Disk | RAM (1 worker) | Languages |
|---|---|---|---|
| `Kokoro-82M-bf16` | 345 MB | ~400 MB | English, Japanese |
| `Qwen3-TTS-0.6B-Base-bf16` | 2.3 GB | ~1.4 GB | Chinese, English, Japanese |
| `Qwen3-TTS-1.7B-VoiceDesign-bf16` | 4.2 GB | ~3.8 GB | Chinese, English + voice clone |

> **8 GB Mac**: use Kokoro-82M (English) or 0.6B-Base with `workers: 1`. The 1.7B model will likely be killed by the OS.

## Quick Start

1. **Install the plugin**:
   ```bash
   openclaw plugin install @cosformula/mlx-audio
   ```
   Or load from local path in `openclaw.json`:
   ```json
   {
     "plugins": {
       "load": { "paths": ["/path/to/openclaw-mlx-audio"] }
     }
   }
   ```

2. **Configure the plugin** (in `openclaw.json`):
   ```json
   {
     "plugins": {
       "entries": {
         "mlx-audio": {
           "enabled": true,
           "config": {
             "model": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
             "langCode": "z",
             "workers": 1
           }
         }
       }
     }
   }
   ```

3. **Point OpenClaw's TTS to the local endpoint**:
   ```json
   {
     "env": {
       "vars": {
         "OPENAI_TTS_BASE_URL": "http://127.0.0.1:19281/v1"
       }
     },
     "messages": {
       "tts": {
         "provider": "openai",
         "openai": { "apiKey": "local" }
       }
     }
   }
   ```

4. **Restart OpenClaw**. The plugin will:
   - Create a Python venv at `~/.openclaw/mlx-audio/venv/`
   - Install `mlx-audio` and dependencies
   - Start the TTS server on port 19280
   - Start a proxy on port 19281 that injects model/language config

## Configuration

All fields are optional. Set in `plugins.entries.mlx-audio.config`:

| Field | Default | Description |
|---|---|---|
| `model` | `mlx-community/Kokoro-82M-bf16` | HuggingFace model ID |
| `port` | `19280` | mlx-audio server port |
| `proxyPort` | `19281` | Proxy port (this is what OpenClaw connects to) |
| `workers` | `1` | Uvicorn workers (use 1 on low-memory machines) |
| `speed` | `1.0` | Speech speed multiplier |
| `langCode` | `a` | Language: `a` (English), `z` (Chinese), `j` (Japanese) |
| `voice` | *(model default)* | Voice name (e.g. `af_heart` for Kokoro) |
| `refAudio` | — | Path to reference audio for voice cloning (1.7B VoiceDesign only) |
| `refText` | — | Transcript of reference audio |

## Architecture

```
OpenClaw tts() → proxy (:19281) → mlx_audio.server (:19280) → Apple Silicon GPU
                  ↑ injects model,
                    lang_code, speed
```

The proxy exists so OpenClaw's generic OpenAI TTS client doesn't need to know about mlx-audio-specific parameters. It intercepts requests and injects the configured model ID, language code, and speed.

## Troubleshooting

**Server keeps crashing (3 times then stops)**
- Check OpenClaw logs for `[mlx-audio] Last errors:` — it captures stderr from the Python process
- Common causes: missing Python dependency, wrong model name, port conflict
- Fix the issue, then change any config field — the crash counter resets on config change

**SIGKILL (likely OOM)**
- Logs will say: `⚠️ Server was killed by SIGKILL (likely out-of-memory)`
- Switch to a smaller model or reduce `workers` to 1

**Port already in use**
- The plugin auto-kills stale processes on the configured port before starting
- If it persists: `kill -9 $(lsof -nP -iTCP:19280 -sTCP:LISTEN -t)`

## License

MIT
