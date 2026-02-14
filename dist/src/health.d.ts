/** Health check for mlx_audio.server. */
export declare class HealthChecker {
    private port;
    private intervalMs;
    private logger;
    private onUnhealthy;
    private timer;
    private consecutive_failures;
    constructor(port: number, intervalMs: number, logger: {
        info: (m: string) => void;
        warn: (m: string) => void;
    }, onUnhealthy: () => void);
    start(): void;
    stop(): void;
    check(): Promise<boolean>;
    private ping;
}
