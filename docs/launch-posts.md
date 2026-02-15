# openclaw-mlx-audio 发布文案

---

## 1. OpenClaw Discord (#plugins / #showcase)

You can have OpenClaw reply with voice messages on Telegram, Discord, or iMessage. Set `auto: "always"` and every reply becomes a voice note. Set `auto: "inbound"` and it only replies with voice when you send one first.

The catch is you need a TTS provider. OpenAI and ElevenLabs work but cost money per request and send your text to their servers. Edge TTS is free but still goes through Microsoft.

This plugin runs mlx-audio locally on your Mac. After install, voice replies are generated on-device. No API key, no cost, nothing leaves your machine.

Kokoro-82M works on 8GB Macs (~400MB RAM). Qwen3-TTS sounds more natural in Chinese and supports voice cloning from a 3-second sample.

```
openclaw plugin install @cosformula/openclaw-mlx-audio
```

GitHub: https://github.com/cosformula/openclaw-mlx-audio

---

## 2. mlx-audio GitHub Discussion (New discussion → Show and tell)

**Title:** Using mlx-audio for local voice replies in OpenClaw

I set up OpenClaw to reply with voice messages on Telegram. It sends a round voice-note bubble for every reply, which is great for hands-free use (cooking, walking, etc).

The default TTS providers are cloud-based (OpenAI, ElevenLabs, Edge TTS). I wanted to keep voice generation local, so I built a plugin that runs mlx-audio as a managed background service.

OpenClaw sends standard OpenAI `/v1/audio/speech` requests. The plugin runs a proxy that injects the full model ID and language code before forwarding to mlx-audio, and manages the server lifecycle (venv, health checks, crash recovery, OOM detection).

With Kokoro-82M on an M1 8GB Mac, voice replies take about 1 second. Qwen3-TTS-0.6B-Base sounds better in Chinese and supports voice cloning from 3-second audio samples.

GitHub: https://github.com/cosformula/openclaw-mlx-audio

Thanks for building mlx-audio. The OpenAI-compatible API made this integration straightforward.

---

## 3. 即刻

OpenClaw 可以把每条回复都变成语音消息发到 Telegram 里。做饭的时候、走路的时候，不用看屏幕，听就行了。你发语音问它，它也用语音回你。

默认的语音合成走云端（OpenAI、ElevenLabs），每条消息都要调一次 API，花钱，而且对话内容发到了别人服务器上。

做了个插件，让语音在 Mac 本地生成。8GB M1 就能跑，Kokoro-82M 模型只占 400MB 内存，延迟大概 1 秒。中文用 Qwen3-TTS 更自然，还能用 3 秒录音克隆声音。

https://github.com/cosformula/openclaw-mlx-audio

---

## 4. Reddit r/LocalLLaMA

**Title:** OpenClaw voice replies running fully local with mlx-audio on Apple Silicon

OpenClaw has a TTS mode where every reply gets sent as a voice note on Telegram/Discord. You can also set it to only reply with voice when you send a voice message first. Pretty useful hands-free.

The built-in providers are all cloud-based (OpenAI, ElevenLabs, Edge TTS). I wanted voice generation to stay on my Mac, so I built a plugin that wraps mlx-audio as a managed service.

Kokoro-82M on an 8GB M1 takes ~400MB RAM and generates voice in about 1 second. Qwen3-TTS-0.6B-Base (~1.4GB) sounds better in Chinese and supports voice cloning from a 3-second audio sample. There's also a 1.7B VoiceDesign variant that creates voices from text descriptions, but that needs 16GB+.

The plugin handles the Python server lifecycle (venv, startup, crash recovery, OOM detection) and runs a proxy to bridge the OpenAI TTS API format with mlx-audio's parameters.

Source: https://github.com/cosformula/openclaw-mlx-audio

---

## 5. V2EX (分享创造)

**Title:** OpenClaw 语音回复本地化，不再走云端 TTS

OpenClaw 有个 TTS 模式，开了之后每条回复都会变成 Telegram 语音消息发出来。也可以设成"你发语音它才回语音"。做饭、通勤的时候不看屏幕，听就行。

默认走 OpenAI 或 ElevenLabs 的云端 API，每条都要钱，对话内容也发到了外面。做了个插件把语音合成换成 mlx-audio 本地跑。

8GB Mac 用 Kokoro-82M，占 400MB 内存，延迟 1 秒左右。中文场景用 Qwen3-TTS 更自然，支持 3 秒录音克隆声音。插件自动管理 Python 环境和进程，装完配一下就不用管了。

GitHub: https://github.com/cosformula/openclaw-mlx-audio

---

## 6. Twitter/X

OpenClaw can reply with voice notes on Telegram. Every reply, or only when you send one first.

Built a plugin to run this locally with mlx-audio. No cloud API, no cost. Kokoro-82M takes ~400MB on 8GB Macs, about 1s per reply.

github.com/cosformula/openclaw-mlx-audio

(tag: @paborquez @AiOpenClaw)

---

## 7. Hacker News (Show HN)

**Title:** Show HN: Local voice replies for OpenClaw on Apple Silicon

OpenClaw can send every reply as a voice note on Telegram, Discord, or iMessage. Useful for hands-free interaction. The built-in TTS providers are cloud-based (OpenAI, ElevenLabs). This plugin replaces them with mlx-audio running locally on Apple Silicon.

It manages the mlx-audio Python server as a background service and runs a proxy to bridge the OpenAI TTS API format. Kokoro-82M takes ~400MB RAM on 8GB Macs with ~1s latency per reply.

https://github.com/cosformula/openclaw-mlx-audio
