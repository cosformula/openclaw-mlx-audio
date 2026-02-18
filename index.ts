/**
 * mlx-audio — OpenClaw local TTS plugin
 *
 * Provides local text-to-speech via mlx-audio on Apple Silicon Macs.
 * Zero API key, zero cloud dependency.
 */

import { resolveConfig, resolvePortBinding, buildInjectedParams, type MlxAudioConfig } from "./src/config.js";
import { ProcessManager } from "./src/process-manager.js";
import { TtsProxy } from "./src/proxy.js";
import { HealthChecker } from "./src/health.js";
import { VenvManager } from "./src/venv-manager.js";
import { resolveSecureOutputPath } from "./src/output-path.js";
import { runCommand } from "./src/run-command.js";
import {
  StartupStatusTracker,
  formatStartupStatusForDisplay,
  formatStartupStatusForError,
} from "./src/startup-status.js";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

interface PluginApi {
  logger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    warn: (msg: string) => void;
  };
  config: {
    plugins?: {
      entries?: Record<string, { enabled?: boolean; config?: Record<string, unknown> }>;
    };
  };
  getPluginConfig?: (pluginId?: string) => unknown;
  getConfig?: (pluginId?: string) => unknown;
  registerService: (svc: { id: string; start: () => Promise<void> | void; stop: () => Promise<void> | void }) => void;
  registerTool: (tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
  }) => void;
  registerCommand: (cmd: {
    name: string;
    description: string;
    acceptsArgs?: boolean;
    handler: (ctx: { args?: string }) => { text: string } | Promise<{ text: string }>;
  }) => void;
  on?: (hookName: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }) => void;
}

const STARTUP_HEALTH_MAX_ATTEMPTS = 20;
const STARTUP_HEALTH_INTERVAL_MS = 500;
const STARTUP_HEALTH_TIMEOUT_MS = STARTUP_HEALTH_MAX_ATTEMPTS * STARTUP_HEALTH_INTERVAL_MS;
const CONFIG_REFRESH_INTERVAL_MS = 2000;
const GENERATE_REQUEST_TIMEOUT_MS = 600_000;
const MAX_AUDIO_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_ERROR_DETAIL_BYTES = 8 * 1024;
const DEFAULT_PLUGIN_ID = "openclaw-mlx-audio";
const SPACY_MODEL_WHEEL_URL =
  "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl";
const EXTERNAL_PYTHON_REQUIRED_MODULES = [
  "mlx_audio",
  "uvicorn",
  "fastapi",
  "multipart",
  "webrtcvad",
  "misaki",
  "num2words",
  "phonemizer",  // phonemizer-fork provides the same 'phonemizer' module
  "spacy",
  "en_core_web_sm",
];

type Logger = PluginApi["logger"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadPluginId(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const manifestPath = path.resolve(dir, "openclaw.plugin.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        if (typeof manifest.id === "string" && manifest.id.length > 0) {
          return manifest.id;
        }
      } catch {
        return DEFAULT_PLUGIN_ID;
      }
      return DEFAULT_PLUGIN_ID;
    }
    dir = path.resolve(dir, "..");
  }
  return DEFAULT_PLUGIN_ID;
}

const PLUGIN_ID = loadPluginId();

function extractPluginConfig(value: unknown, pluginId: string): Partial<MlxAudioConfig> | undefined {
  if (!isRecord(value)) return undefined;

  if (isRecord(value.plugins) && isRecord(value.plugins.entries)) {
    const entry = value.plugins.entries[pluginId];
    if (isRecord(entry) && isRecord(entry.config)) {
      return entry.config as Partial<MlxAudioConfig>;
    }
  }

  if (isRecord(value.entries)) {
    const entry = value.entries[pluginId];
    if (isRecord(entry) && isRecord(entry.config)) {
      return entry.config as Partial<MlxAudioConfig>;
    }
  }

  if (isRecord(value.config)) {
    return value.config as Partial<MlxAudioConfig>;
  }

  return value as Partial<MlxAudioConfig>;
}

