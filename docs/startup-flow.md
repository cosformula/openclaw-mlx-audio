# 启动流程说明（Gateway / Proxy / Server）

本文描述 `openclaw-mlx-audio` 在 OpenClaw 生命周期中的启动、首请求、停止、重启路径。

## 1. 组件关系

- `index.ts`: 插件入口与总编排
- `src/proxy.ts`: 对外代理（OpenAI 风格接口）
- `src/venv-manager.ts`: Python/uv 工具链与 venv 准备
- `src/process-manager.ts`: `mlx_audio.server` 子进程管理
- `src/health.ts`: 周期性健康检查与故障回调

## 2. 启动时序（Service start）

`registerService.start()` 的顺序：

1. `serviceRunning = true`
2. `await proxy.start()`，先监听代理端口（默认 `127.0.0.1:19281`）
3. 若 `autoStart=true`，异步触发 `ensureServerReady()` 进行后台预热
4. 记录 `Plugin ready` 日志并返回

关键点：

- Gateway 启动阶段不等待 Python 环境安装，不等待 `mlx_audio.server` 完全就绪。
- 也就是，插件可先进入 ready 状态，后续由后台预热或首个请求触发真正的后端启动。

## 3. 首次就绪链路（ensureServerReady）

`ensureServerReady()` 是唯一的上游就绪入口，包含去重逻辑（`ensureServerPromise`）。

执行步骤：

1. 若 `serviceRunning=false`，直接失败
2. 若 `procMgr.isRunning()`，只启动 health checker 并返回
3. 若已有 `ensureServerPromise`，复用同一个 Promise 等待完成
4. 否则进入真实启动：
   - `venvMgr.ensure()`
   - `procMgr.setPythonBin(...)`
   - `procMgr.start()`
   - 最多等待约 10 秒（20 次 * 500ms）探测 `/v1/models`
   - 健康检查器 `health.start()`

## 4. Python 环境准备（venv-manager）

`venvMgr.ensure()` 的顺序：

1. 快路径：`isReady()` 检查 `venv/bin/python` + `manifest.json` + `import mlx_audio`
2. 若未就绪：
   - 确保 `~/.openclaw/mlx-audio/bin/uv` 存在，不存在则下载并解压
   - 优先探测系统 Python 3.11-3.13
   - 若无兼容系统 Python，执行 `uv python install 3.12`
   - 执行 `uv venv --python ... ~/.openclaw/mlx-audio/venv`
   - 执行 `uv pip install --python <venv python> ...`
   - 下载 spacy 模型
   - 写入 `manifest.json`

## 5. 请求路径与阻塞点

代理请求处理规则：

- `POST /v1/audio/speech` 和 `GET /v1/models`
  - 会先 `await ensureServerReady()`
  - 因此在首启或重建环境时，这两个接口会等待初始化完成
- 其他路径
  - 不做 `ensureServerReady()`，直接透明转发

结论：

- Gateway 启动不阻塞
- 首个 TTS/models 请求可能阻塞（取决于预热进度和首次安装耗时）

## 6. 进程生命周期（process-manager）

`procMgr.start()`：

1. 内存检查（仅告警，不阻塞）
2. 端口占用检查与残留 `mlx_audio.server` 清理
3. `spawn(python -m mlx_audio.server ...)`

`procMgr.stop()`：

1. `stopping=true`
2. `SIGTERM`，最多等待 5 秒
3. 超时后 `SIGKILL`

异常退出：

- 若 `restartOnCrash=true`，按 `maxRestarts` 限额延迟重启
- 进程健康运行超过 30 秒后会重置崩溃计数
- health checker 连续失败 3 次时触发重启回调

## 7. 当前已知风险（来自本次 review）

1. 停止与启动并发存在竞态窗口
   - 在 `ensureServerReady()` 已通过 `serviceRunning` 检查但尚未完成 `procMgr.start()` 时，如果服务收到 `stop`，可能出现停止流程先返回，而子进程随后才被拉起的窗口。
2. `uv` 下载未设置显式请求超时
   - 极端网络条件下，首启阶段可能长时间等待下载阶段。

以上两点不影响常规 happy path，但建议后续以小改动补齐（启动/停止互斥与下载超时控制）。
