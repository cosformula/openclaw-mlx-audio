/** Manages the mlx_audio.server Python subprocess. */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { freemem, totalmem } from "node:os";
import type { MlxAudioConfig } from "./config.js";
import { runCommand } from "./run-command.js";

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
  private launchArgsPrefix: string[] = [];
  private stderrBuffer: string[] = [];
  private restartBudgetExhausted = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor(
    private cfg: MlxAudioConfig,
    private logger: { info: (m: string) => void; error: (m: string) => void; warn: (m: string) => void },
  ) {
    super();
  }

  /** Set the python binary path (from VenvManager). */
  setPythonBin(bin: string): void {
    this.pythonBin = bin;
    this.launchArgsPrefix = [];
  }

  /** Configure managed mode to launch through uv run. */
  setManagedRuntime(uvBin: string, launchArgsPrefix: string[]): void {
    this.pythonBin = uvBin;
    this.launchArgsPrefix = [...launchArgsPrefix];
  }

  /** Reset crash counter — call on config change or manual restart. */
  resetCrashCounter(): void {
    this.restarts = 0;
    this.lastError = null;
    this.restartBudgetExhausted = false;
    this.logger.info("[mlx-audio] Crash counter reset");
  }

  async start(): Promise<void> {
    await this.runLifecycleTask(() => this.startInternal());
  }

  async stop(): Promise<void> {
    await this.runLifecycleTask(() => this.stopInternal());
  }

  async restart(options?: { resetCrashCounter?: boolean; reason?: string }): Promise<void> {
    await this.runLifecycleTask(async () => {
      const resetCounter = options?.resetCrashCounter ?? true;
      const reason = options?.reason ?? "manual restart";
      this.clearRestartTimer();

      if (!resetCounter) {
        if (!this.consumeRestartBudget(reason)) {
          return;
        }
        await this.stopInternal();
        await this.startInternal();
        return;
      }

      await this.stopInternal();
      this.resetCrashCounter();
      await this.startInternal();
    });
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
      const { stdout } = await this.runCommand(
        "/usr/sbin/lsof",
        ["-nP", `-iTCP:${this.cfg.port}`, "-sTCP:LISTEN", "-t"],
        { timeoutMs: 5000, allowExitCodes: [1] },
      );
      const result = stdout.trim();
      if (!result) return;
      const pids = result.split("\n").map((p) => p.trim()).filter(Boolean);
      if (pids.length === 0) return;

      const stalePids: number[] = [];
      const foreignOwners: string[] = [];

      for (const pidText of pids) {
        const pid = Number(pidText);
        if (!Number.isInteger(pid) || pid <= 0) continue;
        const command = await this.getProcessCommand(pid);
        if (this.isMlxAudioProcess(command)) {
          stalePids.push(pid);
        } else {
          foreignOwners.push(`${pid}${command ? ` (${command})` : ""}`);
        }
      }

      if (foreignOwners.length > 0) {
        throw new Error(
          `[mlx-audio] Port ${this.cfg.port} is in use by non-mlx process(es): ${foreignOwners.join(", ")}. ` +
          "Choose a different port or stop that process manually.",
        );
      }

      if (stalePids.length > 0) {
        this.logger.warn(`[mlx-audio] Stopping stale mlx-audio process(es) on port ${this.cfg.port}: ${stalePids.join(", ")}`);
        for (const pid of stalePids) {
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            // already gone
          }
        }

        // Give graceful shutdown a chance before force-kill.
        await new Promise((r) => setTimeout(r, 1000));
        const stillAlive = stalePids.filter((pid) => this.isProcessAlive(pid));
        if (stillAlive.length > 0) {
          this.logger.warn(`[mlx-audio] Force killing unresponsive process(es): ${stillAlive.join(", ")}`);
          for (const pid of stillAlive) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              // already gone
            }
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith(`[mlx-audio] Port ${this.cfg.port} is in use by non-mlx process(es):`)) {
        throw err;
      }
      this.logger.warn(
        `[mlx-audio] Could not inspect existing port owner for ${this.cfg.port}. ` +
        "If startup fails with address-in-use, stop the conflicting process manually.",
      );
    }
  }

  private async getProcessCommand(pid: number): Promise<string> {
    try {
      const { stdout } = await this.runCommand(
        "ps",
        ["-p", String(pid), "-o", "command="],
        { timeoutMs: 5000, allowExitCodes: [1] },
      );
      return stdout.trim();
    } catch {
      return "";
    }
  }

  private isMlxAudioProcess(command: string): boolean {
    const lower = command.toLowerCase();
    return lower.includes("mlx_audio.server");
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private runCommand = runCommand;

  private spawn(): boolean {
    if (this.proc) {
      this.logger.warn("[mlx-audio] spawn() skipped: server already running");
      return false;
    }
    this.clearRestartTimer();
    // Use a writable directory for cwd and logs (mlx_audio.server creates a logs/ dir)
    const { dataDir, logDir } = this.ensureRuntimeDirs();
    const serverArgs = ["-m", "mlx_audio.server", "--port", String(this.cfg.port), "--workers", String(this.cfg.workers), "--log-dir", logDir];
    const args = [...this.launchArgsPrefix, ...serverArgs];
    this.logger.info(`[mlx-audio] Starting: ${this.pythonBin} ${args.join(" ")}`);

    let proc: ChildProcess;
    try {
      proc = spawn(this.pythonBin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        cwd: dataDir,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.logger.error(`[mlx-audio] Failed to spawn: ${msg}`);
      return false;
    }
    this.proc = proc;

    this.startedAt = Date.now();
    this.lastError = null;
    this.stderrBuffer = [];

    proc.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) this.logger.info(`[mlx-audio/server] ${line}`);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) {
        this.logger.warn(`[mlx-audio/server] ${line}`);
        // Keep last N lines for crash diagnostics
        this.stderrBuffer.push(line);
        if (this.stderrBuffer.length > 20) this.stderrBuffer.shift();
      }
    });

    proc.on("error", (err) => {
      if (this.proc !== proc) return;
      this.lastError = err.message;
      this.logger.error(`[mlx-audio] Process error: ${err.message}`);
    });

    proc.on("exit", (code, signal) => {
      if (this.proc !== proc) {
        this.logger.warn(`[mlx-audio] Ignoring exit from stale process pid=${proc.pid ?? "unknown"}`);
        return;
      }
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
        this.restartBudgetExhausted = false;
        this.lastError = null;
      }

      if (this.cfg.restartOnCrash) {
        if (this.consumeRestartBudget("after crash")) {
          this.scheduleRestart();
        }
      } else if (!this.stopping) {
        this.lastError = "Server exited and restartOnCrash is disabled.";
        this.logger.error(`[mlx-audio] ${this.lastError}`);
      }
    });
    return true;
  }

  private async runLifecycleTask(task: () => Promise<void>): Promise<void> {
    const previous = this.lifecycleQueue;
    let release: () => void = () => {};
    this.lifecycleQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      await task();
    } finally {
      release();
    }
  }

  private async startInternal(): Promise<void> {
    this.clearRestartTimer();
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

  private async stopInternal(): Promise<void> {
    this.stopping = true;
    this.clearRestartTimer();
    if (!this.proc) return;
    const proc = this.proc;
    this.logger.info("[mlx-audio] Stopping server...");
    // Give it 5s, then SIGKILL
    await new Promise<void>((resolve) => {
      let settled = false;
      const finalize = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      proc.once("exit", () => {
        finalize();
      });
      const timer = setTimeout(() => {
        if (this.proc === proc) {
          proc.kill("SIGKILL");
        }
        finalize();
      }, 5000);

      proc.kill("SIGTERM");
    });
    if (this.proc === proc) {
      this.proc = null;
      this.startedAt = null;
    }
  }

  private ensureRuntimeDirs(): { dataDir: string; logDir: string } {
    const dataDir = resolve(process.env.HOME ?? "/tmp", ".openclaw", "mlx-audio");
    const logDir = resolve(dataDir, "logs");
    mkdirSync(logDir, { recursive: true });
    return { dataDir, logDir };
  }

  private scheduleRestart(): void {
    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.stopping || this.proc) {
        return;
      }
      this.start().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.lastError = msg;
        this.logger.error(`[mlx-audio] Delayed restart failed: ${msg}`);
      });
    }, RESTART_DELAY_MS);
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private consumeRestartBudget(reason: string): boolean {
    if (this.restartBudgetExhausted) {
      return false;
    }
    if (this.restarts >= this.cfg.maxRestarts) {
      this.restartBudgetExhausted = true;
      this.lastError = `Restart limit reached (${this.cfg.maxRestarts}). Last trigger: ${reason}.`;
      this.logger.error(`[mlx-audio] ${this.lastError}`);
      this.emit("max-restarts");
      return false;
    }
    this.restarts++;
    this.logger.info(`[mlx-audio] Restarting (${reason}, attempt ${this.restarts}/${this.cfg.maxRestarts})...`);
    return true;
  }
}
