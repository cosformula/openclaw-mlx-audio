import assert from "node:assert/strict";
import test from "node:test";
import { HealthChecker } from "../src/health.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

function stubPingSequence(checker: HealthChecker, outcomes: Array<boolean | Error>): void {
  let index = 0;
  (checker as unknown as { ping: () => Promise<boolean> }).ping = async () => {
    const result = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
}

function createLoggerStore(): { logger: Logger; infos: string[]; warns: string[] } {
  const infos: string[] = [];
  const warns: string[] = [];
  return {
    logger: {
      info: (message) => infos.push(message),
      warn: (message) => warns.push(message),
    },
    infos,
    warns,
  };
}

test("check triggers unhealthy callback after 3 consecutive failures", async () => {
  const { logger, warns } = createLoggerStore();
  let unhealthyCalls = 0;
  const checker = new HealthChecker(19280, 1000, logger, () => {
    unhealthyCalls += 1;
  });
  stubPingSequence(checker, [false, false, false, false]);

  assert.equal(await checker.check(), false);
  assert.equal(await checker.check(), false);
  assert.equal(await checker.check(), false);

  assert.equal(unhealthyCalls, 1);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /failed 3 times/);

  // Counter should be reset after unhealthy callback.
  assert.equal(await checker.check(), false);
  assert.equal(unhealthyCalls, 1);
  assert.equal(warns.length, 1);
});

test("check logs recovery when a healthy ping follows failures", async () => {
  const { logger, infos, warns } = createLoggerStore();
  const checker = new HealthChecker(19280, 1000, logger, () => {
    throw new Error("onUnhealthy should not be called");
  });
  stubPingSequence(checker, [false, true]);

  assert.equal(await checker.check(), false);
  assert.equal(await checker.check(), true);

  assert.equal(warns.length, 0);
  assert.equal(infos.length, 1);
  assert.match(infos[0], /Health check recovered/);
});

test("check treats ping exceptions as failures", async () => {
  const { logger, warns } = createLoggerStore();
  let unhealthyCalls = 0;
  const checker = new HealthChecker(19280, 1000, logger, () => {
    unhealthyCalls += 1;
  });
  stubPingSequence(checker, [
    new Error("network failure"),
    new Error("network failure"),
    new Error("network failure"),
  ]);

  assert.equal(await checker.check(), false);
  assert.equal(await checker.check(), false);
  assert.equal(await checker.check(), false);

  assert.equal(unhealthyCalls, 1);
  assert.equal(warns.length, 1);
});

test("stop resets failure state", async () => {
  const { logger, infos } = createLoggerStore();
  const checker = new HealthChecker(19280, 1000, logger, () => {
    throw new Error("onUnhealthy should not be called");
  });
  stubPingSequence(checker, [false, false, true]);

  assert.equal(await checker.check(), false);
  assert.equal(await checker.check(), false);

  checker.stop();

  assert.equal(await checker.check(), true);
  assert.equal(infos.length, 0);
});

test("check reuses the in-flight probe for concurrent calls", async () => {
  const { logger } = createLoggerStore();
  const checker = new HealthChecker(19280, 1000, logger, () => {
    throw new Error("onUnhealthy should not be called");
  });

  let pingCalls = 0;
  (checker as unknown as { ping: () => Promise<boolean> }).ping = async () => {
    pingCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return true;
  };

  const [a, b, c] = await Promise.all([checker.check(), checker.check(), checker.check()]);
  assert.equal(a, true);
  assert.equal(b, true);
  assert.equal(c, true);
  assert.equal(pingCalls, 1);
});

test("start schedules the next check only after the previous one completes", async () => {
  const { logger } = createLoggerStore();
  const checker = new HealthChecker(19280, 5, logger, () => {
    throw new Error("onUnhealthy should not be called");
  });

  let inFlight = 0;
  let maxInFlight = 0;
  let pingCalls = 0;
  (checker as unknown as { ping: () => Promise<boolean> }).ping = async () => {
    pingCalls += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 30));
    inFlight -= 1;
    return true;
  };

  checker.start();
  await new Promise((resolve) => setTimeout(resolve, 110));
  checker.stop();
  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.ok(pingCalls >= 2);
  assert.equal(maxInFlight, 1);
});
