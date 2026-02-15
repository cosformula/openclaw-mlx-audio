# openclaw-mlx-audio

**OpenClaw 缺失的那块拼图：Apple Silicon 本地语音合成。**

OpenClaw 内置 ElevenLabs、OpenAI、Edge TTS 支持——全是云端方案。现有的自托管替代品（[openedai-speech](https://github.com/matatonic/openedai-speech)、[Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server)）需要 NVIDIA GPU。如果你用 Mac，要么按次付费，要么把语音数据交给别人的服务器。

这个插件在 Apple Silicon 上本地运行 [mlx-audio](https://github.com/Blaizzy/mlx-audio) TTS。Python 虚拟环境、模型下载、服务生命周期、崩溃恢复——全自动管理，不用操心。

- 首次下载模型后**零云端依赖**
- 每次请求**零成本**
- Python 侧**零配置**——插件全包了
- M 系列芯片上**延迟接近云端 TTS**

## 系统要求

- **macOS + Apple Silicon**（M1/M2/M3/M4）
- **Python 3.11+**（插件自动管理独立 venv）
- 本地运行的 **OpenClaw**

### 内存参考

| 模型 | 磁盘 | 内存（1 worker） | 语言 |
|---|---|---|---|
| `Kokoro-82M-bf16` | 345 MB | ~400 MB | 英语、日语 |
| `Qwen3-TTS-0.6B-Base-bf16` | 2.3 GB | ~1.4 GB | 中文、英语、日语 |
| `Qwen3-TTS-1.7B-VoiceDesign-bf16` | 4.2 GB | ~3.8 GB | 中英 + 声音克隆 |

> **8 GB Mac**：用 Kokoro-82M（英语）或 0.6B-Base 配合 `workers: 1`。1.7B 模型大概率会被系统杀掉。

## 快速开始

1. **安装插件**：
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

2. **配置插件**（在 `openclaw.json` 中）：
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

3. **将 OpenClaw 的 TTS 指向本地端点**：
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

4. **重启 OpenClaw**。插件会自动：
   - 在 `~/.openclaw/mlx-audio/venv/` 创建 Python 虚拟环境
   - 安装 `mlx-audio` 及依赖
   - 在 19280 端口启动 TTS 服务
   - 在 19281 端口启动代理，自动注入模型/语言配置

## 配置项

所有字段均可选。在 `plugins.entries.openclaw-mlx-audio.config` 中设置：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `model` | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16` | HuggingFace 模型 ID |
| `port` | `19280` | mlx-audio 服务端口 |
| `proxyPort` | `19281` | 代理端口（OpenClaw 连接这个） |
| `workers` | `1` | Uvicorn worker 数（低内存机器用 1） |
| `speed` | `1.0` | 语速倍率 |
| `langCode` | `z` | 语言代码：`a`（英语）、`z`（中文）、`j`（日语） |
| `voice` | *(模型默认)* | 音色名称（如 Kokoro 的 `af_heart`） |
| `refAudio` | — | 参考音频路径，用于声音克隆（仅 1.7B VoiceDesign） |
| `refText` | — | 参考音频的文字内容 |

## 工作原理

```
OpenClaw tts() → 代理 (:19281) → mlx_audio.server (:19280) → Apple Silicon GPU
                  ↑ 注入 model,
                    lang_code, speed
```

OpenClaw 内置的 TTS 客户端使用 OpenAI `/v1/audio/speech` API。但 mlx-audio 模型需要额外参数（完整的 HuggingFace 模型 ID、`lang_code` 等），这些是 OpenAI API 没有的。

代理在中间拦截请求，注入配置好的参数，再转发给真正的 mlx-audio 服务。这意味着 OpenClaw 不需要任何代码改动——它以为自己在跟一个 OpenAI TTS 端点对话。

插件还管理完整的服务生命周期：
- 创建并维护 Python 虚拟环境（`~/.openclaw/mlx-audio/venv/`）
- 以子进程方式启动 mlx-audio 服务
- 崩溃自动重启（智能退避——健康运行 30 秒后重置计数器）
- 自动清理端口冲突的僵尸进程
- 启动前检测可用内存，识别 OOM kill

## 常见问题

**服务反复崩溃（3 次后停止）**
- 查看 OpenClaw 日志中的 `[mlx-audio] Last errors:` —— 会捕获 Python 进程的 stderr
- 常见原因：缺少 Python 依赖、模型名称错误、端口冲突
- 修复问题后，改动任意配置项即可重置崩溃计数器

**SIGKILL（疑似内存不足）**
- 日志会显示：`⚠️ Server was killed by SIGKILL (likely out-of-memory)`
- 换更小的模型，或把 `workers` 降到 1

**端口被占用**
- 插件启动前会自动杀掉占用配置端口的残留进程
- 如果问题持续：`kill -9 $(lsof -nP -iTCP:19280 -sTCP:LISTEN -t)`

## License

MIT
