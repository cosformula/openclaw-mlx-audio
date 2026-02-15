import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_MAX_CAPTURED_OUTPUT_CHARS = 16_384;

export interface RunCommandOptions {
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  allowExitCodes?: number[];
  maxCapturedOutputChars?: number;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

export function runCommand(cmd: string, args: string[], options: RunCommandOptions): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    const maxCapturedChars = options.maxCapturedOutputChars ?? DEFAULT_MAX_CAPTURED_OUTPUT_CHARS;
    const allowedExitCodes = new Set(options.allowExitCodes ?? []);

    const appendWithLimit = (current: string, chunk: string): string => {
      const next = current + chunk;
      if (next.length <= maxCapturedChars) {
        return next;
      }
      return next.slice(next.length - maxCapturedChars);
    };

    const cleanup = (): void => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    const finalizeReject = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const finalizeResolve = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
        signal,
      });
    };

    let proc: ChildProcess;
    try {
      proc = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: options.env,
        cwd: options.cwd,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      finalizeReject(msg);
      return;
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendWithLimit(stdout, chunk.toString());
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendWithLimit(stderr, chunk.toString());
    });

    proc.on("error", (err) => {
      finalizeReject(err.message);
    });

    proc.on("close", (code, signal) => {
      if (timedOut) {
        const details = (stderr || stdout).trim();
        finalizeReject(`Timed out after ${options.timeoutMs}ms${details ? `\n${details}` : ""}`);
        return;
      }

      if (code === 0 || (typeof code === "number" && allowedExitCodes.has(code))) {
        finalizeResolve(code, signal);
        return;
      }

      const details = (stderr || stdout).trim();
      finalizeReject(
        `Command failed (${cmd} ${args.join(" ")}): code=${code ?? "unknown"}${signal ? ` signal=${signal}` : ""}${details ? `\n${details}` : ""}`,
      );
    });

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      proc.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 2000);
    }, options.timeoutMs);
  });
}
