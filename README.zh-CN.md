# openclaw-mlx-audio

OpenClaw 的本地语音合成插件，基于 Apple Silicon 运行，不依赖云服务。

## 关于 MLX

[MLX](https://github.com/ml-explore/mlx) 是 Apple 为自家芯片设计的机器学习框架，针对 M 系列芯片的统一内存架构做了深度优化。[mlx-audio](https://github.com/Blaizzy/mlx-audio) 是基于 MLX 的音频处理库，支持语音合成（TTS）、语音识别（STT）等能力。

因此，本插件**仅支持 Apple Silicon Mac**（M1 及以后）。Intel Mac、Windows、Linux 均不适用。

**非 Mac 用户的替代方案**：
- [openedai-speech](https://github.com/matatonic/openedai-speech)：自托管方案，需要 NVIDIA GPU
- [Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server)：同上
- OpenClaw 内置 Edge TTS：免费云端方案，无需 GPU

## 系统要求

- macOS + Apple Silicon（M1/M2/M3/M4）
- Python 3.11+（插件自动管理独立 venv，不影响系统环境）
- 本地运行的 OpenClaw

## 可用模型

以下是 mlx-audio 支持的 TTS 模型，按内存占用排序：

| 模型 | 磁盘 | 内存（1 worker） | 语言 | 说明 |
|---|---|---|---|---|
| [Kokoro-82M](https://huggingface.co/mlx-community/Kokoro-82M-bf16) | 345 MB | ~400 MB | 英/日/中/法/西/意/葡/印 | 速度快，英语质量好，8GB Mac 首选 |
| [Soprano-80M](https://huggingface.co/mlx-community/Soprano-1.1-80M-bf16) | ~300 MB | ~400 MB | 英语 | 轻量英语 TTS |
| [Spark-TTS-0.5B](https://huggingface.co/mlx-community/Spark-TTS-0.5B-bf16) | ~1 GB | ~1 GB | 中/英 | 中等体积，中英双语 |
| [Qwen3-TTS-0.6B-Base](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16) | 2.3 GB | ~1.4 GB | 中/英/日/韩+ | **默认模型**，中文质量最好 |
| [OuteTTS-0.6B](https://huggingface.co/mlx-community/OuteTTS-1.0-0.6B-fp16) | ~1.2 GB | ~1.4 GB | 英语 | 高效英语 TTS |
| [CSM-1B](https://huggingface.co/mlx-community/csm-1b) | ~2 GB | ~2 GB | 英语 | 对话风格，支持声音克隆 |
| [Dia-1.6B](https://huggingface.co/mlx-community/Dia-1.6B-fp16) | ~3.2 GB | ~3.2 GB | 英语 | 对话场景优化 |
| [Qwen3-TTS-1.7B-VoiceDesign](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16) | 4.2 GB | ~3.8 GB | 中/英/日/韩+ | 支持声音克隆和情感控制，需 16GB+ |
| [Chatterbox](https://huggingface.co/mlx-community/chatterbox-fp16) | ~3 GB | ~3.5 GB | 16 种语言 | 语言覆盖面最广，需 16GB+ |

### 选型建议

- **8 GB Mac**：Kokoro-82M（英语为主）或 Qwen3-TTS-0.6B-Base（中文为主），`workers` 设为 1。1.7B 模型会因内存不足被系统终止。
- **16 GB Mac**：以上模型均可运行，需要声音克隆可选 1.7B-VoiceDesign。
- **中文场景**：Qwen3-TTS 系列质量最好。Kokoro 也支持中文，但效果一般。
- **英语场景**：Kokoro-82M 性价比最高，速度快且质量好。
- **多语言场景**：Chatterbox 支持 16 种语言，但内存需求较高。

### 语言代码

Kokoro 和 Qwen3-TTS 使用以下语言代码：

| 代码 | 语言 |
|---|---|
| `a` | 美式英语 |
| `b` | 英式英语 |
| `z` | 中文 |
| `j` | 日语 |
| `e` | 西班牙语 |
| `f` | 法语 |

### 音色

Kokoro 内置 50+ 预设音色：
- 美式女声：`af_heart`、`af_bella`、`af_nova`、`af_sky`
- 美式男声：`am_adam`、`am_echo`
- 中文女声：`zf_xiaobei`
- 中文男声：`zm_yunxi`
- 日语：`jf_alpha`、`jm_kumo`

Qwen3-TTS 通过名字指定音色（如 `Chelsie`），也支持参考音频进行声音克隆。

不指定时使用模型默认音色。

## 快速开始

1. 安装插件：
   ```bash
   openclaw plugin install @cosformula/openclaw-mlx-audio
   ```
   或在 `openclaw.json` 中从本地路径加载：
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

3. 将 OpenClaw 的 TTS 指向本地端点：
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

4. 重启 OpenClaw。插件会自动创建 Python 环境、安装依赖、启动 TTS 服务。

   首次启动需要下载模型（0.6B-Base 约 2.3 GB），期间无进度提示，可通过 OpenClaw 日志或 `ls -la ~/.cache/huggingface/` 确认进度。下载完成后不再需要网络。

## 配置项

所有字段均为可选，在 `plugins.entries.openclaw-mlx-audio.config` 中设置：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `model` | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16` | HuggingFace 模型 ID |
| `port` | `19280` | mlx-audio 服务端口 |
| `proxyPort` | `19281` | 代理端口（OpenClaw 连接此端口） |
| `workers` | `1` | Uvicorn worker 数（低内存机器建议 1） |
| `speed` | `1.0` | 语速倍率 |
| `langCode` | `z` | 语言代码，见上表 |
| `voice` | 模型默认 | 音色名称，如 Kokoro 的 `af_heart` |
| `refAudio` | | 参考音频路径，用于声音克隆（仅 1.7B VoiceDesign） |
| `refText` | | 参考音频对应文字 |
| `temperature` | `0.7` | 生成温度，越高变化越大 |
| `autoStart` | `true` | OpenClaw 启动时自动启动 TTS 服务 |
| `healthCheckIntervalMs` | `30000` | 健康检查间隔（毫秒） |
| `restartOnCrash` | `true` | 崩溃后自动重启 |
| `maxRestarts` | `3` | 最大连续重启次数 |

## 工作原理

```
OpenClaw tts() → 代理 (:19281) → mlx_audio.server (:19280) → Apple Silicon GPU
                  ↑ 注入 model,
                    lang_code, speed
```

OpenClaw 的 TTS 客户端使用 OpenAI `/v1/audio/speech` API，但 mlx-audio 需要额外参数（完整模型 ID、语言代码等），这些不在 OpenAI API 规范中。

代理在中间拦截请求，注入配置参数后转发给 mlx-audio 服务。OpenClaw 无需任何代码改动，对它来说这就是一个标准的 OpenAI TTS 端点。

插件同时管理完整的服务生命周期：
- 创建和维护 Python 虚拟环境（`~/.openclaw/mlx-audio/venv/`）
- 以子进程方式启动 mlx-audio 服务
- 崩溃自动重启（健康运行 30 秒后重置崩溃计数）
- 启动前自动清理端口上的残留进程
- 启动前检查可用内存，识别 OOM kill

## 常见问题

**服务崩溃 3 次后停止重启**

查看 OpenClaw 日志中的 `[mlx-audio] Last errors:`，其中包含 Python 进程的错误输出。常见原因：缺少 Python 依赖、模型名错误、端口冲突。修复后修改任意配置项即可重置崩溃计数。

**SIGKILL（内存不足）**

日志中会出现 `⚠️ Server was killed by SIGKILL (likely out-of-memory)`。解决方法：换用更小的模型，或将 `workers` 设为 1。

**端口被占用**

插件启动时会自动清理占用端口的进程。如仍存在问题：`kill -9 $(lsof -nP -iTCP:19280 -sTCP:LISTEN -t)`

**首次启动很慢**

正在下载模型。0.6B-Base 约 2.3 GB，1.7B 约 4.2 GB。目前没有下载进度的 UI 提示，可通过日志或 HuggingFace 缓存目录确认。

## License

MIT
