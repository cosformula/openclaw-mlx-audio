# openclaw-mlx-audio

OpenClaw 的本地语音合成插件。在 Apple Silicon Mac 上跑，不依赖任何云服务。

## 为什么是 MLX

[MLX](https://github.com/ml-explore/mlx) 是 Apple 专门为自家芯片做的机器学习框架，类似 PyTorch 但针对 M 系列芯片的统一内存架构做了深度优化。[mlx-audio](https://github.com/Blaizzy/mlx-audio) 是基于 MLX 的音频处理库，支持语音合成（TTS）、语音识别（STT）等。

这意味着两件事：
- 只能跑在 Apple Silicon 上（M1 及以后），Intel Mac 和 Windows/Linux 都不行
- 但在 M 系列芯片上效率很高，小模型延迟接近云端 TTS

**Windows / Linux 用户**：这个插件帮不了你。可以看看 [openedai-speech](https://github.com/matatonic/openedai-speech)（需要 NVIDIA GPU）或者直接用 OpenClaw 内置的 Edge TTS（免费云端方案）。

## 系统要求

- macOS + Apple Silicon（M1/M2/M3/M4）
- Python 3.11+（插件自己管 venv，不影响系统 Python）
- 本地跑着的 OpenClaw

## 可用模型

mlx-audio 支持不少模型，但不是每个都适合本地跑。这是按内存需求排序的推荐列表：

| 模型 | 大小 | 内存占用 | 语言 | 适合场景 |
|---|---|---|---|---|
| [Kokoro-82M](https://huggingface.co/mlx-community/Kokoro-82M-bf16) | 345 MB | ~400 MB | 英/日/中/法/西/意/葡/印 | 8GB Mac 首选，速度快，英语质量好 |
| [Soprano-80M](https://huggingface.co/mlx-community/Soprano-1.1-80M-bf16) | ~300 MB | ~400 MB | 英语 | 轻量英语 TTS |
| [Spark-TTS-0.5B](https://huggingface.co/mlx-community/Spark-TTS-0.5B-bf16) | ~1 GB | ~1 GB | 中/英 | 中等大小，中英双语 |
| [Qwen3-TTS-0.6B-Base](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16) | 2.3 GB | ~1.4 GB | 中/英/日/韩+ | **默认推荐**，中文质量最好 |
| [OuteTTS-0.6B](https://huggingface.co/mlx-community/OuteTTS-1.0-0.6B-fp16) | ~1.2 GB | ~1.4 GB | 英语 | 高效英语 TTS |
| [CSM-1B](https://huggingface.co/mlx-community/csm-1b) | ~2 GB | ~2 GB | 英语 | 对话风格，支持声音克隆 |
| [Dia-1.6B](https://huggingface.co/mlx-community/Dia-1.6B-fp16) | ~3.2 GB | ~3.2 GB | 英语 | 对话场景 |
| [Qwen3-TTS-1.7B-VoiceDesign](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16) | 4.2 GB | ~3.8 GB | 中/英/日/韩+ | 声音克隆、情感控制，16GB+ Mac |
| [Chatterbox](https://huggingface.co/mlx-community/chatterbox-fp16) | ~3 GB | ~3.5 GB | 16种语言 | 多语言最全，16GB+ Mac |

### 怎么选

- **8 GB Mac**：Kokoro-82M（英语为主）或 Qwen3-TTS-0.6B-Base（中文为主），`workers` 设 1
- **16 GB Mac**：以上都能跑，想要声音克隆用 1.7B-VoiceDesign
- **中文场景**：Qwen3-TTS 系列质量最好。Kokoro 也支持中文但效果一般
- **英语场景**：Kokoro-82M 性价比最高，速度快质量好
- **多语言**：Chatterbox 支持 16 种语言，但比较吃内存

1.7B 的模型在 8GB Mac 上大概率会被系统 OOM kill。别试。

### 语言代码

不同模型的语言代码不一样。对于 Kokoro 和 Qwen3-TTS：

| 代码 | 语言 |
|---|---|
| `a` | 美式英语 |
| `b` | 英式英语 |
| `z` | 中文 |
| `j` | 日语 |
| `e` | 西班牙语 |
| `f` | 法语 |

### 音色

Kokoro 自带 50+ 预设音色，比如：
- 美式女声：`af_heart`、`af_bella`、`af_nova`、`af_sky`
- 美式男声：`am_adam`、`am_echo`
- 中文女声：`zf_xiaobei`
- 中文男声：`zm_yunxi`
- 日语：`jf_alpha`、`jm_kumo`

Qwen3-TTS 用名字指定音色（如 `Chelsie`），也可以用参考音频做声音克隆。

如果不指定音色，模型会用自己的默认值。

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

4. 重启 OpenClaw。插件会自动建 Python 环境、装依赖、启动 TTS 服务。

   首次启动会下载模型，0.6B-Base 大约 2.3 GB，需要等一会儿。下载完之后就不需要网络了。

## 配置项

都是可选的，写在 `plugins.entries.openclaw-mlx-audio.config` 里：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `model` | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16` | HuggingFace 模型 ID |
| `port` | `19280` | mlx-audio 服务端口 |
| `proxyPort` | `19281` | 代理端口，OpenClaw 连这个 |
| `workers` | `1` | Uvicorn worker 数，内存小就用 1 |
| `speed` | `1.0` | 语速倍率 |
| `langCode` | `z` | 语言代码，见上表 |
| `voice` | 模型默认 | 音色名，比如 Kokoro 的 `af_heart` |
| `refAudio` | | 参考音频路径，声音克隆用（仅 1.7B VoiceDesign） |
| `refText` | | 参考音频对应的文字 |
| `temperature` | `0.7` | 生成温度，越高越有变化 |
| `autoStart` | `true` | OpenClaw 启动时自动起 TTS 服务 |
| `healthCheckIntervalMs` | `30000` | 健康检查间隔（毫秒） |
| `restartOnCrash` | `true` | 崩溃后自动重启 |
| `maxRestarts` | `3` | 最大连续重启次数 |

## 原理

```
OpenClaw tts() → 代理 (:19281) → mlx_audio.server (:19280) → Apple Silicon GPU
                  ↑ 注入 model,
                    lang_code, speed
```

OpenClaw 的 TTS 客户端走 OpenAI `/v1/audio/speech` API，但 mlx-audio 需要额外参数（完整模型 ID、语言代码之类的），OpenAI API 里没有这些字段。

代理在中间拦截请求，把配置好的参数塞进去再转发。OpenClaw 不需要改任何代码，它以为自己在跟 OpenAI 对话。

插件还负责：
- 建 Python venv，装依赖
- 子进程方式起 mlx-audio 服务
- 崩溃自动重启，健康运行 30 秒后重置计数
- 启动前清理端口上的残留进程
- 启动前检查内存，识别 OOM kill

## 常见问题

**服务崩溃 3 次后不再重启**

看 OpenClaw 日志里的 `[mlx-audio] Last errors:`，会有 Python 进程的报错。常见原因是缺依赖、模型名写错、端口冲突。修完之后改一下任意配置项，崩溃计数就重置了。

**日志里出现 SIGKILL**

内存不够，系统把进程杀了。换小一号的模型，或者 `workers` 设成 1。

**端口被占用**

插件启动时会自动杀占端口的进程。如果还不行：`kill -9 $(lsof -nP -iTCP:19280 -sTCP:LISTEN -t)`

**首次启动很慢**

正在下载模型。0.6B-Base 约 2.3 GB，1.7B 约 4.2 GB。下载进度暂时没有 UI 提示，可以看 OpenClaw 日志或者 `ls -la ~/.cache/huggingface/` 确认。

**我用的是 Windows / Linux**

这个插件只能跑在 Apple Silicon Mac 上。替代方案：
- [openedai-speech](https://github.com/matatonic/openedai-speech)：自托管，需要 NVIDIA GPU
- [Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server)：同上
- OpenClaw 内置 Edge TTS：免费云端方案，不需要 GPU

## License

MIT