function readRawConfig(api: PluginApi, pluginId: string): Partial<MlxAudioConfig> | undefined {
  const accessorCandidates: unknown[] = [
    api.getPluginConfig?.(pluginId),
    api.getPluginConfig?.(),
    api.getConfig?.(pluginId),
    api.getConfig?.(),
  ];

  for (const candidate of accessorCandidates) {
    const config = extractPluginConfig(candidate, pluginId);
    if (config) return config;
  }

  return api.config.plugins?.entries?.[pluginId]?.config as Partial<MlxAudioConfig> | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pingServer(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/v1/models", timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServerHealthy(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < STARTUP_HEALTH_MAX_ATTEMPTS; attempt++) {
    if (await pingServer(port)) return true;
    if (attempt < STARTUP_HEALTH_MAX_ATTEMPTS - 1) {
      await sleep(STARTUP_HEALTH_INTERVAL_MS);
    }
  }
  return false;
}

async function validateExternalPython(pythonExecutable: string, logger: Logger): Promise<void> {
  logger.info(`[mlx-audio] Validating external Python executable: ${pythonExecutable}`);

  let versionText = "";
  try {
    const { stdout, stderr } = await runCommand(pythonExecutable, ["--version"], {
      timeoutMs: 5000,
      env: process.env,
    });
    versionText = `${stdout}\n${stderr}`.trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[mlx-audio] pythonExecutable is not runnable: ${pythonExecutable}. ` +
      `Use an installed Python 3.11-3.13 interpreter. Details: ${msg}`,
    );
  }

  const versionMatch = versionText.match(/Python\s+(\d+)\.(\d+)(?:\.\d+)?/i);
  if (!versionMatch) {
    throw new Error(`[mlx-audio] Unable to parse Python version from: "${versionText || "(empty output)"}"`);
  }
  const major = Number(versionMatch[1]);
  const minor = Number(versionMatch[2]);
  if (!(major === 3 && minor >= 11 && minor <= 13)) {
    throw new Error(
      `[mlx-audio] Unsupported pythonExecutable version (${versionText}). ` +
      "Use Python 3.11, 3.12, or 3.13.",
    );
  }

  const checkScript = [
    "import importlib, json",
    `modules = ${JSON.stringify(EXTERNAL_PYTHON_REQUIRED_MODULES)}`,
    "missing = []",
    "for module_name in modules:",
    "    try:",
    "        importlib.import_module(module_name)",
    "    except Exception:",
    "        missing.append(module_name)",
    "print(json.dumps({'missing': missing}))",
  ].join("\n");

  let moduleCheckText = "";
  let moduleCheckStderr = "";
  try {
    const { stdout, stderr } = await runCommand(pythonExecutable, ["-c", checkScript], {
      timeoutMs: 15000,
      env: process.env,
    });
    moduleCheckText = stdout.trim();
    moduleCheckStderr = stderr.trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[mlx-audio] Failed to verify external Python modules. Details: ${msg}`);
  }

  let missingModules: string[] = [];
  try {
    const parsed = JSON.parse(moduleCheckText || "{}");
    if (Array.isArray(parsed.missing)) {
      missingModules = parsed.missing.filter((item: unknown): item is string => typeof item === "string");
    }
  } catch {
    throw new Error(
      `[mlx-audio] Unexpected output while checking external Python modules: ${moduleCheckText || "(empty output)"}${moduleCheckStderr ? `; stderr: ${moduleCheckStderr}` : ""}`,
    );
  }

  if (missingModules.length > 0) {
    const installCmd =
      `${pythonExecutable} -m pip install mlx-audio uvicorn fastapi python-multipart ` +
      `'setuptools<81' webrtcvad 'misaki[en,zh,ja,ko,vi,he]' num2words phonemizer-fork "spacy>=3.8,<3.9" "${SPACY_MODEL_WHEEL_URL}"`;
    throw new Error(
      `[mlx-audio] External python is missing required modules: ${missingModules.join(", ")}. ` +
      `Install dependencies in that environment, for example:\n${installCmd}`,
    );
  }

  logger.info(`[mlx-audio] External Python environment ready (${versionText})`);
}

