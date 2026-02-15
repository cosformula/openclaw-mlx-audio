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

Proxy 在请求转发前注入配置参数（如 `model`、`lang_code`、`speed`、`ref_audio`）。

## 组件职责

| 组件 | 语言 | 职责 |
|---|---|---|
| `index.ts` | TypeScript | 插件入口，读取配置，注册 service/tool/command |
| `src/venv-manager.ts` | TypeScript | 初始化并维护 `~/.openclaw/mlx-audio/venv/` |
| `src/process-manager.ts` | TypeScript | 启停 `mlx_audio.server` 子进程，崩溃重启与日志收集 |
| `src/proxy.ts` | TypeScript | 处理 `/v1/audio/speech` 参数注入并转发 |
| `src/health.ts` | TypeScript | 定时健康检查 `/v1/models`，连续失败触发重启 |
| `src/config.ts` | TypeScript | 配置默认值、校验与参数映射 |

## 当前支持的功能面

### 1. Service

- 启动时自动创建 Python venv（首次）
- 启动/停止 `mlx_audio.server`
- 启动/停止本地 proxy
- 可选健康检查与自动重启

### 2. Tool

`mlx_audio_tts` 支持两个 action：
- `generate`：文本生成音频并返回文件路径
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
          "model": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
          "langCode": "z",
          "speed": 1.0,
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

## 默认模型选择

默认模型为 `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16`，默认 `langCode` 为 `z`（中文）。
原因：该组合在中英日场景更稳定，避免 Kokoro 在中文路径上的已知崩溃问题。

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
