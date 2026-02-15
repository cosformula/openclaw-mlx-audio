# openclaw-mlx-audio 设计文档

> 作者：Formula (contextcross)
> 日期：2026-02-15
> 状态：Active

## 一句话

`@cosformula/openclaw-mlx-audio` 为 OpenClaw 提供 Apple Silicon 本地 TTS：
- TypeScript 插件管理生命周期
- Python `mlx_audio.server` 执行推理
- 本地 proxy 将 OpenAI 风格请求映射为 mlx-audio 参数

## 包名与插件 ID

- npm 包名：`@cosformula/openclaw-mlx-audio`
- 插件 manifest：`openclaw.plugin.json`
- 插件 ID：`openclaw-mlx-audio`
- OpenClaw 配置路径：`plugins.entries.openclaw-mlx-audio.config`

## 架构

```text
OpenClaw (provider: openai)
  -> POST /v1/audio/speech
  -> Plugin Proxy (127.0.0.1:19281)
  -> mlx_audio.server (127.0.0.1:19280)
  -> mp3 stream response
```

Proxy 在请求转发前注入配置参数（如 `model`、`lang_code`、`speed`、`ref_audio`），并在 `/v1/audio/speech` 与 `GET /v1/models` 路径前确保上游服务可用。

## 组件职责

| 组件 | 语言 | 职责 |
|---|---|---|
| `index.ts` | TypeScript | 插件入口，读取配置，注册 service/tool/command |
| `src/venv-manager.ts` | TypeScript | 在 `managed` 模式下自举 `~/.openclaw/mlx-audio/bin/uv`，创建并维护 `~/.openclaw/mlx-audio/venv/` |
| `src/process-manager.ts` | TypeScript | 启停 `mlx_audio.server` 子进程，崩溃重启与日志收集 |
| `src/proxy.ts` | TypeScript | 处理 `/v1/audio/speech` 参数注入、上游就绪检查与转发 |
| `src/health.ts` | TypeScript | 定时健康检查 `/v1/models`，连续失败触发重启 |
| `src/config.ts` | TypeScript | 配置默认值、校验与参数映射 |

## 当前支持的功能面

### 1. Service

- 启动时先启动本地 proxy
- `pythonEnvMode=managed` 时，首次初始化下载 `uv`，必要时通过 `uv python install 3.12` 安装独立 Python，再创建 venv 并安装依赖
- `pythonEnvMode=external` 时，使用 `pythonExecutable` 指向的环境，启动前校验 Python 版本（3.11-3.13）与关键依赖可导入
- `autoStart=true` 时后台预热所选 Python 运行时与 `mlx_audio.server`
- `autoStart=false` 时在首个生成请求或 `GET /v1/models` 请求按需拉起 `mlx_audio.server`
- 启动链路要求上游 `/v1/models` 在约 10 秒内通过健康检查，否则该请求返回不可用并在下次请求重试
- 停止时关闭 proxy 与 `mlx_audio.server`
- 可选健康检查与自动重启

### 2. Tool

`mlx_audio_tts` 支持两个 action：
- `generate`：文本生成音频并返回文件路径（`outputPath` 仅允许 `/tmp` 或 `~/.openclaw/mlx-audio/outputs`，并拒绝符号链接路径段，音频响应流式写盘并限制 64 MB）
- `status`：返回服务状态与关键配置

### 3. Command

`/mlx-tts` 支持：
- `status`
- `test <text>`

## 配置（实际字段）

```json
{
  "plugins": {
    "entries": {
      "openclaw-mlx-audio": {
        "enabled": true,
        "config": {
          "port": 19280,
          "proxyPort": 19281,
          "model": "mlx-community/Kokoro-82M-bf16",
          "pythonEnvMode": "managed",
          "pythonExecutable": "/opt/homebrew/bin/python3.12",
          "langCode": "a",
          "speed": 1.0,
          "refAudio": "/path/to/reference.wav",
          "refText": "Reference transcript",
          "instruct": "A calm female voice with clear articulation",
          "workers": 1,
          "temperature": 0.7,
          "topP": 0.95,
          "topK": 40,
          "repetitionPenalty": 1.0,
          "autoStart": true,
          "healthCheckIntervalMs": 30000,
          "restartOnCrash": true,
          "maxRestarts": 3
        }
      }
    }
  }
}
```

说明：
- `pythonEnvMode` 默认为 `managed`
- `pythonEnvMode=external` 时必须提供 `pythonExecutable`
- `external` 模式只校验环境，不自动安装依赖

## 默认模型选择

默认模型为 `mlx-community/Kokoro-82M-bf16`，默认 `langCode` 为 `a`（美式英语）。
原因：资源占用最小、冷启动更快，在 8 GB 设备上更稳。中文优先场景可切换到 Qwen3 并设置 `langCode: "z"`。

## 不在当前范围

以下内容不属于当前实现，已从设计文档移除：
- `list_models` / `load_model` / `unload_model` 级别的工具能力
- `/mlx-tts models`、`/mlx-tts load`、`/mlx-tts unload` 命令
- 插件自动改写 OpenClaw `messages.tts` 全局配置

## 发布与 CI

- 版本由 `package.json` 与 `openclaw.plugin.json` 管理
- GitHub Actions `publish.yml` 在 `v*` tag push 时执行：
  - `npm ci`
  - `npm run build`
  - `npm publish --access public`
