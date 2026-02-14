/** Manages the mlx_audio.server Python subprocess. */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
export class ProcessManager extends EventEmitter {
    cfg;
    logger;
    proc = null;
    restarts = 0;
    lastError = null;
    startedAt = null;
    stopping = false;
    pythonBin = "python3";
    constructor(cfg, logger) {
        super();
        this.cfg = cfg;
        this.logger = logger;
    }
    /** Set the python binary path (from VenvManager). */
    setPythonBin(bin) {
        this.pythonBin = bin;
    }
    async start() {
        if (this.proc) {
            this.logger.warn("[mlx-audio] Server already running");
            return;
        }
        this.stopping = false;
        const ok = this.spawn();
        if (!ok) {
            throw new Error(this.lastError ? `[mlx-audio] Failed to start server: ${this.lastError}` : "[mlx-audio] Failed to start server");
        }
    }
    async stop() {
        this.stopping = true;
        if (!this.proc)
            return;
        this.logger.info("[mlx-audio] Stopping server...");
        this.proc.kill("SIGTERM");
        // Give it 5s, then SIGKILL
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (this.proc)
                    this.proc.kill("SIGKILL");
                resolve();
            }, 5000);
            if (this.proc) {
                this.proc.once("exit", () => {
                    clearTimeout(timer);
                    resolve();
                });
            }
            else {
                clearTimeout(timer);
                resolve();
            }
        });
        this.proc = null;
        this.startedAt = null;
    }
    async restart() {
        await this.stop();
        await this.start();
    }
    isRunning() {
        return this.proc !== null && !this.proc.killed;
    }
    getStatus() {
        return {
            running: this.isRunning(),
            pid: this.proc?.pid ?? null,
            restarts: this.restarts,
            lastError: this.lastError,
            startedAt: this.startedAt,
        };
    }
    spawn() {
        const args = ["-m", "mlx_audio.server", "--port", String(this.cfg.port)];
        this.logger.info(`[mlx-audio] Starting: ${this.pythonBin} ${args.join(" ")}`);
        try {
            this.proc = spawn(this.pythonBin, args, {
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env },
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.lastError = msg;
            this.logger.error(`[mlx-audio] Failed to spawn: ${msg}`);
            return false;
        }
        this.startedAt = Date.now();
        this.lastError = null;
        this.proc.stdout?.on("data", (chunk) => {
            const line = chunk.toString().trim();
            if (line)
                this.logger.info(`[mlx-audio/server] ${line}`);
        });
        this.proc.stderr?.on("data", (chunk) => {
            const line = chunk.toString().trim();
            if (line)
                this.logger.warn(`[mlx-audio/server] ${line}`);
        });
        this.proc.on("error", (err) => {
            this.lastError = err.message;
            this.logger.error(`[mlx-audio] Process error: ${err.message}`);
        });
        this.proc.on("exit", (code, signal) => {
            this.logger.warn(`[mlx-audio] Server exited (code=${code}, signal=${signal})`);
            this.proc = null;
            this.startedAt = null;
            if (!this.stopping && this.cfg.restartOnCrash && this.restarts < this.cfg.maxRestarts) {
                this.restarts++;
                this.logger.info(`[mlx-audio] Restarting (attempt ${this.restarts}/${this.cfg.maxRestarts})...`);
                setTimeout(() => this.spawn(), 2000);
            }
            else if (!this.stopping) {
                this.lastError = `Server crashed ${this.restarts} times, not restarting`;
                this.logger.error(`[mlx-audio] ${this.lastError}`);
                this.emit("max-restarts");
            }
        });
        return true;
    }
}
