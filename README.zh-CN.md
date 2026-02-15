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

- macOS，Apple Silicon（M1/M2/M3/M4）
- Python 3.11+（插件管理独立 venv，不影响系统环境）
- OpenClaw

## 模型

mlx-audio 支持以下 TTS 模型，按内存占用升序排列：

| 模型 | 磁盘 | 内存（1 worker） | 语言 |
|---|---|---|---|
| [Kokoro-82M](https://huggingface.co/mlx-community/Kokoro-82M-bf16) | 345 MB | ~400 MB | EN, JA, ZH, FR, ES, IT, PT, HI |
| [Soprano-80M](https://huggingface.co/mlx-community/Soprano-1.1-80M-bf16) | ~300 MB | ~400 MB | EN |
| [Spark-TTS-0.5B](https://huggingface.co/mlx-community/Spark-TTS-0.5B-bf16) | ~1 GB | ~1 GB | ZH, EN |
| [Qwen3-TTS-0.6B-Base](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16) | 2.3 GB | ~1.4 GB | ZH, EN, JA, KO 等 |
| [OuteTTS-0.6B](https://huggingface.co/mlx-community/OuteTTS-1.0-0.6B-fp16) | ~1.2 GB | ~1.4 GB | EN |
| [CSM-1B](https://huggingface.co/mlx-community/csm-1b) | ~2 GB | ~2 GB | EN |
| [Dia-1.6B](https://huggingface.co/mlx-community/Dia-1.6B-fp16) | ~3.2 GB | ~3.2 GB | EN |
| [Qwen3-TTS-1.7B-VoiceDesign](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16) | 4.2 GB | ~3.8 GB | ZH, EN, JA, KO 等 |
| [Chatterbox](https://huggingface.co/mlx-community/chatterbox-fp16) | ~3 GB | ~3.5 GB | 16 种语言 |

本插件默认使用 Qwen3-TTS-0.6B-Base，默认语言为中文。

### 选型参考

根据可用内存选择模型：

- **8 GB**：Kokoro-82M 或 Qwen3-TTS-0.6B-Base，`workers` 设为 1。1.7B 及以上的模型会因内存不足被系统终止（SIGKILL）。
- **16 GB 及以上**：所有模型均可运行。需要声音克隆功能可选 1.7B-VoiceDesign。

根据语言选择模型：

- **中文**：Qwen3-TTS 系列（0.6B-Base 或 1.7B-VoiceDesign）。Kokoro 支持中文但合成效果不如 Qwen3-TTS。
- **英语**：Kokoro-82M 体积最小，延迟最低。
- **多语言**：Chatterbox 覆盖 16 种语言，内存占用约 3.5 GB。

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

Qwen3-TTS 通过名称指定音色（如 `Chelsie`），也支持通过参考音频进行声音克隆。

未指定时使用模型默认音色。

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
- 在 `~/.openclaw/mlx-audio/venv/` 创建 Python 虚拟环境并安装依赖
- 在端口 19280 启动 mlx-audio 服务
- 在端口 19281 启动代理服务

首次启动需下载模型（0.6B-Base 约 2.3 GB）。当前无下载进度提示，可通过 OpenClaw 日志或 `ls -la ~/.cache/huggingface/` 确认状态。模型下载完成后不再需要网络连接。

## 配置项参考

所有字段均为可选：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `model` | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16` | HuggingFace 模型 ID |
| `port` | `19280` | mlx-audio 服务端口 |
| `proxyPort` | `19281` | 代理端口（OpenClaw 连接此端口） |
| `workers` | `1` | Uvicorn worker 数 |
| `speed` | `1.0` | 语速倍率 |
| `langCode` | `z` | 语言代码 |
| `voice` | 模型默认值 | 音色名称 |
| `refAudio` | | 参考音频路径（声音克隆，仅 1.7B VoiceDesign） |
| `refText` | | 参考音频对应文字 |
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

插件同时管理服务生命周期：
- 创建和维护 Python 虚拟环境
- 以子进程方式启动 mlx-audio 服务
- 崩溃自动重启（健康运行 30 秒后重置计数）
- 启动前清理端口上的残留进程
- 启动前检查可用内存，识别 OOM kill

## 故障排查

**服务连续崩溃 3 次后停止重启**

查看 OpenClaw 日志中的 `[mlx-audio] Last errors:`。常见原因：Python 依赖缺失、模型名称错误、端口冲突。修复后修改任意配置项可重置崩溃计数。

**SIGKILL**

日志中出现 `⚠️ Server was killed by SIGKILL (likely out-of-memory)`，表明系统因内存不足终止了进程。应更换为更小的模型或将 `workers` 设为 1。

**端口占用**

插件启动时自动清理目标端口上的残留进程。若仍存在冲突：

```bash
kill -9 $(lsof -nP -iTCP:19280 -sTCP:LISTEN -t)
```

**首次启动耗时较长**

模型正在下载。0.6B-Base 约 2.3 GB，1.7B 约 4.2 GB。

## License

MIT
