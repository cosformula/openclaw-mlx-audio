# openclaw-mlx-audio

[中文文档](./README.zh-CN.md)

Local TTS plugin for OpenClaw, running on Apple Silicon. No cloud dependency.

## About MLX

[MLX](https://github.com/ml-explore/mlx) is Apple's machine learning framework, optimized for the unified memory architecture of M-series chips. [mlx-audio](https://github.com/Blaizzy/mlx-audio) is an audio processing library built on MLX, supporting text-to-speech (TTS), speech-to-text (STT), and more.

This plugin **only works on Apple Silicon Macs** (M1 and later). Intel Macs, Windows, and Linux are not supported.

**Alternatives for non-Mac users**:
- [openedai-speech](https://github.com/matatonic/openedai-speech): self-hosted, requires NVIDIA GPU
- [Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server): same
- OpenClaw's built-in Edge TTS: free cloud-based option, no GPU required

## Requirements

- macOS + Apple Silicon (M1/M2/M3/M4)
- Python 3.11+ (the plugin manages its own venv)
- OpenClaw running locally

## Available Models

TTS models supported by mlx-audio, sorted by memory usage:

| Model | Disk | RAM (1 worker) | Languages | Notes |
|---|---|---|---|---|
| [Kokoro-82M](https://huggingface.co/mlx-community/Kokoro-82M-bf16) | 345 MB | ~400 MB | EN/JA/ZH/FR/ES/IT/PT/HI | Fast, great English quality. Best for 8GB Macs |
| [Soprano-80M](https://huggingface.co/mlx-community/Soprano-1.1-80M-bf16) | ~300 MB | ~400 MB | EN | Lightweight English TTS |
| [Spark-TTS-0.5B](https://huggingface.co/mlx-community/Spark-TTS-0.5B-bf16) | ~1 GB | ~1 GB | ZH/EN | Mid-size, bilingual |
| [Qwen3-TTS-0.6B-Base](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16) | 2.3 GB | ~1.4 GB | ZH/EN/JA/KO+ | **Default model**. Best Chinese quality |
| [OuteTTS-0.6B](https://huggingface.co/mlx-community/OuteTTS-1.0-0.6B-fp16) | ~1.2 GB | ~1.4 GB | EN | Efficient English TTS |
| [CSM-1B](https://huggingface.co/mlx-community/csm-1b) | ~2 GB | ~2 GB | EN | Conversational style, voice cloning |
| [Dia-1.6B](https://huggingface.co/mlx-community/Dia-1.6B-fp16) | ~3.2 GB | ~3.2 GB | EN | Optimized for dialogue |
| [Qwen3-TTS-1.7B-VoiceDesign](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16) | 4.2 GB | ~3.8 GB | ZH/EN/JA/KO+ | Voice cloning + emotion control. Requires 16GB+ |
| [Chatterbox](https://huggingface.co/mlx-community/chatterbox-fp16) | ~3 GB | ~3.5 GB | 16 languages | Widest language coverage. Requires 16GB+ |

### How to Choose

- **8 GB Mac**: Kokoro-82M (English) or Qwen3-TTS-0.6B-Base (Chinese), with `workers: 1`. The 1.7B model will be OOM-killed by the OS.
- **16 GB Mac**: All models above will work. Use 1.7B-VoiceDesign for voice cloning.
- **Chinese**: Qwen3-TTS series has the best quality. Kokoro supports Chinese but results are mediocre.
- **English**: Kokoro-82M offers the best speed/quality tradeoff.
- **Multilingual**: Chatterbox covers 16 languages but needs more memory.

### Language Codes

For Kokoro and Qwen3-TTS:

| Code | Language |
|---|---|
| `a` | American English |
| `b` | British English |
| `z` | Chinese |
| `j` | Japanese |
| `e` | Spanish |
| `f` | French |

### Voices

Kokoro includes 50+ preset voices:
- American female: `af_heart`, `af_bella`, `af_nova`, `af_sky`
- American male: `am_adam`, `am_echo`
- Chinese female: `zf_xiaobei`
- Chinese male: `zm_yunxi`
- Japanese: `jf_alpha`, `jm_kumo`

Qwen3-TTS uses named voices (e.g. `Chelsie`) and supports voice cloning via reference audio.

If not specified, models use their default voice.

## Quick Start

1. Install the plugin:
   ```bash
   openclaw plugin install @cosformula/openclaw-mlx-audio
   ```
   Or load from a local path in `openclaw.json`:
   ```json
   {
     "plugins": {
       "load": { "paths": ["/path/to/openclaw-mlx-audio"] }
     }
   }
   ```

2. Configure the plugin (`openclaw.json`):
   ```json
   {
     "plugins": {
       "entries": {
         "openclaw-mlx-audio": {
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

3. Point OpenClaw's TTS to the local endpoint:
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

4. Restart OpenClaw. The plugin will create a Python environment, install dependencies, and start the TTS service.

   On first launch, the model will be downloaded (0.6B-Base is ~2.3 GB). There is currently no progress UI; check OpenClaw logs or `ls -la ~/.cache/huggingface/` to monitor. No network needed after download.

## Configuration

All fields are optional. Set in `plugins.entries.openclaw-mlx-audio.config`:

| Field | Default | Description |
|---|---|---|
| `model` | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16` | HuggingFace model ID |
| `port` | `19280` | mlx-audio server port |
| `proxyPort` | `19281` | Proxy port (OpenClaw connects to this) |
| `workers` | `1` | Uvicorn workers (use 1 on low-memory machines) |
| `speed` | `1.0` | Speech speed multiplier |
| `langCode` | `z` | Language code, see table above |
| `voice` | model default | Voice name, e.g. `af_heart` for Kokoro |
| `refAudio` | | Path to reference audio for voice cloning (1.7B VoiceDesign only) |
| `refText` | | Transcript of the reference audio |
| `temperature` | `0.7` | Generation temperature, higher = more variation |
| `autoStart` | `true` | Start TTS service when OpenClaw starts |
| `healthCheckIntervalMs` | `30000` | Health check interval in ms |
| `restartOnCrash` | `true` | Auto-restart on crash |
| `maxRestarts` | `3` | Max consecutive restart attempts |

## How It Works

```
OpenClaw tts() → proxy (:19281) → mlx_audio.server (:19280) → Apple Silicon GPU
                  ↑ injects model,
                    lang_code, speed
```

OpenClaw's TTS client uses the OpenAI `/v1/audio/speech` API, but mlx-audio models require additional parameters (full model ID, language code, etc.) not part of the OpenAI spec.

The proxy intercepts requests, injects configured parameters, and forwards them to the mlx-audio server. OpenClaw requires no code changes — it sees a standard OpenAI TTS endpoint.

The plugin also manages the full server lifecycle:
- Creates and maintains a Python venv (`~/.openclaw/mlx-audio/venv/`)
- Starts the mlx-audio server as a child process
- Auto-restarts on crash (counter resets after 30s of healthy uptime)
- Cleans up stale processes on port conflicts before starting
- Checks available memory before starting, detects OOM kills

## Troubleshooting

**Server crashes 3 times then stops restarting**

Check OpenClaw logs for `[mlx-audio] Last errors:`, which contains stderr from the Python process. Common causes: missing Python dependency, wrong model name, port conflict. After fixing, change any config field to reset the crash counter.

**SIGKILL (out of memory)**

Logs will show `⚠️ Server was killed by SIGKILL (likely out-of-memory)`. Switch to a smaller model or set `workers` to 1.

**Port already in use**

The plugin auto-kills stale processes on the configured port before starting. If it persists: `kill -9 $(lsof -nP -iTCP:19280 -sTCP:LISTEN -t)`

**First startup is slow**

The model is being downloaded. 0.6B-Base is ~2.3 GB, 1.7B is ~4.2 GB. There is no download progress UI yet; check logs or the HuggingFace cache directory.

## License

MIT
