/** MLX Audio plugin configuration. */

export interface MlxAudioConfig {
  port: number;
  proxyPort: number;
  model: string;
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
}

const DEFAULTS: MlxAudioConfig = {
  port: 19280,
  proxyPort: 19281,
  model: "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
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
};

export function resolveConfig(raw: Partial<MlxAudioConfig> | undefined): MlxAudioConfig {
  const cfg = { ...DEFAULTS, ...raw };
  const errors: string[] = [];

  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    errors.push("port must be an integer between 1 and 65535");
  }
  if (!Number.isInteger(cfg.proxyPort) || cfg.proxyPort < 1 || cfg.proxyPort > 65535) {
    errors.push("proxyPort must be an integer between 1 and 65535");
  }
  if (cfg.port === cfg.proxyPort) {
    errors.push("port and proxyPort must be different");
  }
  if (!(cfg.speed > 0)) {
    errors.push("speed must be > 0");
  }
  if (!(cfg.temperature >= 0)) {
    errors.push("temperature must be >= 0");
  }
  if (!(Number.isInteger(cfg.maxRestarts) && cfg.maxRestarts >= 0)) {
    errors.push("maxRestarts must be an integer >= 0");
  }
  if (!(Number.isInteger(cfg.healthCheckIntervalMs) && cfg.healthCheckIntervalMs >= 1000)) {
    errors.push("healthCheckIntervalMs must be an integer >= 1000");
  }

  if (errors.length > 0) {
    throw new Error(`[mlx-audio] Invalid configuration: ${errors.join("; ")}`);
  }

  return cfg;
}

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
