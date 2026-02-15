/**
 * MLX Audio plugin configuration.
 *
 * Single source of truth: openclaw.plugin.json → configSchema.
 * This file derives defaults from that schema at build time (via the
 * generated type) and provides runtime helpers.  If you add a new config
 * field, add it to openclaw.plugin.json FIRST, then mirror here.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------- schema-derived types & defaults --------------------------------

/** Load configSchema.properties from openclaw.plugin.json at import time. */
function loadSchemaDefaults(): Record<string, unknown> {
  // Works both from src/ (dev) and dist/ (built)
  const here = typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  // Walk up from dist/src/ or src/ to find openclaw.plugin.json at project root
  let dir = here;
  let manifestPath = resolve(dir, "openclaw.plugin.json");
  for (let i = 0; i < 5; i++) {
    try {
      readFileSync(manifestPath);
      break;
    } catch {
      dir = resolve(dir, "..");
      manifestPath = resolve(dir, "openclaw.plugin.json");
    }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const props: Record<string, { default?: unknown }> = manifest.configSchema?.properties ?? {};
  const defaults: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(props)) {
    if (schema.default !== undefined) defaults[key] = schema.default;
  }
  return defaults;
}

const SCHEMA_DEFAULTS = loadSchemaDefaults();

export type PythonEnvMode = "managed" | "external";

/**
 * Runtime config interface.
 * Keep in sync with openclaw.plugin.json → configSchema.properties.
 * CI: `npm run check-schema` will catch drift.
 */
export interface MlxAudioConfig {
  port: number;
  proxyPort?: number;
  model: string;
  pythonEnvMode: PythonEnvMode;
  pythonExecutable?: string;
  speed: number;
  langCode: string;
  refAudio?: string;
  refText?: string;
  instruct?: string;
  temperature: number;
  topP: number;
  topK: number;
  repetitionPenalty: number;
  autoStart: boolean;
  healthCheckIntervalMs: number;
  restartOnCrash: boolean;
  maxRestarts: number;
  workers: number;
}

export interface PortBinding {
  publicPort: number;
  serverPort: number;
  mode: "single-port" | "legacy-dual-port";
}

/** All required keys with their schema-declared defaults. */
const DEFAULTS: MlxAudioConfig = {
  port: 19280,
  model: "mlx-community/Kokoro-82M-bf16",
  pythonEnvMode: "managed",
  speed: 1.0,
  langCode: "a",
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  repetitionPenalty: 1.0,
  autoStart: true,
  healthCheckIntervalMs: 30000,
  restartOnCrash: true,
  maxRestarts: 3,
  workers: 1,
  // Override with any defaults found in the JSON schema (schema wins)
  ...SCHEMA_DEFAULTS,
} as MlxAudioConfig;

// ---------- resolve & validate ---------------------------------------------

export function resolveConfig(raw: Partial<MlxAudioConfig> | undefined): MlxAudioConfig {
  const cfg = { ...DEFAULTS, ...raw };
  const errors: string[] = [];

  if (typeof cfg.pythonExecutable === "string") {
    cfg.pythonExecutable = cfg.pythonExecutable.trim();
    if (cfg.pythonExecutable.length === 0) {
      cfg.pythonExecutable = undefined;
    }
  }

  if (!(typeof cfg.model === "string" && cfg.model.trim().length > 0)) {
    errors.push("model must be a non-empty string");
  }
  if (cfg.pythonEnvMode !== "managed" && cfg.pythonEnvMode !== "external") {
    errors.push("pythonEnvMode must be either 'managed' or 'external'");
  }
  if (cfg.pythonExecutable !== undefined && !(typeof cfg.pythonExecutable === "string" && cfg.pythonExecutable.length > 0)) {
    errors.push("pythonExecutable must be a non-empty string when provided");
  }
  if (cfg.pythonEnvMode === "external" && !cfg.pythonExecutable) {
    errors.push("pythonExecutable is required when pythonEnvMode is 'external'");
  }
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    errors.push("port must be an integer between 1 and 65535");
  }
  if (cfg.proxyPort !== undefined && (!Number.isInteger(cfg.proxyPort) || cfg.proxyPort < 1 || cfg.proxyPort > 65535)) {
    errors.push("proxyPort must be an integer between 1 and 65535 when provided");
  }
  if (cfg.proxyPort !== undefined && cfg.port === cfg.proxyPort) {
    errors.push("port and proxyPort must be different");
  }
  if (!(Number.isFinite(cfg.speed) && cfg.speed > 0)) {
    errors.push("speed must be > 0");
  }
  if (!(typeof cfg.langCode === "string" && cfg.langCode.trim().length > 0)) {
    errors.push("langCode must be a non-empty string");
  }
  if (!(Number.isFinite(cfg.temperature) && cfg.temperature >= 0)) {
    errors.push("temperature must be >= 0");
  }
  if (!(Number.isFinite(cfg.topP) && cfg.topP > 0 && cfg.topP <= 1)) {
    errors.push("topP must be > 0 and <= 1");
  }
  if (!(Number.isInteger(cfg.topK) && cfg.topK > 0)) {
    errors.push("topK must be an integer > 0");
  }
  if (!(Number.isFinite(cfg.repetitionPenalty) && cfg.repetitionPenalty > 0)) {
    errors.push("repetitionPenalty must be > 0");
  }
  if (!(Number.isInteger(cfg.maxRestarts) && cfg.maxRestarts >= 0)) {
    errors.push("maxRestarts must be an integer >= 0");
  }
  if (!(Number.isInteger(cfg.healthCheckIntervalMs) && cfg.healthCheckIntervalMs >= 1000)) {
    errors.push("healthCheckIntervalMs must be an integer >= 1000");
  }
  if (!(Number.isInteger(cfg.workers) && cfg.workers >= 1)) {
    errors.push("workers must be an integer >= 1");
  }

  if (errors.length > 0) {
    throw new Error(`[mlx-audio] Invalid configuration: ${errors.join("; ")}`);
  }

  return cfg;
}

export function resolvePortBinding(cfg: MlxAudioConfig): PortBinding {
  if (typeof cfg.proxyPort === "number") {
    return {
      publicPort: cfg.proxyPort,
      serverPort: cfg.port,
      mode: "legacy-dual-port",
    };
  }

  const publicPort = cfg.port;
  const serverPort = publicPort < 65535 ? publicPort + 1 : publicPort - 1;
  if (serverPort < 1 || serverPort > 65535 || serverPort === publicPort) {
    throw new Error(`[mlx-audio] Unable to derive internal server port from port=${publicPort}`);
  }

  return {
    publicPort,
    serverPort,
    mode: "single-port",
  };
}

// ---------- upstream params builder ----------------------------------------

/** Build the extra body fields to inject into the upstream request. */
export function buildInjectedParams(cfg: MlxAudioConfig): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model: cfg.model,
    speed: cfg.speed,
    lang_code: cfg.langCode,
    temperature: cfg.temperature,
    top_p: cfg.topP,
    top_k: cfg.topK,
    repetition_penalty: cfg.repetitionPenalty,
    response_format: "mp3",
  };
  if (cfg.refAudio) params.ref_audio = cfg.refAudio;
  if (cfg.refText) params.ref_text = cfg.refText;
  if (cfg.instruct) params.instruct = cfg.instruct;
  return params;
}
