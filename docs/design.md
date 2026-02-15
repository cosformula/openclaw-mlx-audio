# mlx-audio-tts — OpenClaw 本地 TTS 插件设计文档

> 作者：Formula (contextcross)
> 日期：2026-02-14
> 状态：Draft

## 一句话

让所有 Apple Silicon Mac 上的 OpenClaw 用户用上**完全本地**的高质量 TTS，零 API key，零云端依赖。

## 动机

OpenClaw 现有 TTS 全部依赖云端（OpenAI / ElevenLabs / Edge TTS）。mlx-audio 已经在 Apple Silicon 上提供了高质量本地推理 + OpenAI 兼容 API，但没有人把两者打通。这个插件填补这个空白。

**目标用户**：
- 不想为 TTS 付费的 OpenClaw 用户
- 在意隐私、不希望语音数据上云的用户
- 想用 voice clone / voice design 做个性化声音的用户

## 架构

```
┌─────────────────────────────────────────────────┐
│                   OpenClaw                       │
│                                                  │
│   messages.tts (provider: "openai")              │
│              │                                   │
│              │                                   │
│   POST /v1/audio/speech                          │
│              ▼                                   │
│   ┌──────────────┐    ┌────────────────────────┐ │
│   │ Plugin Proxy │───▶│   mlx_audio.server     │ │
│   │ (TS, in-proc)│    │ (Python, subprocess)   │ │
│   │              │    │                        │ │
│   │ - 注入预设参数│    │ - 模型常驻内存         │ │
│   │ - 健康检查   │    │ - OpenAI 兼容 API      │ │
│   │ - 自动重启   │    │ - TTS + STT            │ │
│   └──────────────┘    └────────────────────────┘ │
│      :19281                :19280                │
└─────────────────────────────────────────────────┘
```

### 为什么需要 Proxy 层

OpenClaw 的 `messages.tts.openai` 只传 `model`、`voice`、`input` 三个字段。但 mlx-audio 的 `/v1/audio/speech` 支持 `ref_audio`、`ref_text`、`lang_code`、`speed`、`pitch` 等参数。Proxy 在请求转发时注入这些预设值。

如果上游 OpenClaw 未来扩展了 openai TTS 的透传字段，Proxy 层可以直接退化为纯转发。

### 组件职责

| 组件 | 语言 | 职责 |
|------|------|------|
| index.ts | TypeScript | OpenClaw 插件入口，注册 service / tool / command |
| Proxy | TypeScript | 轻量 HTTP proxy，注入 TTS 预设参数 |
| mlx_audio.server | Python | 模型推理，OpenAI 兼容 API（mlx-audio 自带） |

## 功能范围

直接以 npm plugin 形态发布（`@cosformula/openclaw-mlx-audio`），完整自动化：

- 自动启动/停止 mlx_audio.server 子进程
- Proxy 层注入预设参数（ref_audio、lang_code 等）
- `registerTool`：agent 可按需生成音频
- `registerCommand`：`/mlx-tts status|voice|model`
- 健康检查 + 自动重启
- 附带 Skill（教 agent 怎么用 tool）
- 支持模型：Kokoro、Qwen3-TTS（Base + VoiceDesign）、CSM、Dia

## 配置设计

### Plugin 配置

```jsonc
// openclaw.json
{
  "plugins": {
    "entries": {
      "mlx-audio": {
        "enabled": true,
        "config": {
          // 服务端口
          "port": 19280,
          "proxyPort": 19281,

          // 模型
          "model": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",

          // 通用参数
          "speed": 1.0,
          "langCode": "a",  // a=英语, z=中文, j=日语 ...

          // Voice Clone 模式
          "refAudio": "~/.openclaw/voices/my-voice.wav",
          "refText": "参考音频对应的文本",

          // Voice Design 模式（Qwen3 VoiceDesign 专用）
          "instruct": null,  // 设了就启用 design 模式
          "ddpmSteps": 70,
          "cfgScale": 1.1,
          "exaggeration": 0.2,

          // 采样
          "temperature": 0.7,
          "topP": 0.95,
          "topK": 40,
          "repetitionPenalty": 1.0,

          // 进程管理
          "autoStart": true,       // 随 gateway 启动
          "healthCheckIntervalMs": 30000,
          "restartOnCrash": true,
          "maxRestarts": 3
        }
      }
    }
  }
}
```

插件启动时自动配置 `messages.tts` 指向 proxy 端口，用户不需要手动改 TTS config。

## API 设计

### Proxy 端点

Plugin 在 `proxyPort`（默认 19281）启动一个轻量 HTTP server：

```
POST /v1/audio/speech
```

接收 OpenAI 标准请求：
```json
{
  "model": "qwen3-tts",
  "input": "你好世界",
  "voice": "default"
}
```

Proxy 注入预设后转发：
```json
{
  "model": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
  "input": "你好世界",
  "voice": null,
  "speed": 1.1,
  "lang_code": "z",
  "ref_audio": "/Users/xxx/.openclaw/voices/my-voice.wav",
  "ref_text": "参考文本...",
  "temperature": 0.15,
  "top_p": 0.5,
  "response_format": "mp3"
}
```

透传响应（streaming audio）回 OpenClaw。

### Agent Tool

