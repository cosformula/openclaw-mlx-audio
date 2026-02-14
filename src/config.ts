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
  model: "mlx-community/Kokoro-82M-bf16",
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
  return { ...DEFAULTS, ...raw };
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
