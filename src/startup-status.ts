/** Tracks startup stages and approximate model download progress. */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const MB = 1024 * 1024;
const GB = 1024 * 1024 * 1024;
const PROGRESS_BAR_WIDTH = 20;
const PROGRESS_POLL_MS = 2000;

const MODEL_DOWNLOAD_ESTIMATES: Array<{ pattern: RegExp; bytes: number }> = [
  { pattern: /Kokoro-82M/i, bytes: Math.round(345 * MB) },
  { pattern: /0\.6B-Base/i, bytes: Math.round(2.3 * GB) },
  { pattern: /1\.7B-VoiceDesign/i, bytes: Math.round(4.2 * GB) },
];

export type StartupPhase = "idle" | "preparing_python" | "starting_server" | "waiting_health" | "ready" | "error";

export interface StartupStatusSnapshot {
  phase: StartupPhase;
  inProgress: boolean;
  message: string;
  startedAt: number | null;
  updatedAt: number;
  lastError: string | null;
  model: string;
  modelCachePath: string;
  modelCacheBytes: number | null;
  modelEstimatedBytes: number | null;
  modelProgressPercent: number | null;
  modelProgressBar: string | null;
  modelProgressApproximate: boolean;
}

export class StartupStatusTracker {
  private state: StartupStatusSnapshot;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private lastLoggedPercent: number | null = null;

  constructor(
    model: string,
    homeDir: string,
    private logger?: { info: (message: string) => void; warn: (message: string) => void },
  ) {
    const modelCachePath = join(homeDir, ".cache", "huggingface", "hub", `models--${model.replaceAll("/", "--")}`);
    const modelEstimatedBytes = estimateModelBytes(model);

    this.state = {
      phase: "idle",
      inProgress: false,
      message: "idle",
      startedAt: null,
      updatedAt: Date.now(),
      lastError: null,
      model,
      modelCachePath,
      modelCacheBytes: null,
      modelEstimatedBytes,
      modelProgressPercent: null,
      modelProgressBar: null,
      modelProgressApproximate: modelEstimatedBytes !== null,
    };
  }

  begin(message: string): void {
    this.state.phase = "preparing_python";
    this.state.inProgress = true;
    this.state.message = message;
    this.state.startedAt = Date.now();
    this.state.updatedAt = Date.now();
    this.state.lastError = null;
    this.state.modelCacheBytes = null;
    this.state.modelProgressPercent = null;
    this.state.modelProgressBar = null;
    this.lastLoggedPercent = null;
  }

  markPreparingPython(message: string): void {
    this.updatePhase("preparing_python", message, true);
  }

  markStartingServer(message: string): void {
    this.updatePhase("starting_server", message, true);
  }

  markWaitingHealth(message: string): void {
    this.updatePhase("waiting_health", message, true);
    this.startPolling();
  }

  markReady(message: string): void {
    this.updatePhase("ready", message, false);
    if (this.state.modelProgressPercent !== null) {
      this.state.modelProgressPercent = 100;
      this.state.modelProgressBar = buildProgressBar(100);
      this.state.updatedAt = Date.now();
    }
    this.stopPolling();
  }

  markError(message: string): void {
    this.updatePhase("error", message, false);
    this.state.lastError = message;
    this.stopPolling();
  }

  markIdle(message = "idle"): void {
    this.updatePhase("idle", message, false);
    this.stopPolling();
  }

  getSnapshot(): StartupStatusSnapshot {
    return { ...this.state };
  }

  private updatePhase(phase: StartupPhase, message: string, inProgress: boolean): void {
    this.state.phase = phase;
    this.state.message = message;
    this.state.inProgress = inProgress;
    this.state.updatedAt = Date.now();
    if (!inProgress) {
      this.state.startedAt = null;
    }
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.schedulePoll(0);
  }

