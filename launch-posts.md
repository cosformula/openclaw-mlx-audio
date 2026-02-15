# openclaw-mlx-audio 发布文案

---

## 1. OpenClaw Discord (#plugins / #showcase)

**标题不需要，直接发**

Built a local TTS plugin for OpenClaw using mlx-audio. Runs entirely on Apple Silicon, no API key needed.

What it does:
- Manages mlx-audio server lifecycle as an OpenClaw background service
- Proxy translates OpenClaw's OpenAI TTS calls to mlx-audio parameters
- Auto venv setup, crash recovery, OOM detection
- `openclaw plugin install @cosformula/openclaw-mlx-audio` and point `OPENAI_TTS_BASE_URL` to localhost

Models: Kokoro-82M (~400MB RAM, runs on 8GB Macs), Qwen3-TTS (better Chinese, voice cloning), Chatterbox (16 languages).

GitHub: https://github.com/cosformula/openclaw-mlx-audio
npm: `@cosformula/openclaw-mlx-audio`

---

## 2. mlx-audio GitHub Discussion (New discussion → Show and tell)

**Title:** OpenClaw plugin for mlx-audio — managed local TTS service

I built an OpenClaw plugin that wraps mlx-audio as a managed background TTS service.

OpenClaw is an AI assistant framework. Its TTS uses the OpenAI `/v1/audio/speech` API, but mlx-audio needs extra parameters (full model ID, language code, etc.) that aren't part of the OpenAI spec.

The plugin solves this with a lightweight proxy that injects the configured parameters, plus:
- Automatic Python venv creation and dependency management
- Server lifecycle management (start/stop/health check/crash recovery)
- Pre-start memory check and OOM kill detection
- Stale process cleanup on port conflicts

Tested with Kokoro-82M, Qwen3-TTS-0.6B-Base, and Qwen3-TTS-1.7B-VoiceDesign on M-series Macs.

GitHub: https://github.com/cosformula/openclaw-mlx-audio

Thanks for building mlx-audio — the OpenAI-compatible server API made integration straightforward.

---

## 3. 即刻

给 Mac 上的 AI 助手加了本地语音合成。

之前用云端 TTS，每条语音都要过一次外部 API。换成 mlx-audio 之后完全本地跑，M1 8GB 够用，Kokoro-82M 模型只占 400MB 内存。

做成了 OpenClaw 插件，装完配一下就行，Python 环境、模型下载、进程管理都是自动的。中文用 Qwen3-TTS 效果更好，英文 Kokoro 延迟最低。

https://github.com/cosformula/openclaw-mlx-audio

---

## 4. Reddit r/LocalLLaMA

**Title:** Local TTS on Apple Silicon as an OpenClaw plugin (mlx-audio, no cloud)

**Body:**

Made a plugin that runs mlx-audio as a managed TTS service for OpenClaw (AI assistant framework).

The problem: OpenClaw uses the OpenAI TTS API format. mlx-audio's server is OpenAI-compatible but needs parameters the spec doesn't cover (full HuggingFace model ID, language codes). Also, managing a Python server alongside a Node.js app is annoying.

The plugin handles:
- OpenAI API proxy that injects model/language/voice config
- Python venv creation and mlx-audio installation
- Server process management with crash recovery
- Memory precheck and OOM kill detection (important on 8GB Macs)

Tested models:
- Kokoro-82M: ~400MB RAM, multilingual, runs fine on 8GB M1
- Qwen3-TTS-0.6B-Base: ~1.4GB RAM, better Chinese, voice cloning from 3s reference audio
- Qwen3-TTS-1.7B-VoiceDesign: ~3.8GB RAM, generates voices from text descriptions, needs 16GB+

Install: `openclaw plugin install @cosformula/openclaw-mlx-audio`

Source: https://github.com/cosformula/openclaw-mlx-audio

---

## 5. V2EX (/t/create, node: Apple 或 AI)

**Title:** 给 OpenClaw 写了个本地 TTS 插件，基于 mlx-audio，Apple Silicon 本地跑

**Body:**

之前 AI 助手的语音合成走云端 API，做了个 OpenClaw 插件把 mlx-audio 包成本地服务。

功能：
- 自动管理 Python 虚拟环境和 mlx-audio 安装
- 代理层把 OpenAI TTS API 翻译成 mlx-audio 参数
- 进程管理：健康检查、崩溃重启、OOM 检测
- 启动前清理端口残留进程

模型选择：
- Kokoro-82M：400MB 内存，8GB Mac 可用，支持中英日法西等
- Qwen3-TTS-0.6B-Base：1.4GB 内存，中文质量更好，支持声音克隆
- Qwen3-TTS-1.7B-VoiceDesign：3.8GB 内存，用自然语言描述生成音色，需要 16GB

安装：`openclaw plugin install @cosformula/openclaw-mlx-audio`

GitHub: https://github.com/cosformula/openclaw-mlx-audio

---

## 6. Twitter/X

Local TTS plugin for OpenClaw, powered by mlx-audio.

Runs entirely on Apple Silicon. No API key, no cloud. Kokoro-82M fits in 400MB RAM on 8GB Macs.

Auto manages Python env, server lifecycle, crash recovery, OOM detection.

`openclaw plugin install @cosformula/openclaw-mlx-audio`

github.com/cosformula/openclaw-mlx-audio

(tag: @baborquez @AiOpenClaw)

---

## 7. Hacker News (Show HN)

**Title:** Show HN: Local TTS plugin for OpenClaw on Apple Silicon (mlx-audio)

**Body:**

I built an OpenClaw plugin that runs mlx-audio as a managed local TTS service on Apple Silicon Macs.

OpenClaw is an AI assistant framework that uses the OpenAI TTS API. mlx-audio provides an OpenAI-compatible server, but needs extra parameters and separate process management. The plugin bridges the gap with a proxy layer and handles the full server lifecycle (venv setup, health checks, crash recovery, OOM detection).

Kokoro-82M runs in ~400MB RAM on 8GB Macs. Qwen3-TTS provides higher quality Chinese and voice cloning. All inference stays on-device.

https://github.com/cosformula/openclaw-mlx-audio
