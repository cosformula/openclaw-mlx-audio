import assert from "node:assert/strict";
import test from "node:test";
import { buildInjectedParams, detectLangCode, resolveConfig, resolvePortBinding } from "../src/config.js";

test("resolveConfig uses defaults when config is undefined", () => {
  const cfg = resolveConfig(undefined);
  const ports = resolvePortBinding(cfg);

  assert.equal(cfg.port, 19280);
  assert.equal(cfg.proxyPort, undefined);
  assert.equal(ports.publicPort, 19280);
  assert.equal(ports.serverPort, 19281);
  assert.equal(ports.mode, "single-port");
  assert.equal(cfg.model, "mlx-community/Kokoro-82M-bf16");
  assert.equal(cfg.pythonEnvMode, "managed");
  assert.equal(cfg.speed, 1.0);
  assert.equal(cfg.langCode, "auto");
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
  const ports = resolvePortBinding(cfg);

  assert.equal(cfg.port, 20000); // legacy server port
  assert.equal(cfg.proxyPort, 20001); // legacy public endpoint
  assert.equal(ports.publicPort, 20001);
  assert.equal(ports.serverPort, 20000);
  assert.equal(ports.mode, "legacy-dual-port");
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
      assert.match(error.message, /proxyPort must be an integer between 1 and 65535 when provided/);
      assert.match(error.message, /port and proxyPort must be different/);
      assert.match(error.message, /pythonExecutable is required when pythonEnvMode is 'external'/);
      assert.match(error.message, /speed must be > 0/);
      assert.match(error.message, /topP must be > 0 and <= 1/);
      assert.match(error.message, /workers must be an integer >= 1/);
      return true;
    },
  );
});

test("resolvePortBinding derives internal server port in single-port mode", () => {
  const cfg = resolveConfig({ port: 31000 });
  const ports = resolvePortBinding(cfg);

  assert.equal(ports.publicPort, 31000);
  assert.equal(ports.serverPort, 31001);
  assert.equal(ports.mode, "single-port");
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
    langCode: "z",
  });

  const params = buildInjectedParams(cfg);

  assert.equal(params.model, cfg.model);
  assert.equal(params.lang_code, "z");
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

test("detectLangCode returns 'a' for English text", () => {
  assert.equal(detectLangCode("Hello, how are you?"), "a");
  assert.equal(detectLangCode("The quick brown fox"), "a");
});

test("detectLangCode returns 'z' for Chinese text", () => {
  assert.equal(detectLangCode("你好世界"), "z");
  assert.equal(detectLangCode("今天天气不错"), "z");
});

test("detectLangCode returns 'j' for Japanese text", () => {
  assert.equal(detectLangCode("こんにちは世界"), "j");
  assert.equal(detectLangCode("おはようございます"), "j");
});

test("detectLangCode returns 'z' for Chinese with some English", () => {
  assert.equal(detectLangCode("这个API的性能很好"), "z");
});

test("detectLangCode returns 'a' for mostly English with few Chinese chars", () => {
  assert.equal(detectLangCode("This is a long English sentence with the word 你 in it somewhere"), "a");
});

test("buildInjectedParams auto-detects language from text", () => {
  const cfg = resolveConfig(undefined); // langCode defaults to "auto"
  assert.equal(cfg.langCode, "auto");

  const enParams = buildInjectedParams(cfg, "Hello world");
  assert.equal(enParams.lang_code, "a");

  const zhParams = buildInjectedParams(cfg, "你好世界");
  assert.equal(zhParams.lang_code, "z");

  const jaParams = buildInjectedParams(cfg, "こんにちは世界");
  assert.equal(jaParams.lang_code, "j");
});

test("buildInjectedParams uses explicit langCode when not auto", () => {
  const cfg = resolveConfig({ langCode: "z" });
  const params = buildInjectedParams(cfg, "Hello world");
  assert.equal(params.lang_code, "z"); // explicit override, not auto-detected
});
