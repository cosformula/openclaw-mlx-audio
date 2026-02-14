/** Manages the mlx_audio.server Python subprocess. */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { freemem, totalmem } from "node:os";
import type { MlxAudioConfig } from "./config.js";

/** Rough memory estimates (MB) for model loading. Conservative. */
const MODEL_MEMORY_ESTIMATES: Record<string, number> = {
  "Kokoro-82M": 400,
  "0.6B": 1400,
  "1.7B": 3800,
};

/** Minimum free memory headroom (MB) to keep for the system. */
const MEMORY_HEADROOM_MB = 300;

export interface ProcessStatus {
  running: boolean;
  pid: number | null;
  restarts: number;
  lastError: string | null;
  startedAt: number | null;
}

/** Minimum uptime (ms) to consider a process "healthy" — resets crash counter. */
const HEALTHY_UPTIME_MS = 30_000;

/** Delay before restart attempt (ms). */
const RESTART_DELAY_MS = 3_000;

export class ProcessManager extends EventEmitter {
  private proc: ChildProcess | null = null;
  private restarts = 0;
  private lastError: string | null = null;
  private startedAt: number | null = null;
  private stopping = false;
  private pythonBin: string = "python3";
  private stderrBuffer: string[] = [];

  constructor(
    private cfg: MlxAudioConfig,
    private logger: { info: (m: string) => void; error: (m: string) => void; warn: (m: string) => void },
  ) {
    super();
  }

  /** Set the python binary path (from VenvManager). */
  setPythonBin(bin: string): void {
    this.pythonBin = bin;
  }

  /** Reset crash counter — call on config change or manual restart. */
  resetCrashCounter(): void {
    this.restarts = 0;
    this.lastError = null;
    this.logger.info("[mlx-audio] Crash counter reset");
  }

  /** Update config and reset crash counter (for hot-reload). */
  updateConfig(cfg: MlxAudioConfig): void {
    this.cfg = cfg;
    this.resetCrashCounter();
  }

