/** Manages the mlx_audio.server Python subprocess. */
import { EventEmitter } from "node:events";
import type { MlxAudioConfig } from "./config.js";
export interface ProcessStatus {
    running: boolean;
    pid: number | null;
    restarts: number;
    lastError: string | null;
    startedAt: number | null;
}
export declare class ProcessManager extends EventEmitter {
    private cfg;
    private logger;
    private proc;
    private restarts;
    private lastError;
    private startedAt;
    private stopping;
    private pythonBin;
    constructor(cfg: MlxAudioConfig, logger: {
        info: (m: string) => void;
        error: (m: string) => void;
        warn: (m: string) => void;
    });
    /** Set the python binary path (from VenvManager). */
    setPythonBin(bin: string): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    restart(): Promise<void>;
    isRunning(): boolean;
    getStatus(): ProcessStatus;
    private spawn;
}