  private schedulePoll(delayMs: number): void {
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollCacheSize().finally(() => {
        if (this.state.inProgress && this.state.phase === "waiting_health") {
          this.schedulePoll(PROGRESS_POLL_MS);
        }
      });
    }, delayMs);
  }

  private async pollCacheSize(): Promise<void> {
    if (this.polling) return;
    if (!(this.state.inProgress && this.state.phase === "waiting_health")) return;
    this.polling = true;
    try {
      const bytes = await getDirectorySizeBytes(this.state.modelCachePath);
      this.state.modelCacheBytes = bytes;

      if (this.state.modelEstimatedBytes !== null) {
        const rawPercent = Math.floor((bytes / this.state.modelEstimatedBytes) * 100);
        const boundedPercent = Math.max(0, Math.min(99, rawPercent));
        this.state.modelProgressPercent = boundedPercent;
        this.state.modelProgressBar = buildProgressBar(boundedPercent);

        if (this.lastLoggedPercent === null || boundedPercent >= this.lastLoggedPercent + 5) {
          this.logger?.info(
            `[mlx-audio] Startup progress (approx): ${this.state.modelProgressBar} ${boundedPercent}% ` +
            `(${formatBytes(bytes)} / ~${formatBytes(this.state.modelEstimatedBytes)})`,
          );
          this.lastLoggedPercent = boundedPercent;
        }
      }
      this.state.updatedAt = Date.now();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn(`[mlx-audio] Failed to scan model cache size: ${message}`);
    } finally {
      this.polling = false;
    }
  }

  private stopPolling(): void {
    if (!this.pollTimer) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}

function estimateModelBytes(model: string): number | null {
  for (const entry of MODEL_DOWNLOAD_ESTIMATES) {
    if (entry.pattern.test(model)) {
      return entry.bytes;
    }
  }
  return null;
}

async function getDirectorySizeBytes(root: string): Promise<number> {
  let total = 0;
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        const fileStat = await stat(fullPath);
        total += fileStat.size;
      } catch {
        // Skip files that vanish during scan.
      }
    }
  }

  return total;
}

function buildProgressBar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * PROGRESS_BAR_WIDTH);
  return `[${"#".repeat(filled)}${"-".repeat(PROGRESS_BAR_WIDTH - filled)}]`;
}

function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatStartupStatusForError(snapshot: StartupStatusSnapshot): string {
  const parts = [`phase=${snapshot.phase}`, snapshot.message];

  if (snapshot.modelProgressPercent !== null && snapshot.modelProgressBar) {
    const estimate = snapshot.modelEstimatedBytes !== null ? ` / ~${formatBytes(snapshot.modelEstimatedBytes)}` : "";
    const downloaded = snapshot.modelCacheBytes !== null ? formatBytes(snapshot.modelCacheBytes) : "0 B";
    parts.push(`model-cache=${snapshot.modelProgressBar} ${snapshot.modelProgressPercent}% (${downloaded}${estimate}, approximate)`);
  } else if (snapshot.modelCacheBytes !== null) {
    parts.push(`model-cache=${formatBytes(snapshot.modelCacheBytes)} downloaded`);
  }

  return parts.join("; ");
}

export function formatStartupStatusForDisplay(snapshot: StartupStatusSnapshot): string {
  if (!snapshot.inProgress && snapshot.phase === "ready") {
    return "ready";
  }
  if (!snapshot.inProgress && snapshot.phase === "idle") {
    return "idle";
  }

  const parts: string[] = [`${snapshot.phase}: ${snapshot.message}`];
  if (snapshot.modelProgressPercent !== null && snapshot.modelProgressBar) {
    const downloaded = snapshot.modelCacheBytes !== null ? formatBytes(snapshot.modelCacheBytes) : "0 B";
    if (snapshot.modelEstimatedBytes !== null) {
      parts.push(`${snapshot.modelProgressBar} ${snapshot.modelProgressPercent}% (~${downloaded} / ~${formatBytes(snapshot.modelEstimatedBytes)})`);
    } else {
      parts.push(`${snapshot.modelProgressBar} ${snapshot.modelProgressPercent}% (~${downloaded})`);
    }
  } else if (snapshot.modelCacheBytes !== null) {
    parts.push(`cache ~${formatBytes(snapshot.modelCacheBytes)}`);
  }

  return parts.join(" | ");
}
