# @cosformula/mlx-audio

**The missing local TTS for OpenClaw on Apple Silicon.**

OpenClaw supports ElevenLabs, OpenAI, and Edge TTS out of the box — all cloud-based. Existing self-hosted alternatives ([openedai-speech](https://github.com/matatonic/openedai-speech), [Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server)) require NVIDIA GPUs. If you're on a Mac, you're stuck paying per request or sending voice data to someone else's server.

This plugin runs [mlx-audio](https://github.com/Blaizzy/mlx-audio) TTS locally on Apple Silicon. It manages everything — Python venv, model downloads, server lifecycle, crash recovery — so you don't have to.

- **Zero cloud dependency** after first model download
- **Zero cost** per request
- **Zero config** for the Python side — the plugin handles it
- **Comparable latency** to cloud TTS on M-series chips

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

## How It Works

```
OpenClaw tts() → proxy (:19281) → mlx_audio.server (:19280) → Apple Silicon GPU
                  ↑ injects model,
                    lang_code, speed
```

OpenClaw's built-in TTS client speaks the OpenAI `/v1/audio/speech` API. But mlx-audio models need extra parameters (full HuggingFace model ID, `lang_code`, etc.) that OpenAI's API doesn't have.

The proxy sits in between: it intercepts requests, injects the configured parameters, and forwards to the real mlx-audio server. This means OpenClaw doesn't need any code changes — it just talks to what looks like an OpenAI TTS endpoint.

The plugin also manages the full server lifecycle:
- Creates and maintains a Python venv (`~/.openclaw/mlx-audio/venv/`)
- Starts the mlx-audio server as a child process
- Auto-restarts on crash (with smart backoff — counter resets after 30s healthy uptime)
- Cleans up zombie processes on port conflicts
- Warns on low memory before starting, detects OOM kills

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
