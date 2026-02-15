# openclaw-mlx-audio

[English](./README.md)

OpenClaw 本地语音合成插件，基于 [mlx-audio](https://github.com/Blaizzy/mlx-audio) 在 Apple Silicon 上运行。

## MLX 与平台兼容性

[MLX](https://github.com/ml-explore/mlx) 是 Apple 为 M 系列芯片设计的机器学习框架，针对其统一内存架构优化。本插件依赖 MLX，因此**仅支持 Apple Silicon Mac**（M1 及以后）。

不适用于 Intel Mac、Windows 或 Linux。这些平台可考虑：
- [openedai-speech](https://github.com/matatonic/openedai-speech)（自托管，需 NVIDIA GPU）
- [Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server)（同上）
- OpenClaw 内置 Edge TTS（云端，无需 GPU）

## 系统要求

- macOS，Apple Silicon（M1 及以后）
- 默认 `pythonEnvMode: managed` 无需预装 Python 或 Homebrew，插件会自举 `uv` 与本地 Python 运行时
- 可选 `pythonEnvMode: external`，通过 `pythonExecutable` 复用已有 Python 环境
- OpenClaw

## 安装与配置

### 1. 安装插件

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

### 2. 配置插件

在 `openclaw.json` 的 `plugins.entries.openclaw-mlx-audio.config` 中设置：

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

默认配置使用 Kokoro-82M，美式英语。如需中文，设置 `model` 和 `langCode`：

```json
{
  "config": {
    "model": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
    "langCode": "z",
    "workers": 1
  }
}
```

### 3. 将 OpenClaw TTS 指向本地端点

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

### 4. 重启 OpenClaw

插件启动时会自动完成以下步骤：
- 在端口 19281 启动代理服务
- 若 `autoStart: true`，后台预热 mlx-audio 服务
- 若 `autoStart: false`，在首次 `/v1/audio/speech`、`GET /v1/models`、tool `generate` 或 `/mlx-tts test` 时拉起服务
- 启动链路要求上游 `/v1/models` 在约 10 秒内通过健康检查，否则该请求返回不可用，下次请求再重试启动
- 若 `pythonEnvMode: managed`，首次运行时将 `uv` 安装到 `~/.openclaw/mlx-audio/bin/uv`，随后创建 `~/.openclaw/mlx-audio/venv/` 并安装 Python 依赖
- 若 `pythonEnvMode: external`，启动前校验 `pythonExecutable`（Python 3.11-3.13 且可导入关键依赖）并直接使用该环境

首次启动需下载模型（Kokoro-82M 约 345 MB，Qwen3-TTS-0.6B-Base 约 2.3 GB）。启动阶段可通过 `/mlx-tts status` 与 tool `status` 查看启动阶段和模型缓存近似下载进度（文本进度条 + 百分比）。若启动超时，返回给 OpenClaw 的 503 `detail` 也会包含相同状态信息。模型下载完成后不再需要网络连接。

## 模型

默认模型为 Kokoro-82M。以下是按使用场景筛选的模型：

| 模型 | 说明 | 语言 | 链接 |
|---|---|---|---|
| **Kokoro** | 轻量多语言 TTS，54 种预设音色 | EN, JA, ZH, FR, ES, IT, PT, HI | [Kokoro-82M-bf16](https://huggingface.co/mlx-community/Kokoro-82M-bf16) |
| **Qwen3-TTS Base** | 阿里巴巴多语言 TTS，支持 3 秒参考音频声音克隆 | ZH, EN, JA, KO 等 | [0.6B-Base-bf16](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16) |
| **Qwen3-TTS VoiceDesign** | 通过自然语言描述生成音色 | ZH, EN, JA, KO 等 | [1.7B-VoiceDesign-bf16](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16) |
| **Chatterbox** | 表现力丰富的多语言 TTS | EN, ES, FR, DE, IT, PT 等 16 种语言 | [chatterbox-fp16](https://huggingface.co/mlx-community/chatterbox-fp16) |

mlx-audio 还支持 Soprano、Spark-TTS、OuteTTS、CSM、Dia 等模型，完整列表见 [mlx-audio README](https://github.com/Blaizzy/mlx-audio#supported-models)。

### Qwen3-TTS 模型变体

| 变体 | 说明 |
|---|---|
| **Base** | 基础模型，支持通过 3 秒参考音频进行声音克隆，可用于微调 |
| **VoiceDesign** | 根据自然语言描述生成音色（如"低沉的男声，带英式口音"），不接受参考音频 |
| **CustomVoice** | 提供 9 种预设音色，支持通过指令控制语气和风格 |

目前 mlx-community 提供了 0.6B-Base 和 1.7B-VoiceDesign 的 MLX 转换版本。

### 选型参考

内存占用参考：

| 模型 | 磁盘 | 内存（1 worker） |
|---|---|---|
| Kokoro-82M | 345 MB | ~400 MB |
| Qwen3-TTS-0.6B-Base | 2.3 GB | ~1.4 GB |
| Qwen3-TTS-1.7B-VoiceDesign | 4.2 GB | ~3.8 GB |
| Chatterbox | ~3 GB | ~3.5 GB |

- **8 GB Mac**：Kokoro-82M 或 Qwen3-TTS-0.6B-Base，`workers` 设为 1。1.7B 及以上的模型会因内存不足被系统终止。
- **16 GB 及以上**：所有模型均可运行。
- **中文**：Qwen3-TTS 系列。Kokoro 支持中文但合成质量不如 Qwen3-TTS。
- **英语**：Kokoro-82M 体积最小，延迟最低。
- **多语言**：Chatterbox 覆盖 16 种语言。

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

| 类别 | 示例 |
|---|---|
| 美式女声 | `af_heart`, `af_bella`, `af_nova`, `af_sky` |
| 美式男声 | `am_adam`, `am_echo` |
| 中文女声 | `zf_xiaobei` |
| 中文男声 | `zm_yunxi` |
| 日语 | `jf_alpha`, `jm_kumo` |

Qwen3-TTS Base 通过参考音频（`refAudio`）克隆音色。VoiceDesign 通过自然语言描述（`instruct`）生成音色。

未指定时使用模型默认音色。

## 配置项参考

所有字段均为可选：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `model` | `mlx-community/Kokoro-82M-bf16` | HuggingFace 模型 ID |
| `port` | `19280` | mlx-audio 服务端口 |
| `proxyPort` | `19281` | 代理端口（OpenClaw 连接此端口） |
| `workers` | `1` | Uvicorn worker 数 |
| `speed` | `1.0` | 语速倍率 |
| `langCode` | `a` | 语言代码 |
| `refAudio` | | 参考音频路径（声音克隆，仅 Base 模型） |
| `refText` | | 参考音频对应文字 |
| `instruct` | | 音色描述文本（仅 VoiceDesign 模型） |
| `temperature` | `0.7` | 生成温度 |
| `autoStart` | `true` | 随 OpenClaw 自动启动 |
| `healthCheckIntervalMs` | `30000` | 健康检查间隔（毫秒） |
| `restartOnCrash` | `true` | 崩溃后自动重启 |
| `maxRestarts` | `3` | 最大连续重启次数 |

## 架构

```
OpenClaw tts() → 代理 (:19281) → mlx_audio.server (:19280) → Apple Silicon GPU
                  ↑ 注入 model,
                    lang_code, speed
```

OpenClaw 的 TTS 客户端使用 OpenAI `/v1/audio/speech` API。mlx-audio 需要的额外参数（完整模型 ID、语言代码等）不在 OpenAI API 规范中。

代理拦截请求，注入配置参数后转发至 mlx-audio 服务。OpenClaw 侧无需改动，代理对其表现为标准 OpenAI TTS 端点。
如果下游客户端在响应完成前断开，代理会立即取消上游请求。

插件同时管理服务生命周期：
- `managed` 模式下，自举本地 `uv` 工具链，并维护 `~/.openclaw/mlx-audio/` 下的 Python 虚拟环境
- `external` 模式下，仅校验并使用 `pythonExecutable` 指向的环境，不修改用户环境
- 以子进程方式启动 mlx-audio 服务
- 崩溃自动重启（健康运行 30 秒后重置计数）
- 启动前清理端口上的残留进程
- 启动前检查可用内存，识别 OOM kill
- 跟踪启动阶段和模型缓存近似下载进度，并在 `/mlx-tts status`、tool `status` 和启动超时错误中暴露
- 限制 tool 输出路径仅允许 `/tmp` 或 `~/.openclaw/mlx-audio/outputs`，使用异步文件系统检查校验 realpath，并拒绝符号链接路径段
- 生成音频采用流式写盘，并拒绝超过 64 MB 的响应，避免内存峰值增长

## 故障排查

**服务连续崩溃 3 次后停止重启**

查看 OpenClaw 日志中的 `[mlx-audio] Last errors:`。常见原因：Python 依赖缺失、模型名称错误、端口冲突。修复后修改任意配置项可重置崩溃计数。

**SIGKILL**

日志中出现 `⚠️ Server was killed by SIGKILL (likely out-of-memory)`，表明系统因内存不足终止了进程。应更换为更小的模型或将 `workers` 设为 1。

**端口占用**

插件启动时只会清理残留的 `mlx_audio.server` 进程。如果目标端口被其他程序占用，请手动停止该程序，或修改 `port`/`proxyPort`：

```bash
# 1) 先确认端口被谁占用
/usr/sbin/lsof -nP -iTCP:19280 -sTCP:LISTEN

# 2) 仅在确认是 mlx_audio.server 后，优先优雅终止
kill -TERM <mlx_audio_server_pid>
```

**启动健康检查超时**

若日志出现 `Server did not pass health check within 10000ms`，表示启动阶段未在预期时间内通过健康检查。错误详情会附带启动阶段和模型缓存近似进度。常见原因包括首次依赖/模型预热较慢、模型名错误、或 external 模式依赖不完整。修复后再次触发请求即可重试启动。

**首次启动耗时较长**

模型正在下载。Kokoro-82M 约 345 MB，Qwen3-TTS-0.6B-Base 约 2.3 GB。

## 致谢

- [mlx-audio](https://github.com/Blaizzy/mlx-audio) by Prince Canuma
- [MLX](https://github.com/ml-explore/mlx) by Apple
- [OpenClaw](https://github.com/openclaw/openclaw)

## License

MIT
