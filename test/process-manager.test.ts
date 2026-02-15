import assert from "node:assert/strict";
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
