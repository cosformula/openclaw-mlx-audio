# openclaw-mlx-audio

[中文文档](./README.zh-CN.md)

Local TTS plugin for OpenClaw, powered by [mlx-audio](https://github.com/Blaizzy/mlx-audio) on Apple Silicon.

## MLX and Platform Compatibility

[MLX](https://github.com/ml-explore/mlx) is Apple's machine learning framework, optimized for the unified memory architecture of M-series chips. This plugin depends on MLX and therefore **only runs on Apple Silicon Macs** (M1 and later).

Intel Macs, Windows, and Linux are not supported. Alternatives for those platforms:
- [openedai-speech](https://github.com/matatonic/openedai-speech) (self-hosted, requires NVIDIA GPU)
- [Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server) (same)
- OpenClaw's built-in Edge TTS (cloud-based, no GPU required)

## Requirements

- macOS, Apple Silicon (M1 and later)
- Python 3.11+ (the plugin manages its own venv)
- OpenClaw

## Models

The default model is Kokoro-82M. The following models are selected for distinct use cases:

| Model | Description | Languages | Repo |
|---|---|---|---|
| **Kokoro** | Fast, multilingual TTS with 54 voice presets | EN, JA, ZH, FR, ES, IT, PT, HI | [Kokoro-82M-bf16](https://huggingface.co/mlx-community/Kokoro-82M-bf16) |
| **Qwen3-TTS Base** | Alibaba's multilingual TTS with 3-second voice cloning | ZH, EN, JA, KO, and more | [0.6B-Base-bf16](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16) |
| **Qwen3-TTS VoiceDesign** | Generates voices from natural language descriptions | ZH, EN, JA, KO, and more | [1.7B-VoiceDesign-bf16](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16) |
| **Chatterbox** | Expressive multilingual TTS | EN, ES, FR, DE, IT, PT, and 10 more | [chatterbox-fp16](https://huggingface.co/mlx-community/chatterbox-fp16) |

mlx-audio supports additional models (Soprano, Spark-TTS, OuteTTS, CSM, Dia, etc.). See the [mlx-audio README](https://github.com/Blaizzy/mlx-audio#supported-models) for the full list.

### Qwen3-TTS Model Variants

| Variant | Description |
|---|---|
| **Base** | Foundation model. Supports voice cloning from 3-second reference audio. Can be fine-tuned. |
| **VoiceDesign** | Generates voices from natural language descriptions (e.g. "a deep male voice with a British accent"). Does not accept reference audio. |
| **CustomVoice** | Provides 9 preset voices with instruction-based style control. |

Currently, mlx-community offers MLX-converted versions of 0.6B-Base and 1.7B-VoiceDesign.

### Selection Guide

Memory usage reference:

| Model | Disk | RAM (1 worker) |
|---|---|---|
| Kokoro-82M | 345 MB | ~400 MB |
| Qwen3-TTS-0.6B-Base | 2.3 GB | ~1.4 GB |
| Qwen3-TTS-1.7B-VoiceDesign | 4.2 GB | ~3.8 GB |
| Chatterbox | ~3 GB | ~3.5 GB |

- **8 GB Mac**: Kokoro-82M or Qwen3-TTS-0.6B-Base with `workers: 1`. Models at 1.7B and above will be terminated by the OS due to insufficient memory.
- **16 GB and above**: All models listed above are viable.
- **Chinese**: Qwen3-TTS series. Kokoro supports Chinese but produces lower quality output compared to Qwen3-TTS.
- **English**: Kokoro-82M has the smallest footprint and lowest latency.
- **Multilingual**: Chatterbox covers 16 languages.

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

| Category | Examples |
|---|---|
| American female | `af_heart`, `af_bella`, `af_nova`, `af_sky` |
| American male | `am_adam`, `am_echo` |
| Chinese female | `zf_xiaobei` |
| Chinese male | `zm_yunxi` |
| Japanese | `jf_alpha`, `jm_kumo` |

Qwen3-TTS Base clones voices from reference audio (`refAudio`). VoiceDesign generates voices from natural language descriptions (`instruct`).

When not specified, models use their default voice.

## Installation and Configuration

### 1. Install the Plugin

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

### 2. Configure the Plugin

Set options in `plugins.entries.openclaw-mlx-audio.config` within `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-mlx-audio": {
        "enabled": true,
        "config": {}
      }
    }
  }
}
```

The default configuration uses Kokoro-82M with American English. For Chinese, set `model` and `langCode`:

```json
{
  "config": {
    "model": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    "langCode": "z",
    "workers": 1
  }
}
```

### 3. Point OpenClaw TTS to the Local Endpoint

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

### 4. Restart OpenClaw

On startup, the plugin will:
- Create a Python virtual environment at `~/.openclaw/mlx-audio/venv/` and install dependencies
- Start the mlx-audio server on port 19280
- Start a proxy on port 19281

On first launch, the model will be downloaded (Kokoro-82M is ~345 MB, Qwen3-TTS-0.6B-Base is ~2.3 GB). There is currently no download progress UI; status can be checked via OpenClaw logs or `ls -la ~/.cache/huggingface/`. No network connection is needed after the initial download.

## Configuration Reference

All fields are optional:

| Field | Default | Description |
|---|---|---|
| `model` | `mlx-community/Kokoro-82M-bf16` | HuggingFace model ID |
| `port` | `19280` | mlx-audio server port |
| `proxyPort` | `19281` | Proxy port (OpenClaw connects to this) |
| `workers` | `1` | Uvicorn worker count |
| `speed` | `1.0` | Speech speed multiplier |
| `langCode` | `a` | Language code |
| `voice` | model default | Voice name |
| `refAudio` | | Reference audio path (voice cloning, Base models only) |
| `refText` | | Transcript of reference audio |
| `instruct` | | Voice description text (VoiceDesign models only) |
| `temperature` | `0.7` | Generation temperature |
| `autoStart` | `true` | Start with OpenClaw |
| `healthCheckIntervalMs` | `30000` | Health check interval in ms |
| `restartOnCrash` | `true` | Auto-restart on crash |
| `maxRestarts` | `3` | Max consecutive restart attempts |

## Architecture

```
OpenClaw tts() → proxy (:19281) → mlx_audio.server (:19280) → Apple Silicon GPU
                  ↑ injects model,
                    lang_code, speed
```

OpenClaw's TTS client uses the OpenAI `/v1/audio/speech` API. The additional parameters required by mlx-audio (full model ID, language code, etc.) are not part of the OpenAI API specification.

The proxy intercepts requests, injects configured parameters, and forwards them to the mlx-audio server. No changes to OpenClaw are required; the proxy presents itself as a standard OpenAI TTS endpoint.

The plugin also manages the server lifecycle:
- Creates and maintains a Python virtual environment
- Starts the mlx-audio server as a child process
- Auto-restarts on crash (counter resets after 30s of healthy uptime)
- Cleans up stale processes on the target port before starting
- Checks available memory before starting; detects OOM kills

## Troubleshooting

**Server crashes 3 times then stops restarting**

Check OpenClaw logs for `[mlx-audio] Last errors:`. Common causes: missing Python dependency, incorrect model name, port conflict. After fixing, modify any config field to reset the crash counter.

**SIGKILL**

Logs will show `⚠️ Server was killed by SIGKILL (likely out-of-memory)`. The system terminated the process due to insufficient memory. Use a smaller model or set `workers` to 1.

**Port conflict**

The plugin cleans up stale processes on the target port before starting. If the issue persists:

```bash
kill -9 $(lsof -nP -iTCP:19280 -sTCP:LISTEN -t)
```

**Slow first startup**

The model is being downloaded. Kokoro-82M is ~345 MB, Qwen3-TTS-0.6B-Base is ~2.3 GB.

## Acknowledgements

- [mlx-audio](https://github.com/Blaizzy/mlx-audio) by Prince Canuma
- [MLX](https://github.com/ml-explore/mlx) by Apple
- [OpenClaw](https://github.com/openclaw/openclaw)

## License

MIT
