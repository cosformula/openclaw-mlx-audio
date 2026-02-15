import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";
import { runCommand } from "../src/run-command.js";

test("runCommand returns trimmed stdout/stderr and exit metadata", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "process.stdout.write(' ok\\n'); process.stderr.write(' warn\\n');"],
    { timeoutMs: 2000 },
  );

  assert.equal(result.stdout, "ok");
  assert.equal(result.stderr, "warn");
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
});

test("runCommand allows configured non-zero exit code", async () => {
  const result = await runCommand(process.execPath, ["-e", "process.exit(3);"], {
    timeoutMs: 2000,
    allowExitCodes: [3],
  });

  assert.equal(result.code, 3);
  assert.equal(result.signal, null);
});

test("runCommand rejects when exit code is not allowed", async () => {
  await assert.rejects(
    runCommand(process.execPath, ["-e", "console.error('boom'); process.exit(2);"], { timeoutMs: 2000 }),
    (err: unknown) => {
      assert.equal(err instanceof Error, true);
      assert.match((err as Error).message, /Command failed/);
      assert.match((err as Error).message, /boom/);
      return true;
    },
  );
});

test("runCommand rejects on timeout", async () => {
  await assert.rejects(
    runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000);"], { timeoutMs: 100 }),
    (err: unknown) => {
      assert.equal(err instanceof Error, true);
      assert.match((err as Error).message, /Timed out after 100ms/);
      return true;
    },
  );
});