```typescript
api.registerTool({
  name: "mlx_audio_tts",
  description: "Generate speech audio locally using mlx-audio models.",
  parameters: {
    action: "generate" | "list_models" | "load_model" | "status",
    text: string,        // generate
    model: string,       // load_model / generate (override)
    voice: string,       // generate (override)
    refAudio: string,    // generate (override)
    outputPath: string,  // generate (save to file)
  }
});
```

### CLI Commands

```
/mlx-tts status      # server 状态、已加载模型、内存占用
/mlx-tts models      # 已加载模型列表
/mlx-tts load <model>   # 加载新模型
/mlx-tts unload <model> # 卸载模型释放内存
/mlx-tts test <text>    # 生成测试音频并发送
```

## 模型支持矩阵

| 模型 | 类型 | 大小 | 中文 | Voice Clone | Voice Design | 备注 |
|------|------|------|------|-------------|--------------|------|
| Kokoro-82M | 预设声音 | 82M | ❌ | ❌ | ❌ | 最快，英文为主 |
| Qwen3-TTS-0.6B-Base | Clone | ~1.2G | ✅ | ✅ | ❌ | 轻量 clone |
| Qwen3-TTS-1.7B-Base | Clone | ~3.4G | ✅ | ✅ | ❌ | 最佳 clone 质量 |
| Qwen3-TTS-0.6B-VoiceDesign | Design | ~1.2G | ✅ | ❌ | ✅ | 轻量 design |
| Qwen3-TTS-1.7B-VoiceDesign | Design | ~3.4G | ✅ | ❌ | ✅ | 最佳 design 质量 |
| CSM-1B | Clone | ~2G | ❌ | ✅ | ❌ | Sesame，英文 |
| Dia-1.6B | 对话 | ~3.2G | ❌ | ❌ | ❌ | 多说话人对话 |

用户在配置里指定 HuggingFace 模型 ID，插件自动下载。

## 性能预期

在 Mac Mini M2 Pro（16GB）上实测（Qwen3-TTS 1.7B Base）：

| 指标 | 值 |
|------|-----|
| 首次加载 | ~15s（模型进内存） |
| 推理速度 | ~3.3 tokens/s |
| 实时因子 | 0.26x（10s 音频花 38s） |
| 峰值内存 | 7.8GB |
| 冷启动 | 0（server 常驻） |

Kokoro 会快很多（模型小 40 倍），适合低延迟场景。

## 安装流程（用户视角）

```bash
# 1. 安装 mlx-audio（前置依赖）
uv tool install mlx-audio --with uvicorn --with fastapi --with webrtcvad-wheels --with "setuptools<70"

# 2. 安装插件
openclaw plugins install @cosformula/openclaw-mlx-audio

# 3. 配置模型
openclaw config set plugins.entries.mlx-audio.config.model "mlx-community/Kokoro-82M-bf16"

# 4. 重启 gateway（插件自动启动 server + 配置 TTS）
openclaw gateway restart
```

首次启动时模型自动从 HuggingFace 下载。之后 server 常驻内存，零冷启动。

## 文件结构

```
mlx-audio/
├── package.json
├── openclaw.plugin.json
├── index.ts                  # 插件入口
├── src/
│   ├── config.ts             # 配置 schema + 解析
│   ├── proxy.ts              # HTTP proxy（参数注入）
│   ├── process-manager.ts    # mlx_audio.server 子进程管理
│   └── health.ts             # 健康检查 + 自动重启
├── skills/
│   └── mlx-audio/
│       └── SKILL.md          # 插件附带的 skill
├── docs/
│   └── design.md             # 本文档
└── README.md
```

## 风险 & 取舍

| 风险 | 影响 | 缓解 |
|------|------|------|
| Apple Silicon only | 受众有限 | 明确标注平台要求；未来可支持 CUDA |
| mlx-audio API 不稳定 | 升级可能 break | 锁版本，Proxy 层做兼容 |
| 模型下载大 | 首次体验差 | 默认推荐 Kokoro（82M），README 说明 |
| 实时因子 > 1x（大模型） | TTS 延迟高 | 文档注明推荐配置；小模型兜底 |
| Python 依赖地狱 | 安装失败 | 提供 setup.sh 一键脚本；文档列出已知坑 |
| server 子进程崩溃 | TTS 静默失败 | 健康检查 + 自动重启 + 告警 |

## 时间估算

| 阶段 | 工作量 | 产出 |
|------|--------|------|
| MVP | 2-3 天 | npm 包，proxy + 进程管理，基础可用 |
| 完善 | 1 天 | CLI commands、多模型热切换、多 voice profile、文档 |
| 发布 | 0.5 天 | npm publish、README、测试 |

## 开放问题

1. **Proxy 是否必要？**
   如果 OpenClaw 上游接受 PR 让 `messages.tts.openai` 透传额外字段，Proxy 层可以省掉。值得提 issue/PR。

2. **STT 要不要一起做？**
   mlx_audio.server 同时支持 `/v1/audio/transcriptions`（Whisper），可以顺便做本地 STT。但会增加 scope，建议后续版本或单独插件。

3. **多声音配置？**
   支持在配置里定义多个 voice profile（不同 ref_audio），通过 voice 字段切换。类似 ElevenLabs 的 voiceId 概念。MVP 就做。

4. **Fallback 策略**
   server 挂了 / 模型没下载完 / 内存不够时，应该自动降级到云端 TTS 而不是静默失败。

---

*这个文档会随开发演进。*
