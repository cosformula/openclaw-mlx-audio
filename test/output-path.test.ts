import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeOutputFileSecure, type OutputPathOptions } from "../src/output-path.js";

type Sandbox = {
  rootDir: string;
  opts: OutputPathOptions;
  cleanup: () => void;
};

function createSandbox(): Sandbox {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "mlx-audio-output-path-test-"));
  const tmpDir = path.join(rootDir, "tmp");
  const systemTmpDir = path.join(rootDir, "system-tmp");
  const outputDir = path.join(rootDir, "outputs");
  const homeDir = path.join(rootDir, "home");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(systemTmpDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });

  return {
    rootDir,
    opts: { tmpDir, systemTmpDir, outputDir, homeDir },
    cleanup: () => fs.rmSync(rootDir, { recursive: true, force: true }),
  };
}

test("writeOutputFileSecure writes relative paths under outputDir", () => {
  const sandbox = createSandbox();
  try {
    const payload = Buffer.from("audio");
    const result = writeOutputFileSecure(payload, "nested/result.mp3", sandbox.opts);

    assert.equal(result.path, path.join(sandbox.opts.outputDir, "nested", "result.mp3"));
    assert.equal(result.bytes, payload.length);
    assert.equal(fs.readFileSync(result.path, "utf8"), "audio");
  } finally {
    sandbox.cleanup();
  }
});

test("writeOutputFileSecure keeps default output inside tmpDir", () => {
  const sandbox = createSandbox();
  try {
    const payload = Buffer.from("audio");
    const result = writeOutputFileSecure(payload, undefined, { ...sandbox.opts, now: () => 123 });

    assert.equal(result.path, path.join(sandbox.opts.tmpDir, "mlx-audio-123.mp3"));
    assert.equal(fs.readFileSync(result.path, "utf8"), "audio");
  } finally {
    sandbox.cleanup();
  }
});

test("writeOutputFileSecure rejects absolute paths outside allowed roots", () => {
  const sandbox = createSandbox();
  try {
    const payload = Buffer.from("audio");
    const outsidePath = path.join(sandbox.rootDir, "outside", "escape.mp3");

    assert.throws(
      () => writeOutputFileSecure(payload, outsidePath, sandbox.opts),
      /outputPath must be under/,
    );
  } finally {
    sandbox.cleanup();
  }
});

test("writeOutputFileSecure rejects symlink directories in output path", () => {
  const sandbox = createSandbox();
  try {
    const payload = Buffer.from("audio");
    const outsideDir = path.join(sandbox.rootDir, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });

    const linkPath = path.join(sandbox.opts.outputDir, "linked");
    fs.symlinkSync(outsideDir, linkPath);

    assert.throws(
      () => writeOutputFileSecure(payload, path.join("linked", "escape.mp3"), sandbox.opts),
      /symbolic link segment/,
    );
  } finally {
    sandbox.cleanup();
  }
});

test("writeOutputFileSecure rejects symlink target files", () => {
  const sandbox = createSandbox();
  try {
    const payload = Buffer.from("audio");
    const outsideDir = path.join(sandbox.rootDir, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideFile = path.join(outsideDir, "target.mp3");
    fs.writeFileSync(outsideFile, "outside");

    const linkTarget = path.join(sandbox.opts.outputDir, "linked-file.mp3");
    fs.symlinkSync(outsideFile, linkTarget);

    assert.throws(
      () => writeOutputFileSecure(payload, linkTarget, sandbox.opts),
      /cannot be a symbolic link/,
    );
  } finally {
    sandbox.cleanup();
  }
});
