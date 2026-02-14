/** Lightweight HTTP proxy that injects TTS preset params. */
import type { MlxAudioConfig } from "./config.js";
export declare class TtsProxy {
    private cfg;
    private logger;
    private server;
    constructor(cfg: MlxAudioConfig, logger: {
        info: (m: string) => void;
        error: (m: string) => void;
    });
    start(): Promise<void>;
    stop(): Promise<void>;
    private handleRequest;
    private forwardToUpstream;
    private proxyRaw;
}
