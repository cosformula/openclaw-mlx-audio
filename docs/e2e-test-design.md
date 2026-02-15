# OpenClaw Plugin/Skill E2E 测试方案

## 目标

在隔离环境中测试插件和 skill 的完整生命周期：安装、配置、启动、功能验证、清理。可复用于所有自研插件和 skill。

## 核心机制

利用 OpenClaw 的 `--profile` 隔离能力，每次测试创建独立实例，互不影响，不碰生产环境。

```
~/.openclaw-e2e-<name>/    # 隔离的数据目录
├── openclaw.json           # 测试用配置
├── plugins/                # 插件安装目录
├── skills/                 # skill 目录
└── mlx-audio/              # 插件运行时数据（venv 等）
```

## 测试流程

```
setup → install → configure → start gateway → wait ready → run tests → teardown
```

### 1. Setup

```bash
PROFILE="e2e-$(date +%s)"
STATE_DIR="$HOME/.openclaw-$PROFILE"
```

### 2. Install

```bash
# 插件
openclaw --profile "$PROFILE" plugin install @cosformula/openclaw-mlx-audio

# 或本地开发版本
openclaw --profile "$PROFILE" plugin install --path ./

# Skill
cp -r /path/to/skill "$STATE_DIR/skills/"
```

### 3. Configure

写入最小化测试配置：

```bash
cat > "$STATE_DIR/openclaw.json" << 'EOF'
{
  "plugins": {
    "entries": {
      "openclaw-mlx-audio": {
        "enabled": true,
        "config": {
          "model": "mlx-community/Kokoro-82M-bf16",
          "autoStart": true
        }
      }
    }
  },
  "env": {
    "vars": {
      "OPENAI_TTS_BASE_URL": "http://127.0.0.1:19281/v1",
      "HF_HOME": "/Users/zhaoyiqun/.cache/huggingface"
    }
  },
  "messages": {
    "tts": {
      "provider": "openai",
      "openai": { "apiKey": "local" }
    }
  }
}
EOF
```

注意：`HF_HOME` 指向共享缓存，避免重复下载模型。

### 4. Start & Wait

```bash
openclaw --profile "$PROFILE" gateway start

# 等待插件就绪（轮询健康检查）
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:19281/v1/models > /dev/null 2>&1; then
    echo "Plugin ready"
    break
  fi
  sleep 5
done
```

首次启动需要 venv bootstrap（1-2 分钟）+ 模型加载，总超时设 5 分钟。

### 5. Test Cases

#### mlx-audio 插件测试

```bash
# T1: 健康检查
curl -sf http://127.0.0.1:19281/v1/models | jq .

# T2: 生成英文音频
curl -sf http://127.0.0.1:19281/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello, this is a test.", "voice": "af_heart"}' \
  -o /tmp/e2e-test.wav

# 验证音频有效
ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/e2e-test.wav
# 期望：duration > 0

# T3: 空输入应返回 400
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" http://127.0.0.1:19281/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input": ""}')
[ "$STATUS" = "400" ] && echo "PASS" || echo "FAIL"

# T4: 超大请求应返回 413
python3 -c "print('{\"input\":\"' + 'a'*2000000 + '\"}')" | \
  curl -sf -o /dev/null -w "%{http_code}" http://127.0.0.1:19281/v1/audio/speech \
  -H "Content-Type: application/json" -d @-
# 期望：413
```

#### Skill 测试模板

```bash
# 通过 OpenClaw CLI 触发 skill
openclaw --profile "$PROFILE" agent run --message "用 xxx skill 做 yyy"

# 或直接调用 skill 暴露的 CLI/API
```

### 6. Teardown

```bash
openclaw --profile "$PROFILE" gateway stop
rm -rf "$STATE_DIR"
rm -f /tmp/e2e-test.wav
```

## CI 集成

```yaml
# .github/workflows/e2e.yml
name: E2E
on:
  push:
    branches: [main]
    tags: ['v*']

jobs:
  e2e:
    runs-on: self-hosted  # Mac Mini, Apple Silicon
    timeout-minutes: 15
    env:
      HF_HOME: /Users/zhaoyiqun/.cache/huggingface
    steps:
      - uses: actions/checkout@v4

      - name: Run E2E tests
        run: ./tests/e2e.sh

      - name: Upload logs on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-logs
          path: /tmp/e2e-logs/
```

## 可复用测试脚本框架

`tests/e2e.sh` 结构：

```bash
#!/usr/bin/env bash
set -euo pipefail

PROFILE="e2e-$$"
STATE_DIR="$HOME/.openclaw-$PROFILE"
PASS=0; FAIL=0; ERRORS=""

cleanup() {
  openclaw --profile "$PROFILE" gateway stop 2>/dev/null || true
  # 保留日志用于诊断
  mkdir -p /tmp/e2e-logs
  cp -r "$STATE_DIR/logs" /tmp/e2e-logs/ 2>/dev/null || true
  rm -rf "$STATE_DIR"
}
trap cleanup EXIT

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $name"
    ((PASS++))
  else
    echo "  FAIL: $name (expected=$expected, actual=$actual)"
    ((FAIL++))
    ERRORS="$ERRORS\n  - $name"
  fi
}

assert_gt() {
  local name="$1" threshold="$2" actual="$3"
  if awk "BEGIN{exit !($actual > $threshold)}"; then
    echo "  PASS: $name"
    ((PASS++))
  else
    echo "  FAIL: $name ($actual <= $threshold)"
    ((FAIL++))
    ERRORS="$ERRORS\n  - $name"
  fi
}

# --- setup ---
echo "=== Setup (profile: $PROFILE) ==="
# install, configure, start ...

# --- tests ---
echo "=== Running tests ==="
# test cases here ...

# --- report ---
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo -e "Failed tests:$ERRORS"
  exit 1
fi
```

## 端口冲突处理

测试实例的 mlx-audio 端口可能和生产实例冲突（都用 19280/19281）。方案：

1. 测试配置里用不同端口（如 19380/19381）
2. 或在测试前检查端口是否被占用，被占用则跳过

## 模型缓存

`HF_HOME` 指向共享的 huggingface 缓存目录，模型只下载一次。venv 不共享（每次重建，这正是要测的）。

## 适用范围

| 类型 | 测试内容 | 示例 |
|---|---|---|
| Plugin | 安装、bootstrap、API 功能 | mlx-audio |
| Skill (CLI) | 安装、命令执行、输出验证 | douban-sync, wakapi-sync |
| Skill (tool) | 安装、tool 注册、调用返回 | weather, summarize |

每个项目在自己 repo 的 `tests/e2e.sh` 里写测试逻辑，共享同一套 assert 函数和 setup/teardown 模式。
