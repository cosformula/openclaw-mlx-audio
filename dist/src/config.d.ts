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
export declare function resolveConfig(raw: Partial<MlxAudioConfig> | undefined): MlxAudioConfig;
/** Build the extra body fields to inject into the upstream request. */
export declare function buildInjectedParams(cfg: MlxAudioConfig): Record<string, unknown>;
