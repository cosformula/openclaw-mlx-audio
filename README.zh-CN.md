# openclaw-mlx-audio

OpenClaw 的本地 TTS 插件，跑在 Apple Silicon 上。

OpenClaw 自带的 TTS 都是云端的（ElevenLabs、OpenAI、Edge TTS）。自托管方案像 [openedai-speech](https://github.com/matatonic/openedai-speech) 和 [Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server) 又要 NVIDIA GPU。Mac 用户没得选。

这个插件用 [mlx-audio](https://github.com/Blaizzy/mlx-audio) 在本地跑 TTS。Python 环境、模型下载、进程管理、崩溃恢复都不用管，插件全包了。

- 模型下完之后不依赖网络
- 不按次收费
- Python 那边不需要手动配置
- M 系列芯片上延迟跟云端差不多

## 系统要求

- macOS + Apple Silicon（M1/M2/M3/M4）
- Python 3.11+（插件自己管 venv）
- 本地跑着的 OpenClaw

### 内存占用

| 模型 | 磁盘 | 内存（1 worker） | 语言 |
|---|---|---|---|
| `Kokoro-82M-bf16` | 345 MB | ~400 MB | 英语、日语 |
| `Qwen3-TTS-0.6B-Base-bf16` | 2.3 GB | ~1.4 GB | 中文、英语、日语 |
| `Qwen3-TTS-1.7B-VoiceDesign-bf16` | 4.2 GB | ~3.8 GB | 中英 + 声音克隆 |

8 GB 的 Mac 用 Kokoro-82M（英语）或 0.6B-Base 配 `workers: 1`。1.7B 大概率会被系统杀掉。

## 快速开始

1. 装插件：
   ```bash
   openclaw plugin install @cosformula/openclaw-mlx-audio
   ```
   也可以在 `openclaw.json` 里从本地路径加载：
   ```json
   {
     "plugins": {
       "load": { "paths": ["/path/to/openclaw-mlx-audio"] }
     }
   }
   ```

2. 配置插件（`openclaw.json`）：
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

3. 把 OpenClaw 的 TTS 指向本地：
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

4. 重启 OpenClaw。插件会自动在 `~/.openclaw/mlx-audio/venv/` 建 Python 环境，装好依赖，起 TTS 服务（19280）和代理（19281）。

## 配置项

都是可选的，写在 `plugins.entries.openclaw-mlx-audio.config` 里：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `model` | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16` | HuggingFace 模型 ID |
| `port` | `19280` | mlx-audio 服务端口 |
| `proxyPort` | `19281` | 代理端口，OpenClaw 连这个 |
| `workers` | `1` | Uvicorn worker 数，内存小就用 1 |
| `speed` | `1.0` | 语速倍率 |
| `langCode` | `z` | `a` 英语、`z` 中文、`j` 日语 |
| `voice` | 模型默认 | 音色名，比如 Kokoro 的 `af_heart` |
| `refAudio` | | 参考音频路径，声音克隆用（仅 1.7B） |
| `refText` | | 参考音频对应的文字 |

## 原理

```
OpenClaw tts() → 代理 (:19281) → mlx_audio.server (:19280) → Apple Silicon GPU
                  ↑ 注入 model,
                    lang_code, speed
```

OpenClaw 的 TTS 客户端走 OpenAI `/v1/audio/speech` API，但 mlx-audio 需要额外参数（完整模型 ID、`lang_code` 之类的），OpenAI API 里没有这些字段。

代理在中间拦截请求，把配置好的参数塞进去再转发。OpenClaw 那边不用改任何代码，它以为自己在跟 OpenAI 对话。

插件还管这些事：
- 建 Python venv，装依赖
- 子进程方式起 mlx-audio 服务
- 崩溃自动重启，健康运行 30 秒后重置计数
- 启动前清理端口上的残留进程
- 启动前检查内存，识别 OOM kill

## 常见问题

**服务崩溃 3 次后不再重启**

看 OpenClaw 日志里的 `[mlx-audio] Last errors:`，会有 Python 进程的报错。常见原因是缺依赖、模型名写错、端口冲突。修完之后改一下任意配置项，崩溃计数就重置了。

**日志里出现 SIGKILL**

说明内存不够，系统把进程杀了。换小一号的模型，或者 `workers` 设成 1。

**端口被占用**

插件启动时会自动杀占端口的进程。如果还不行：`kill -9 $(lsof -nP -iTCP:19280 -sTCP:LISTEN -t)`

## License

MIT
