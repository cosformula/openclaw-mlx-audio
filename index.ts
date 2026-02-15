/**
 * mlx-audio — OpenClaw local TTS plugin
 *
 * Provides local text-to-speech via mlx-audio on Apple Silicon Macs.
 * Zero API key, zero cloud dependency.
 */

import { resolveConfig, type MlxAudioConfig } from "./src/config.js";
import { ProcessManager } from "./src/process-manager.js";
import { TtsProxy } from "./src/proxy.js";
import { HealthChecker } from "./src/health.js";
import { VenvManager } from "./src/venv-manager.js";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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
}

const STARTUP_HEALTH_MAX_ATTEMPTS = 20;
const STARTUP_HEALTH_INTERVAL_MS = 500;
const DEFAULT_PLUGIN_ID = "openclaw-mlx-audio";

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

export default function register(api: PluginApi) {
  const rawConfig = readRawConfig(api, PLUGIN_ID);
  const cfg = resolveConfig(rawConfig);
  const logger = api.logger;

  // Data dir for venv and models — ~/.openclaw/mlx-audio/
  const dataDir = path.join(os.homedir(), ".openclaw", "mlx-audio");
  const venvMgr = new VenvManager(dataDir, logger);

  const procMgr = new ProcessManager(cfg, logger);
  const proxy = new TtsProxy(cfg, logger);
  const health = new HealthChecker(cfg.port, cfg.healthCheckIntervalMs, logger, () => {
    if (cfg.restartOnCrash && procMgr.isRunning()) {
      logger.warn("[mlx-audio] Server unhealthy, restarting...");
      procMgr.restart().catch((err) => logger.error(`[mlx-audio] Restart failed: ${err}`));
    }
  });

  // ── Service ──

  api.registerService({
    id: "mlx-audio",
    start: async () => {
      // Auto-setup Python venv + dependencies on first run
      const pythonBin = await venvMgr.ensure();
      procMgr.setPythonBin(pythonBin);

      if (cfg.autoStart) {
        await procMgr.start();
        const healthy = await waitForServerHealthy(cfg.port);
        if (!healthy) {
          logger.warn("[mlx-audio] Server not healthy after startup, continuing anyway...");
        }
      }
      await proxy.start();
      if (cfg.autoStart) {
        health.start();
      }
      logger.info(`[mlx-audio] Plugin ready (model: ${cfg.model}, proxy: ${cfg.proxyPort})`);
    },
    stop: async () => {
      health.stop();
      await proxy.stop();
      await procMgr.stop();
      logger.info("[mlx-audio] Plugin stopped");
    },
  });

  // ── Tool ──

  api.registerTool({
    name: "mlx_audio_tts",
    description:
      "Generate speech audio locally using mlx-audio. Actions: generate (text→audio), status (server info).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["generate", "status"],
          description: "Action to perform",
        },
        text: { type: "string", description: "Text to synthesize (for generate)" },
        outputPath: { type: "string", description: "Save audio to file path (for generate)" },
      },
      required: ["action"],
    },
    execute: async (_id: string, params: Record<string, unknown>) => {
      const action = params.action as string;

      if (action === "status") {
        const status = procMgr.getStatus();
        const result = {
          server: status,
          config: {
            model: cfg.model,
            port: cfg.port,
            proxyPort: cfg.proxyPort,
            langCode: cfg.langCode,
          },
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (action === "generate") {
        const text = params.text as string;
        if (!text) return { content: [{ type: "text", text: JSON.stringify({ error: "text is required for generate action" }) }] };

        // Make request through proxy
        return new Promise((resolve) => {
          const body = JSON.stringify({ model: cfg.model, input: text, voice: "default" });
          const req = http.request(
            {
              hostname: "127.0.0.1",
              port: cfg.proxyPort,
              path: "/v1/audio/speech",
              method: "POST",
              headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
              timeout: 120000,
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (c) => chunks.push(c));
              res.on("end", () => {
                const audio = Buffer.concat(chunks);
                if (res.statusCode !== 200) {
                  resolve({ content: [{ type: "text", text: JSON.stringify({ error: `Server returned ${res.statusCode}`, body: audio.toString() }) }] });
                  return;
                }
                const outputPath = params.outputPath as string | undefined;
                const outFile = outputPath || `/tmp/mlx-audio-${Date.now()}.mp3`;
                fs.writeFileSync(outFile, audio);
                resolve({ content: [{ type: "text", text: JSON.stringify({ ok: true, path: outFile, bytes: audio.length }) }] });
              });
            },
          );
          req.on("timeout", () => req.destroy(new Error("Request timed out")));
          req.on("error", (err) => resolve({ content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] }));
          req.write(body);
          req.end();
        });
      }

      return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
    },
  });

  // ── Commands ──

  api.registerCommand({
    name: "mlx-tts",
    description: "MLX Audio TTS: /mlx-tts status | /mlx-tts test <text>",
    acceptsArgs: true,
    handler: async (ctx) => {
      const args = (ctx.args ?? "").trim();
      const [subCmd, ...rest] = args.split(/\s+/);

      if (!subCmd || subCmd === "status") {
        const status = procMgr.getStatus();
        const uptime = status.startedAt ? Math.round((Date.now() - status.startedAt) / 1000) : 0;
        return {
          text: [
            `MLX Audio TTS`,
            `Server: ${status.running ? "running" : "stopped"}${status.pid ? ` (PID ${status.pid})` : ""}`,
            `Model: ${cfg.model}`,
            `Ports: server=${cfg.port} proxy=${cfg.proxyPort}`,
            `Uptime: ${uptime}s | Restarts: ${status.restarts}`,
            status.lastError ? `Last error: ${status.lastError}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }

      if (subCmd === "test") {
        const text = rest.join(" ") || "Hello, this is a test of local text to speech.";
        return { text: `Generating audio for: "${text}"...\nUse the mlx_audio_tts tool with action=generate to produce audio.` };
      }

      return { text: `Unknown subcommand: ${subCmd}. Use: status, test` };
    },
  });
}
