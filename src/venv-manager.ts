/**
 * Manages a Python virtual environment for mlx-audio.
 * Auto-creates venv, installs dependencies, provides the python binary path.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** All packages needed for Kokoro TTS — mlx-audio doesn't declare them all. */
const REQUIRED_PACKAGES = [
  "mlx-audio",
  "uvicorn",
  "fastapi",
  "python-multipart",
  "setuptools<81",    // for pkg_resources (webrtcvad needs it, removed in 82+)
  "webrtcvad",
  "misaki",
  "num2words",
  "phonemizer",
];

/** Packages that must be installed with --only-binary to avoid C compilation failures. */
const BINARY_ONLY_PACKAGES = ["spacy"];

/** Post-install: download spacy English model. */
const SPACY_MODEL = "en_core_web_sm";

/** Minimum Python version (3.11), maximum (3.13). 3.14 breaks webrtcvad/pkg_resources. */
const PYTHON_CANDIDATES = ["python3.12", "python3.11", "python3.13", "python3"];

const MANIFEST_FILE = "manifest.json";
const MAX_CAPTURED_OUTPUT_CHARS = 16_384;

interface Manifest {
  version: number;
  packages: string[];
  pythonVersion: string;
  createdAt: string;
}

const MANIFEST_VERSION = 3; // Bump when deps change to force reinstall.

export class VenvManager {
  private venvDir: string;
  private logger: { info: (m: string) => void; error: (m: string) => void; warn: (m: string) => void };

  constructor(dataDir: string, logger: VenvManager["logger"]) {
    this.venvDir = join(dataDir, "venv");
    this.logger = logger;
  }

  /** Returns path to python binary inside venv. Ensures venv + deps are ready. */
  async ensure(): Promise<string> {
    const pythonBin = join(this.venvDir, "bin", "python");

    if (await this.isReady(pythonBin)) {
      this.logger.info("[mlx-audio/venv] Environment ready");
      return pythonBin;
    }

    this.logger.info("[mlx-audio/venv] Setting up Python environment (first run, may take 1-2 minutes)...");

    // Find suitable python
    const systemPython = await this.findPython();
    if (!systemPython) {
      throw new Error(
        "[mlx-audio] No compatible Python found (need 3.11-3.13). Install with: brew install python@3.12"
      );
    }
    this.logger.info(`[mlx-audio/venv] Using system Python: ${systemPython}`);

    // Create venv
    if (!existsSync(this.venvDir)) {
      mkdirSync(this.venvDir, { recursive: true });
    }
    await this.run(systemPython, ["-m", "venv", "--clear", this.venvDir]);

    // Upgrade pip
    await this.pip(pythonBin, ["install", "--upgrade", "pip"], "Upgrading pip");

    // Install main packages
    await this.pip(pythonBin, ["install", ...REQUIRED_PACKAGES], "Installing mlx-audio + dependencies");

    // Install binary-only packages (avoid C compilation)
    await this.pip(
      pythonBin,
      ["install", "--only-binary", ":all:", ...BINARY_ONLY_PACKAGES],
      "Installing spacy (pre-built)"
    );

    // Download spacy English model
    this.logger.info("[mlx-audio/venv] Downloading spacy English model...");
    await this.run(pythonBin, ["-m", "spacy", "download", SPACY_MODEL]);

    // Write manifest
    const manifest: Manifest = {
      version: MANIFEST_VERSION,
      packages: [...REQUIRED_PACKAGES, ...BINARY_ONLY_PACKAGES],
      pythonVersion: await this.getPythonVersion(pythonBin),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(this.venvDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));

    this.logger.info("[mlx-audio/venv] Environment ready");
    return pythonBin;
  }

  /** Check if venv exists, python works, and manifest version matches. */
  private async isReady(pythonBin: string): Promise<boolean> {
    if (!existsSync(pythonBin)) return false;

    const manifestPath = join(this.venvDir, MANIFEST_FILE);
    if (!existsSync(manifestPath)) return false;

    try {
      const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      if (manifest.version !== MANIFEST_VERSION) {
        this.logger.info("[mlx-audio/venv] Manifest version mismatch, rebuilding...");
        return false;
      }
      // Quick sanity: can python import mlx_audio?
      await this.runCommand(pythonBin, ["-c", "import mlx_audio"], { timeoutMs: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Find a suitable Python binary on the system. */
  private async findPython(): Promise<string | null> {
    for (const candidate of PYTHON_CANDIDATES) {
      try {
        const { stdout, stderr } = await this.runCommand(candidate, ["--version"], { timeoutMs: 5000 });
        const version = `${stdout}\n${stderr}`.trim();
        const match = version.match(/Python (\d+)\.(\d+)/);
        if (match) {
          const [, major, minor] = match;
          const maj = parseInt(major!, 10);
          const min = parseInt(minor!, 10);
          if (maj === 3 && min >= 11 && min <= 13) {
            return candidate;
          }
        }
      } catch {
        // candidate not found
      }
    }
    return null;
  }

  private async getPythonVersion(pythonBin: string): Promise<string> {
    try {
      const { stdout, stderr } = await this.runCommand(pythonBin, ["--version"], { timeoutMs: 5000 });
      return `${stdout}\n${stderr}`.trim() || "unknown";
    } catch {
      return "unknown";
    }
  }

  private async pip(pythonBin: string, args: string[], label: string): Promise<void> {
    this.logger.info(`[mlx-audio/venv] ${label}...`);
    await this.run(pythonBin, ["-m", "pip", "--disable-pip-version-check", ...args]);
  }

  private async run(cmd: string, args: string[]): Promise<void> {
    try {
      await this.runCommand(cmd, args, {
        timeoutMs: 600000, // 10 min max
        env: { ...process.env, VIRTUAL_ENV: this.venvDir, PATH: `${join(this.venvDir, "bin")}:${process.env.PATH}` },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[mlx-audio/venv] Command failed: ${cmd} ${args.join(" ")}\n${msg}`);
    }
  }

  private runCommand(
    cmd: string,
    args: string[],
    options: { timeoutMs: number; env?: NodeJS.ProcessEnv; cwd?: string },
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

      const appendWithLimit = (current: string, chunk: string): string => {
        const next = current + chunk;
        if (next.length <= MAX_CAPTURED_OUTPUT_CHARS) {
          return next;
        }
        return next.slice(next.length - MAX_CAPTURED_OUTPUT_CHARS);
      };

      const finalizeReject = (message: string): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        reject(new Error(message));
      };

      const finalizeResolve = (): void => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      };

      let proc;
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

        if (code === 0) {
          finalizeResolve();
          return;
        }

        const details = (stderr || stdout).trim();
        finalizeReject(`Exited with code ${code ?? "unknown"}${signal ? ` (signal: ${signal})` : ""}${details ? `\n${details}` : ""}`);
      });

      timeoutTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        proc.kill("SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, 2000);
      }, options.timeoutMs);
    });
  }
}
