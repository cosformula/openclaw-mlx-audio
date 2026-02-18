import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VenvManager } from "../src/venv-manager.js";

type TestLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

function createLogger(): TestLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function createTempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mlx-audio-venv-test-"));
}

test("VenvManager isReady returns false when sync check fails before import probe", async () => {
  const dataDir = createTempDataDir();
  const manager = new VenvManager(dataDir, createLogger());
  const managerAny = manager as any;
  const pythonBin = path.join(dataDir, "runtime", ".venv", "bin", "python");
  fs.mkdirSync(path.dirname(pythonBin), { recursive: true });
  fs.writeFileSync(pythonBin, "#!/usr/bin/env python3\n");

  let importProbeCalled = false;
  managerAny.run = async () => {
    throw new Error("out of sync");
  };
  managerAny.runCommand = async () => {
    importProbeCalled = true;
    return { stdout: "", stderr: "" };
  };

  try {
    const ready = await managerAny.isReady("uv", pythonBin);
    assert.equal(ready, false);
    assert.equal(importProbeCalled, false);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("VenvManager prepareRuntimeProject copies bundled pyproject and lockfile", async () => {
  const dataDir = createTempDataDir();
  const manager = new VenvManager(dataDir, createLogger());
  const managerAny = manager as any;

  try {
    managerAny.prepareRuntimeProject();
    assert.equal(fs.existsSync(path.join(dataDir, "runtime", "pyproject.toml")), true);
    assert.equal(fs.existsSync(path.join(dataDir, "runtime", "uv.lock")), true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("VenvManager isReady returns true when sync check and import probe pass", async () => {
  const dataDir = createTempDataDir();
  const manager = new VenvManager(dataDir, createLogger());
  const managerAny = manager as any;
  const pythonBin = path.join(dataDir, "runtime", ".venv", "bin", "python");
  fs.mkdirSync(path.dirname(pythonBin), { recursive: true });
  fs.writeFileSync(pythonBin, "#!/usr/bin/env python3\n");
  const runCalls: string[][] = [];
  let importProbeCalled = false;

  managerAny.run = async (_cmd: string, args: string[]) => {
    runCalls.push(args);
  };
  managerAny.runCommand = async () => {
    importProbeCalled = true;
    return { stdout: "", stderr: "" };
  };

  try {
    const ready = await managerAny.isReady("uv", pythonBin);
    assert.equal(ready, true);
    assert.equal(importProbeCalled, true);
    assert.equal(runCalls.length, 1);
    assert.equal(runCalls[0]!.includes("--check"), true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("VenvManager run wraps command errors with command context", async () => {
  const dataDir = createTempDataDir();
  const manager = new VenvManager(dataDir, createLogger());
  const managerAny = manager as any;

  managerAny.runCommand = async () => {
    throw new Error("boom");
  };

  try {
    await assert.rejects(managerAny.run("uv", ["pip", "install"]), /Command failed: uv pip install[\s\S]*boom/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("VenvManager assertSha256 accepts matching digest", () => {
  const dataDir = createTempDataDir();
  const manager = new VenvManager(dataDir, createLogger());
  const managerAny = manager as any;

  try {
    const payload = Buffer.from("checksum-ok");
    const digest = createHash("sha256").update(payload).digest("hex");
    managerAny.assertSha256(payload, digest, "fixture.tar.gz");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("VenvManager ensureUv rejects download when checksum validation fails", async () => {
  const dataDir = createTempDataDir();
  const manager = new VenvManager(dataDir, createLogger());
  const managerAny = manager as any;

  managerAny.getUvTarget = () => "aarch64-apple-darwin";
  managerAny.downloadUvArchive = async () => Buffer.from("tampered-archive");
  managerAny.run = async () => {
    throw new Error("tar extraction should not execute on checksum mismatch");
  };

  try {
    await assert.rejects(managerAny.ensureUv(), /Checksum mismatch/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