export default function register(api: PluginApi) {
  let cfg = resolveConfig(readRawConfig(api, PLUGIN_ID));
  let portBinding = resolvePortBinding(cfg);
  let configFingerprint = JSON.stringify(cfg);
  const logger = api.logger;

  // Data dir for managed runtime and models (~/.openclaw/mlx-audio/)
  const dataDir = path.join(os.homedir(), ".openclaw", "mlx-audio");
  const outputDir = path.join(dataDir, "outputs");
  const tmpDir = "/tmp";
  const systemTmpDir = path.resolve(os.tmpdir());
  const homeDir = os.homedir();
  const venvMgr = new VenvManager(dataDir, logger);
  let startupStatus = new StartupStatusTracker(cfg.model, homeDir, logger);
  let pythonRuntimePrepared = false;

  const procMgr = new ProcessManager(cfg, logger);
  procMgr.on("max-restarts", () => {
    logger.error("[mlx-audio] Restart budget exhausted, server will remain stopped until manual intervention");
  });
  let serviceRunning = false;
  let health = createHealthChecker(cfg);
  let ensureServerPromise: Promise<void> | null = null;
  let configQueue: Promise<void> = Promise.resolve();
  let configRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  function createStartupTimeoutError(): Error {
    const detail = formatStartupStatusForError(startupStatus.getSnapshot());
    return new Error(`[mlx-audio] Server did not pass health check within ${STARTUP_HEALTH_TIMEOUT_MS}ms. ${detail}`);
  }

  function createHealthChecker(currentCfg: MlxAudioConfig): HealthChecker {
    const ports = resolvePortBinding(currentCfg);
    return new HealthChecker(ports.serverPort, currentCfg.healthCheckIntervalMs, logger, () => {
      if (cfg.restartOnCrash && procMgr.isRunning()) {
        logger.warn("[mlx-audio] Server unhealthy, restarting...");
        procMgr
          .restart({ resetCrashCounter: false, reason: "health check failures" })
          .catch((err) => logger.error(`[mlx-audio] Restart failed: ${err}`));
      }
    });
  }

  async function runConfigTask(task: () => Promise<void>): Promise<void> {
    const previous = configQueue;
    let release: () => void = () => {};
    configQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      await task();
    } finally {
      release();
    }
  }

  async function applyConfig(reason: string, options?: { force?: boolean }): Promise<{ changed: boolean; restartedServer: boolean }> {
    let changed = false;
    let restartServerAfterApply = false;

    await runConfigTask(async () => {
      const nextCfg = resolveConfig(readRawConfig(api, PLUGIN_ID));
      const nextFingerprint = JSON.stringify(nextCfg);
      const shouldApply = options?.force === true || nextFingerprint !== configFingerprint;
      if (!shouldApply) return;

      changed = nextFingerprint !== configFingerprint;
      const wasServerRunning = procMgr.isRunning();
      const runtimeChanged =
        cfg.pythonEnvMode !== nextCfg.pythonEnvMode ||
        cfg.pythonExecutable !== nextCfg.pythonExecutable;

      logger.info(`[mlx-audio] Applying configuration ${changed ? "update" : "reload"} (${reason})...`);

      // Avoid mixing two startup flows while ports/runtime are being reconfigured.
      if (ensureServerPromise) {
        await ensureServerPromise.catch(() => undefined);
      }

      health.stop();
      await proxy.stop().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[mlx-audio] Failed to stop proxy during config apply: ${msg}`);
      });
      await procMgr.stop().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[mlx-audio] Failed to stop server during config apply: ${msg}`);
      });

      cfg = nextCfg;
      configFingerprint = nextFingerprint;
      portBinding = resolvePortBinding(cfg);
      procMgr.updateConfig(cfg);
      procMgr.resetCrashCounter();
      if (runtimeChanged) {
        pythonRuntimePrepared = false;
      }

      startupStatus = new StartupStatusTracker(cfg.model, homeDir, logger);
      startupStatus.markIdle("configuration applied");
      health = createHealthChecker(cfg);
      proxy.updateConfig(cfg);

      if (serviceRunning) {
        await proxy.start();
        restartServerAfterApply = wasServerRunning;
      }

      logger.info(
        `[mlx-audio] Configuration applied (${reason}), tts=${portBinding.publicPort}, server=${portBinding.serverPort}, mode=${portBinding.mode}`,
      );
    });

    if (restartServerAfterApply) {
      await ensureServerReady();
    }

    return { changed, restartedServer: restartServerAfterApply };
  }

  async function ensurePythonRuntimeReady(): Promise<void> {
    if (pythonRuntimePrepared) return;

    if (cfg.pythonEnvMode === "external") {
      startupStatus.markPreparingPython("Validating external Python environment...");
      const pythonExecutable = cfg.pythonExecutable as string;
      await validateExternalPython(pythonExecutable, logger);
      if (!serviceRunning) {
        throw new Error("Plugin service stopped during startup");
      }
      procMgr.setPythonBin(pythonExecutable);
      pythonRuntimePrepared = true;
      return;
    }

    startupStatus.markPreparingPython("Preparing managed Python environment...");
    const managedRuntime = await venvMgr.ensure();
    if (!serviceRunning) {
      throw new Error("Plugin service stopped during startup");
    }
    procMgr.setManagedRuntime(managedRuntime.uvBin, managedRuntime.launchArgsPrefix);
    pythonRuntimePrepared = true;
  }

  async function ensureServerReady(): Promise<void> {
    if (!serviceRunning) {
      throw new Error("Plugin service is not running");
    }

    if (procMgr.isRunning()) {
      const snapshot = startupStatus.getSnapshot();
      if (snapshot.inProgress) {
        startupStatus.markWaitingHealth("Waiting for /v1/models health check...");
      }
      const healthy = await waitForServerHealthy(portBinding.serverPort);
      if (!healthy) {
        if (!snapshot.inProgress) {
          startupStatus.begin("Checking running server health...");
          startupStatus.markWaitingHealth("Waiting for /v1/models health check...");
        }
        throw createStartupTimeoutError();
      }
      health.start();
      startupStatus.markReady("Server is ready");
      return;
    }

    if (ensureServerPromise) {
      await ensureServerPromise;
      return;
    }

    ensureServerPromise = (async () => {
      let started = false;
      startupStatus.begin("Preparing server startup...");
      try {
        // Lazy setup Python runtime + dependencies on first actual server start.
        await ensurePythonRuntimeReady();
        if (!serviceRunning) {
          throw new Error("Plugin service stopped during startup");
        }
        startupStatus.markStartingServer("Starting mlx-audio server process...");
        await procMgr.start();
        started = true;
        if (!serviceRunning) {
          throw new Error("Plugin service stopped during startup");
        }
        startupStatus.markWaitingHealth("Waiting for /v1/models health check...");
        const healthy = await waitForServerHealthy(portBinding.serverPort);
        if (!healthy) {
          throw createStartupTimeoutError();
        }
        if (!serviceRunning) {
          throw new Error("Plugin service stopped during startup");
        }
        health.start();
        startupStatus.markReady("Server is ready");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (serviceRunning) {
          startupStatus.markError(message);
        } else {
          startupStatus.markIdle("service stopped during startup");
        }
        if (started) {
          await procMgr.stop().catch((stopErr) => {
            const stopMsg = stopErr instanceof Error ? stopErr.message : String(stopErr);
            logger.error(`[mlx-audio] Failed to stop server after startup error: ${stopMsg}`);
          });
        }
        throw err;
      }
    })();

    try {
      await ensureServerPromise;
    } finally {
      ensureServerPromise = null;
    }
  }

  const proxy = new TtsProxy(cfg, logger, ensureServerReady);

  function stopConfigRefreshLoop(): void {
    if (!configRefreshTimer) return;
    clearTimeout(configRefreshTimer);
    configRefreshTimer = null;
  }

  function scheduleConfigRefreshLoop(delayMs: number): void {
    configRefreshTimer = setTimeout(() => {
      configRefreshTimer = null;
      if (!serviceRunning) return;
      void applyConfig("background config poll")
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`[mlx-audio] Background config refresh failed: ${msg}`);
        })
        .finally(() => {
          if (serviceRunning) {
            scheduleConfigRefreshLoop(CONFIG_REFRESH_INTERVAL_MS);
          }
        });
    }, delayMs);
  }

  function startConfigRefreshLoop(): void {
    if (configRefreshTimer || !serviceRunning) return;
    scheduleConfigRefreshLoop(CONFIG_REFRESH_INTERVAL_MS);
  }

  async function generateAudioViaProxy(text: string, outputPath?: string): Promise<{ ok: true; path: string; bytes: number } | { ok: false; error: string; statusCode?: number }> {
    await applyConfig("generate request");
    try {
      await ensureServerReady();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Failed to start mlx-audio server: ${msg}` };
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: { ok: true; path: string; bytes: number } | { ok: false; error: string; statusCode?: number }): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const body = JSON.stringify({ ...buildInjectedParams(cfg, text), input: text });
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: portBinding.publicPort,
          path: "/v1/audio/speech",
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
          timeout: GENERATE_REQUEST_TIMEOUT_MS,
        },
        (res) => {
          if (res.statusCode !== 200) {
            const chunks: Buffer[] = [];
            let captured = 0;
            res.on("data", (chunk: Buffer) => {
              if (captured >= MAX_ERROR_DETAIL_BYTES) return;
              const remaining = MAX_ERROR_DETAIL_BYTES - captured;
              const clipped = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
              chunks.push(clipped);
              captured += clipped.length;
            });
            res.on("end", () => {
              const detail = Buffer.concat(chunks).toString("utf8").trim();
              finish({
                ok: false,
                error: `Server returned ${res.statusCode}${detail ? `: ${detail}` : ""}`,
                statusCode: res.statusCode,
              });
            });
            res.on("error", (err) => finish({ ok: false, error: err.message, statusCode: res.statusCode }));
            return;
          }

          void (async () => {
            const outputOptions = {
              tmpDir,
              systemTmpDir,
              outputDir,
              homeDir,
            };
            let targetPath = "";
            try {
              targetPath = await resolveSecureOutputPath(outputPath, outputOptions);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              res.resume();
              finish({ ok: false, error: `Failed to write audio file: ${msg}` });
              return;
            }

            let bytes = 0;
            const sizeGuard = new Transform({
              transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
                bytes += chunk.length;
                if (bytes > MAX_AUDIO_RESPONSE_BYTES) {
                  callback(new Error(`Audio payload exceeds ${MAX_AUDIO_RESPONSE_BYTES} bytes`));
                  return;
                }
                callback(null, chunk);
              },
            });
            const writer = fs.createWriteStream(targetPath, { flags: "w" });

            try {
              await pipeline(res, sizeGuard, writer);
              finish({ ok: true, path: targetPath, bytes });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              try {
                await fs.promises.unlink(targetPath);
              } catch {
                // ignore cleanup failures
              }
              finish({ ok: false, error: `Failed to write audio file: ${msg}` });
            }
          })();
        },
      );

      req.on("timeout", () => req.destroy(new Error("Request timed out")));
      req.on("error", (err) => finish({ ok: false, error: err.message }));
      req.write(body);
      req.end();
    });
  }

  // ── Service ──

  api.registerService({
    id: "mlx-audio",
    start: async () => {
      try {
        await applyConfig("service start");
        serviceRunning = true;
        await proxy.start();
        startConfigRefreshLoop();
        if (cfg.autoStart) {
          void ensureServerReady().catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`[mlx-audio] Background warmup failed: ${msg}`);
          });
        } else {
          logger.info("[mlx-audio] autoStart=false, server will start on first speech/models/generate/test request");
        }
        logger.info(`[mlx-audio] Plugin ready (model: ${cfg.model}, tts=${portBinding.publicPort}, server=${portBinding.serverPort})`);
      } catch (err) {
        serviceRunning = false;
        stopConfigRefreshLoop();
        throw err;
      }
    },
    stop: async () => {
      serviceRunning = false;
      stopConfigRefreshLoop();
      health.stop();
      await proxy.stop();
      await procMgr.stop();
      startupStatus.markIdle("service stopped");
      logger.info("[mlx-audio] Plugin stopped");
    },
  });

  // ── Tool ──

  api.registerTool({
    name: "mlx_audio_tts",
    description:
      "Generate speech audio locally using mlx-audio. Actions: generate (text→audio), status (server info), reload (apply latest config).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["generate", "status", "reload"],
          description: "Action to perform",
        },
        text: { type: "string", description: "Text to synthesize (for generate)" },
        outputPath: { type: "string", description: "Save audio to path under /tmp or ~/.openclaw/mlx-audio/outputs (for generate)" },
      },
      required: ["action"],
    },
    execute: async (_id: string, params: Record<string, unknown>) => {
      const action = params.action as string;

      if (action === "status") {
        await applyConfig("tool status");
        const status = procMgr.getStatus();
        const startup = startupStatus.getSnapshot();
        const result = {
          server: status,
          startup,
          config: {
            model: cfg.model,
            port: cfg.port,
            proxyPort: cfg.proxyPort,
            ttsPort: portBinding.publicPort,
            serverPort: portBinding.serverPort,
            portMode: portBinding.mode,
            langCode: cfg.langCode,
            pythonEnvMode: cfg.pythonEnvMode,
            pythonExecutable: cfg.pythonEnvMode === "external" ? cfg.pythonExecutable : undefined,
          },
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (action === "reload") {
        const result = await applyConfig("tool reload", { force: true });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              changed: result.changed,
              restartedServer: result.restartedServer,
              ttsPort: portBinding.publicPort,
              serverPort: portBinding.serverPort,
              portMode: portBinding.mode,
            }),
          }],
        };
      }

      if (action === "generate") {
        const text = params.text as string;
        if (!text) return { content: [{ type: "text", text: JSON.stringify({ error: "text is required for generate action" }) }] };
        const outputPath = params.outputPath as string | undefined;
        const result = await generateAudioViaProxy(text, outputPath);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
    },
  });

  // ── Commands ──

  api.registerCommand({
    name: "mlx-tts",
    description: "MLX Audio TTS: /mlx-tts status | /mlx-tts test <text> | /mlx-tts reload",
    acceptsArgs: true,
    handler: async (ctx) => {
      const args = (ctx.args ?? "").trim();
      const [subCmd, ...rest] = args.split(/\s+/);

      if (!subCmd || subCmd === "status") {
        await applyConfig("command status");
        const status = procMgr.getStatus();
        const startup = startupStatus.getSnapshot();
        const uptime = status.startedAt ? Math.round((Date.now() - status.startedAt) / 1000) : 0;
        return {
          text: [
            `MLX Audio TTS`,
            `Server: ${status.running ? "running" : "stopped"}${status.pid ? ` (PID ${status.pid})` : ""}`,
            `Startup: ${formatStartupStatusForDisplay(startup)}`,
            `Model: ${cfg.model}`,
            `Ports: tts=${portBinding.publicPort} server=${portBinding.serverPort} (${portBinding.mode})`,
            cfg.pythonEnvMode === "external"
              ? `Python: external (${cfg.pythonExecutable})`
              : "Python: managed (uv.lock, ~/.openclaw/mlx-audio/runtime/.venv)",
            `Uptime: ${uptime}s | Restarts: ${status.restarts}`,
            status.lastError ? `Last error: ${status.lastError}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }

      if (subCmd === "reload") {
        const result = await applyConfig("command reload", { force: true });
        return {
          text: [
            "Configuration reloaded",
            `Changed: ${result.changed ? "yes" : "no"}`,
            `Server restarted: ${result.restartedServer ? "yes" : "no"}`,
            `Ports: tts=${portBinding.publicPort} server=${portBinding.serverPort} (${portBinding.mode})`,
          ].join("\n"),
        };
      }

      if (subCmd === "test") {
        await applyConfig("command test");
        const text = rest.join(" ") || "Hello, this is a test of local text to speech.";
        const startedAt = Date.now();
        const result = await generateAudioViaProxy(text);
        if (!result.ok) {
          return { text: `Test failed: ${result.error}` };
        }
        const elapsed = Date.now() - startedAt;
        return { text: `Test succeeded in ${elapsed} ms\nFile: ${result.path}\nBytes: ${result.bytes}` };
      }

      return { text: `Unknown subcommand: ${subCmd}. Use: status, test, reload` };
    },
  });

  // ── Setup hint ──
  // On the first agent turn after startup, if TTS is not routed to this plugin,
  // inject a context hint so the agent can notify the user.

  if (api.on) {
    let setupHintEmitted = false;

    api.on("before_agent_start", () => {
      if (setupHintEmitted) return;
      if (!serviceRunning) return;

      const ttsBaseUrl = process.env.OPENAI_TTS_BASE_URL || "";
      const expectedPort = portBinding.publicPort;
      const isConfigured = ttsBaseUrl.includes(`:${expectedPort}/`);

      if (isConfigured) return;

      setupHintEmitted = true;
      return {
        prependContext:
          `[mlx-audio plugin] Local TTS plugin is installed and running on port ${expectedPort}, ` +
          `but OpenClaw TTS is not routed to it. ` +
          `Notify the user and offer to finish setup by applying this gateway config patch:\n` +
          `{\n` +
          `  "env": { "vars": { "OPENAI_TTS_BASE_URL": "http://127.0.0.1:${expectedPort}/v1" } },\n` +
          `  "messages": { "tts": { "provider": "openai", "openai": { "apiKey": "local" } } }\n` +
          `}\n` +
          `After patching, restart the gateway for changes to take effect.`,
      };
    });
  }
}
