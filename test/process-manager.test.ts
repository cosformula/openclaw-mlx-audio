import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveConfig } from "../src/config.js";
import { ProcessManager } from "../src/process-manager.js";

type LoggerStore = {
  logger: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
  infos: string[];
  warns: string[];
  errors: string[];
};

function createLoggerStore(): LoggerStore {
  const infos: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    logger: {
      info: (message) => infos.push(message),
      warn: (message) => warns.push(message),
      error: (message) => errors.push(message),
    },
    infos,
    warns,
    errors,
  };
}

test("ProcessManager clears delayed restart timer on stop()", async () => {
  const { logger } = createLoggerStore();
  const cfg = resolveConfig({ restartOnCrash: true, maxRestarts: 3 });
  const manager = new ProcessManager(cfg, logger);

  let startCalls = 0;
  (manager as any).start = async () => {
    startCalls += 1;
  };

  (manager as any).scheduleRestart();
  await manager.stop();
  await new Promise((resolve) => setTimeout(resolve, 3200));

  assert.equal(startCalls, 0);
});

test("ProcessManager clears delayed restart timer on start()", async () => {
  const { logger } = createLoggerStore();
  const cfg = resolveConfig({ restartOnCrash: true, maxRestarts: 3 });
  const manager = new ProcessManager(cfg, logger);

  let spawnCalls = 0;
  (manager as any).checkMemory = () => {};
  (manager as any).killPortHolder = async () => {};
  (manager as any).spawn = () => {
    spawnCalls += 1;
    return true;
  };

  (manager as any).scheduleRestart();
  await manager.start();
  await new Promise((resolve) => setTimeout(resolve, 3200));

  assert.equal(spawnCalls, 1);
});

test("ProcessManager spawn() refuses to replace an existing process", () => {
  const { logger, warns } = createLoggerStore();
  const cfg = resolveConfig(undefined);
  const manager = new ProcessManager(cfg, logger);

  (manager as any).proc = { pid: 1234, killed: false };
  const started = (manager as any).spawn();

  assert.equal(started, false);
  assert.equal(warns.some((message) => message.includes("spawn() skipped: server already running")), true);
});

test("ProcessManager serializes start/stop to avoid startup race windows", async () => {
  const { logger } = createLoggerStore();
  const cfg = resolveConfig({ restartOnCrash: true, maxRestarts: 3 });
  const manager = new ProcessManager(cfg, logger);

  (manager as any).checkMemory = () => {};
  let releaseAssigned = false;
  let releaseKillPortHolder: (value?: void | PromiseLike<void>) => void = () => {};
  (manager as any).killPortHolder = () => new Promise<void>((resolve) => {
    releaseAssigned = true;
    releaseKillPortHolder = resolve;
  });

  let exitHandler: (() => void) | null = null;
  let killCalls = 0;
  (manager as any).spawn = () => {
    (manager as any).proc = {
      pid: 4321,
      killed: false,
      kill: () => {
        killCalls += 1;
        queueMicrotask(() => {
          if (exitHandler) exitHandler();
        });
      },
      once: (_event: string, cb: () => void) => {
        exitHandler = cb;
      },
    };
    return true;
  };

  const startPromise = manager.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stopPromise = manager.stop();

  let stopResolved = false;
  void stopPromise.then(() => {
    stopResolved = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stopResolved, false);

  assert.equal(releaseAssigned, true);
  releaseKillPortHolder();
  await Promise.all([startPromise, stopPromise]);

  assert.equal((manager as any).proc, null);
  assert.equal(killCalls >= 1, true);
});

test("ProcessManager ensures runtime directories exist before spawn", () => {
  const { logger } = createLoggerStore();
  const cfg = resolveConfig(undefined);
  const manager = new ProcessManager(cfg, logger);

  const originalHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "mlx-audio-home-"));
  process.env.HOME = tempHome;

  try {
    const runtime = (manager as any).ensureRuntimeDirs();
    assert.equal(fs.existsSync(runtime.dataDir), true);
    assert.equal(fs.existsSync(runtime.logDir), true);
    assert.equal(fs.statSync(runtime.dataDir).isDirectory(), true);
    assert.equal(fs.statSync(runtime.logDir).isDirectory(), true);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});