  async start(): Promise<void> {
    if (this.proc) {
      this.logger.warn("[mlx-audio] Server already running");
      return;
    }
    this.stopping = false;
    // Pre-flight memory check
    this.checkMemory();
    // Ensure port is free before starting
    await this.killPortHolder();
    const ok = this.spawn();
    if (!ok) {
      throw new Error(this.lastError ? `[mlx-audio] Failed to start server: ${this.lastError}` : "[mlx-audio] Failed to start server");
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (!this.proc) return;
    this.logger.info("[mlx-audio] Stopping server...");
    this.proc.kill("SIGTERM");
    // Give it 5s, then SIGKILL
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.proc) this.proc.kill("SIGKILL");
        resolve();
      }, 5000);
      if (this.proc) {
        this.proc.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      } else {
        clearTimeout(timer);
        resolve();
      }
    });
    this.proc = null;
    this.startedAt = null;
  }

  async restart(): Promise<void> {
    await this.stop();
    this.resetCrashCounter();
    await this.start();
  }

  isRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  getStatus(): ProcessStatus {
    return {
      running: this.isRunning(),
      pid: this.proc?.pid ?? null,
      restarts: this.restarts,
      lastError: this.lastError,
      startedAt: this.startedAt,
    };
  }

  // ---- private ----

  /**
   * Estimate model memory needs and warn if system is likely too low.
   * Does NOT block startup — just logs a warning so the user knows.
   */
  private checkMemory(): void {
    const freeMB = Math.round(freemem() / 1024 / 1024);
    const totalMB = Math.round(totalmem() / 1024 / 1024);
    const model = this.cfg.model;

    // Find matching estimate
    let estimateMB = 800; // fallback for unknown models
    for (const [pattern, mb] of Object.entries(MODEL_MEMORY_ESTIMATES)) {
      if (model.includes(pattern)) {
        estimateMB = mb;
        break;
      }
    }

    const needed = estimateMB + MEMORY_HEADROOM_MB;
    this.logger.info(`[mlx-audio] Memory check: ${freeMB} MB free / ${totalMB} MB total, model needs ~${estimateMB} MB`);

    if (freeMB < needed) {
      this.logger.warn(
        `[mlx-audio] ⚠️ Low memory: only ${freeMB} MB free, model "${model}" needs ~${estimateMB} MB + ${MEMORY_HEADROOM_MB} MB headroom. ` +
        `Server may be killed by the OS (SIGKILL/OOM). Consider a smaller model or freeing memory.`,
      );
    }
  }

  /**
   * Kill any process holding the configured port.
   * Prevents "Address already in use" from zombie processes.
   */
  private async killPortHolder(): Promise<void> {
    try {
      const result = execSync(
        `/usr/sbin/lsof -nP -iTCP:${this.cfg.port} -sTCP:LISTEN -t 2>/dev/null || true`,
        { encoding: "utf-8", timeout: 5000 },
      ).trim();
      if (!result) return;
      const pids = result.split("\n").map((p) => p.trim()).filter(Boolean);
      if (pids.length > 0) {
        this.logger.warn(`[mlx-audio] Killing stale process(es) on port ${this.cfg.port}: ${pids.join(", ")}`);
        for (const pid of pids) {
          try { process.kill(Number(pid), "SIGKILL"); } catch { /* already gone */ }
        }
        // Brief pause for port to be released
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch {
      // lsof not available or other issue — proceed anyway
    }
  }

  private spawn(): boolean {
    const args = ["-m", "mlx_audio.server", "--port", String(this.cfg.port), "--workers", String(this.cfg.workers)];
    this.logger.info(`[mlx-audio] Starting: ${this.pythonBin} ${args.join(" ")}`);

    try {
      this.proc = spawn(this.pythonBin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.logger.error(`[mlx-audio] Failed to spawn: ${msg}`);
      return false;
    }

    this.startedAt = Date.now();
    this.lastError = null;
    this.stderrBuffer = [];

    this.proc.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) this.logger.info(`[mlx-audio/server] ${line}`);
    });

    this.proc.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        this.logger.warn(`[mlx-audio/server] ${line}`);
        // Keep last N lines for crash diagnostics
        this.stderrBuffer.push(line);
        if (this.stderrBuffer.length > 20) this.stderrBuffer.shift();
      }
    });

    this.proc.on("error", (err) => {
      this.lastError = err.message;
      this.logger.error(`[mlx-audio] Process error: ${err.message}`);
    });

    this.proc.on("exit", (code, signal) => {
      const uptime = this.startedAt ? Date.now() - this.startedAt : 0;
      this.logger.warn(`[mlx-audio] Server exited (code=${code}, signal=${signal}, uptime=${Math.round(uptime / 1000)}s)`);

      // Detect likely OOM kill
      if (signal === "SIGKILL" && !this.stopping) {
        const freeMB = Math.round(freemem() / 1024 / 1024);
        this.logger.error(
          `[mlx-audio] ⚠️ Server was killed by SIGKILL (likely out-of-memory). ` +
          `Current free memory: ${freeMB} MB. ` +
          `Try a smaller model (e.g. Kokoro-82M-bf16) or free up memory by closing other apps.`,
        );
      }

      // Log stderr context for crash diagnosis
      if (this.stderrBuffer.length > 0) {
        const relevant = this.stderrBuffer.filter(
          (l) => l.includes("Error") || l.includes("error") || l.includes("Errno") || l.includes("ModuleNotFoundError"),
        );
        if (relevant.length > 0) {
          this.logger.error(`[mlx-audio] Last errors:\n  ${relevant.slice(-5).join("\n  ")}`);
        }
      }

      this.proc = null;
      this.startedAt = null;

      if (this.stopping) return;

      // If process ran long enough, it was healthy — reset counter
      if (uptime >= HEALTHY_UPTIME_MS) {
        this.logger.info(`[mlx-audio] Process was healthy (${Math.round(uptime / 1000)}s uptime), resetting crash counter`);
        this.restarts = 0;
      }

      if (this.cfg.restartOnCrash && this.restarts < this.cfg.maxRestarts) {
        this.restarts++;
        this.logger.info(`[mlx-audio] Restarting (attempt ${this.restarts}/${this.cfg.maxRestarts})...`);
        setTimeout(() => this.spawn(), RESTART_DELAY_MS);
      } else if (!this.stopping) {
        this.lastError = `Server crashed ${this.restarts} times, not restarting. Check logs above for errors.`;
        this.logger.error(`[mlx-audio] ${this.lastError}`);
        this.emit("max-restarts");
      }
    });
    return true;
  }
}
