import assert from "node:assert/strict";
import test from "node:test";
import { buildInjectedParams, resolveConfig } from "../src/config.js";

test("resolveConfig uses defaults when config is undefined", () => {
  const cfg = resolveConfig(undefined);

  assert.equal(cfg.port, 19280);
  assert.equal(cfg.proxyPort, 19281);
  assert.equal(cfg.model, "mlx-community/Kokoro-82M-bf16");
  assert.equal(cfg.pythonEnvMode, "managed");
  assert.equal(cfg.speed, 1.0);
  assert.equal(cfg.langCode, "a");
  assert.equal(cfg.workers, 1);
});

test("resolveConfig applies user overrides", () => {
  const cfg = resolveConfig({
    port: 20000,
    proxyPort: 20001,
    model: "mlx-community/Kokoro-82M-8bit",
    pythonEnvMode: "external",
    pythonExecutable: " /opt/homebrew/bin/python3.12 ",
    speed: 1.2,
    topP: 0.8,
    workers: 2,
  });

  assert.equal(cfg.port, 20000);
  assert.equal(cfg.proxyPort, 20001);
  assert.equal(cfg.model, "mlx-community/Kokoro-82M-8bit");
  assert.equal(cfg.pythonEnvMode, "external");
  assert.equal(cfg.pythonExecutable, "/opt/homebrew/bin/python3.12");
  assert.equal(cfg.speed, 1.2);
  assert.equal(cfg.topP, 0.8);
  assert.equal(cfg.workers, 2);
});

test("resolveConfig reports validation errors for invalid fields", () => {
  assert.throws(
    () => resolveConfig({
      port: 0,
      proxyPort: 0,
      pythonEnvMode: "external",
      speed: 0,
      topP: 1.5,
      workers: 0,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /port must be an integer between 1 and 65535/);
      assert.match(error.message, /proxyPort must be an integer between 1 and 65535/);
      assert.match(error.message, /port and proxyPort must be different/);
      assert.match(error.message, /pythonExecutable is required when pythonEnvMode is 'external'/);
      assert.match(error.message, /speed must be > 0/);
      assert.match(error.message, /topP must be > 0 and <= 1/);
      assert.match(error.message, /workers must be an integer >= 1/);
      return true;
    },
  );
});

test("resolveConfig rejects invalid pythonEnvMode", () => {
  assert.throws(
    () => resolveConfig({ pythonEnvMode: "invalid-mode" as unknown as "managed" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /pythonEnvMode must be either 'managed' or 'external'/);
      return true;
    },
  );
});

test("buildInjectedParams includes optional fields when provided", () => {
  const cfg = resolveConfig({
    refAudio: "/tmp/ref.wav",
    refText: "reference text",
    instruct: "calm style",
  });

  const params = buildInjectedParams(cfg);

  assert.equal(params.model, cfg.model);
  assert.equal(params.lang_code, cfg.langCode);
  assert.equal(params.response_format, "mp3");
  assert.equal(params.ref_audio, "/tmp/ref.wav");
  assert.equal(params.ref_text, "reference text");
  assert.equal(params.instruct, "calm style");
});

test("buildInjectedParams skips optional fields when absent", () => {
  const cfg = resolveConfig(undefined);
  const params = buildInjectedParams(cfg);

  assert.equal(Object.hasOwn(params, "ref_audio"), false);
  assert.equal(Object.hasOwn(params, "ref_text"), false);
  assert.equal(Object.hasOwn(params, "instruct"), false);
});
