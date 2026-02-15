#!/usr/bin/env bash
set -uo pipefail

# --- config ---
PORT=19380
PROXY_PORT=19381
TIMEOUT=300
PASS=0; FAIL=0; ERRORS=""
DATA_DIR="$HOME/.openclaw/mlx-audio-e2e"

echo "=== mlx-audio E2E Test ==="
echo "Ports: server=$PORT proxy=$PROXY_PORT"
echo "Data: $DATA_DIR"
echo ""

# --- helpers ---
cleanup() {
  echo ""
  echo "=== Teardown ==="
  # kill proxy and server on test ports
  for p in $PORT $PROXY_PORT; do
    pids=$(/usr/sbin/lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null || true)
    for pid in $pids; do
      kill "$pid" 2>/dev/null || true
    done
  done
  rm -f /tmp/e2e-test-ok.wav 2>/dev/null || true
  # keep data dir (venv cache) for faster re-runs
  echo "Cleaned up (data dir preserved at $DATA_DIR)"
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
    echo "  PASS: $name ($actual > $threshold)"
    ((PASS++))
  else
    echo "  FAIL: $name ($actual not > $threshold)"
    ((FAIL++))
    ERRORS="$ERRORS\n  - $name"
  fi
}

# --- setup ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Build ==="
cd "$PROJECT_DIR"
npm run build 2>&1 | tail -1

echo ""
echo "=== Bootstrap Python Environment ==="
# Use the plugin's own test runner to start server + proxy directly
node -e "
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const dataDir = '$DATA_DIR';
const port = $PORT;
const proxyPort = $PROXY_PORT;

// Ensure data dir
fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });

// Find python in managed venv or system
const venvPython = path.join(dataDir, 'venv', 'bin', 'python');
const uvBin = path.join(dataDir, 'bin', 'uv');

async function main() {
  // Dynamic import the built plugin modules
  const configMod = await import(path.join('$PROJECT_DIR', 'dist', 'src', 'config.js'));
  const venvMod = await import(path.join('$PROJECT_DIR', 'dist', 'src', 'venv-manager.js'));

  const logger = {
    info: (m) => console.log(m),
    error: (m) => console.error(m),
    warn: (m) => console.warn(m),
  };

  // Bootstrap venv
  const venv = new venvMod.VenvManager(dataDir, logger);
  const pythonBin = await venv.ensure();
  console.log('Python ready: ' + pythonBin);

  // Start mlx-audio server
  const serverArgs = ['-m', 'mlx_audio.server', '--port', String(port), '--workers', '1', '--log-dir', path.join(dataDir, 'logs')];
  console.log('Starting server: ' + pythonBin + ' ' + serverArgs.join(' '));
  const server = spawn(pythonBin, serverArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: dataDir,
  });
  server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  server.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

  // Wait for server healthy
  const deadline = Date.now() + ${TIMEOUT}000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/v1/models');
      if (res.ok) { console.log('Server healthy'); break; }
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }

  // Start proxy
  const proxyMod = await import(path.join('$PROJECT_DIR', 'dist', 'src', 'proxy.js'));
  const cfg = {
    model: 'mlx-community/Kokoro-82M-bf16',
    port: port,
    proxyPort: proxyPort,
    workers: 1,
    speed: 1.0,
    langCode: 'a',
    temperature: 0.7,
    autoStart: true,
    healthCheckIntervalMs: 30000,
    restartOnCrash: false,
    maxRestarts: 0,
  };
  const proxy = new proxyMod.TtsProxy(cfg, logger);
  await proxy.start();
  console.log('Proxy ready on ' + proxyPort);
  console.log('READY');
}
main().catch(err => { console.error(err); process.exit(1); });
" &
RUNNER_PID=$!

# Wait for READY signal or timeout
echo "Waiting for server + proxy (up to ${TIMEOUT}s)..."
READY=false
for i in $(seq 1 $((TIMEOUT / 5))); do
  if curl -sf "http://127.0.0.1:$PROXY_PORT/v1/models" > /dev/null 2>&1; then
    READY=true
    echo "Ready after $((i * 5))s"
    break
  fi
  sleep 5
done

if [ "$READY" = false ]; then
  echo "FATAL: Server did not become ready within ${TIMEOUT}s"
  exit 1
fi

# --- tests ---
echo ""
echo "=== Tests ==="

# T1: Health check
echo "[T1] Health check"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PROXY_PORT/v1/models")
assert_eq "GET /v1/models returns 200" "200" "$STATUS"

# T2: Generate audio
echo "[T2] Generate audio"
HTTP_CODE=$(curl -s --max-time 120 -o /tmp/e2e-test-ok.wav -w "%{http_code}" \
  "http://127.0.0.1:$PROXY_PORT/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello, this is an end to end test."}' || echo "000")
assert_eq "POST /v1/audio/speech returns 200" "200" "$HTTP_CODE"

if [ -f /tmp/e2e-test-ok.wav ]; then
  FILE_SIZE=$(stat -f%z /tmp/e2e-test-ok.wav 2>/dev/null || stat -c%s /tmp/e2e-test-ok.wav 2>/dev/null || echo 0)
  assert_gt "Audio file size > 1000 bytes" 1000 "$FILE_SIZE"

  if command -v ffprobe &>/dev/null; then
    DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 /tmp/e2e-test-ok.wav 2>/dev/null || echo 0)
    assert_gt "Audio duration > 0.5s" 0.5 "$DURATION"
  else
    echo "  SKIP: ffprobe not found"
  fi
else
  echo "  FAIL: Audio file not created"
  ((FAIL++))
  ERRORS="$ERRORS\n  - Audio file not created"
fi

# T3: Empty input returns 400
echo "[T3] Empty input"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "http://127.0.0.1:$PROXY_PORT/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d '{"input": ""}')
assert_eq "Empty input returns 400" "400" "$STATUS"

# T4: Invalid JSON returns 400
echo "[T4] Invalid JSON"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "http://127.0.0.1:$PROXY_PORT/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d 'not json')
assert_eq "Invalid JSON returns 400" "400" "$STATUS"

# --- report ---
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  echo -e "Failed tests:$ERRORS"
  exit 1
fi
echo "All tests passed!"
