/**
 * Manages a Python virtual environment for mlx-audio.
 * Auto-creates venv, installs dependencies, provides the python binary path.
 */

import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const BINARY_ONLY_PACKAGES = ["spacy>=3.8,<3.9"];
const SPACY_MODEL_PACKAGE =
  "https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl";
const PYTHON_VERSION = "3.12";
const UV_RELEASE_BASE_URL = "https://github.com/astral-sh/uv/releases/latest/download";
const UV_DOWNLOAD_TIMEOUT_MS = 60_000;
const UV_DOWNLOAD_MAX_ATTEMPTS = 3;
const UV_DOWNLOAD_RETRY_BASE_DELAY_MS = 1_500;

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
  private dataDir: string;
  private venvDir: string;
  private binDir: string;
  private uvBin: string;
  private logger: { info: (m: string) => void; error: (m: string) => void; warn: (m: string) => void };

  constructor(dataDir: string, logger: VenvManager["logger"]) {
    this.dataDir = dataDir;
    this.venvDir = join(dataDir, "venv");
    this.binDir = join(dataDir, "bin");
    this.uvBin = join(this.binDir, "uv");
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

    const uvBin = await this.ensureUv();

    // Find suitable python
    const systemPython = await this.findPython();
    let pythonSpec = PYTHON_VERSION;
    if (systemPython) {
      this.logger.info(`[mlx-audio/venv] Using system Python: ${systemPython}`);
      pythonSpec = systemPython;
    } else {
      this.logger.info(`[mlx-audio/venv] Installing Python ${PYTHON_VERSION}...`);
      await this.run(uvBin, ["python", "install", PYTHON_VERSION]);
    }

    // Create venv (always recreated when not ready)
    this.logger.info("[mlx-audio/venv] Creating virtual environment...");
    rmSync(this.venvDir, { recursive: true, force: true });
    await this.run(uvBin, ["venv", "--seed", "--python", pythonSpec, this.venvDir]);

    // Install main packages
    this.logger.info("[mlx-audio/venv] Installing mlx-audio...");
    await this.run(uvBin, ["pip", "install", "--python", pythonBin, ...REQUIRED_PACKAGES]);

    // Install binary-only packages and model wheel (avoid C compilation and spacy downloader pip path).
    this.logger.info("[mlx-audio/venv] Installing spacy and en_core_web_sm model (pre-built)...");
    await this.run(uvBin, [
      "pip",
      "install",
      "--python",
      pythonBin,
      "--only-binary",
      ":all:",
      ...BINARY_ONLY_PACKAGES,
      SPACY_MODEL_PACKAGE,
    ]);

    // Write manifest
    const manifest: Manifest = {
      version: MANIFEST_VERSION,
      packages: [...REQUIRED_PACKAGES, ...BINARY_ONLY_PACKAGES, SPACY_MODEL_PACKAGE],
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

  private async ensureUv(): Promise<string> {
    if (existsSync(this.uvBin)) {
      try {
        chmodSync(this.uvBin, 0o755);
      } catch {
        // ignore chmod failures for existing binaries
      }
      return this.uvBin;
    }

    mkdirSync(this.binDir, { recursive: true });

    const target = this.getUvTarget();
    const url = `${UV_RELEASE_BASE_URL}/uv-${target}.tar.gz`;
    const tempDir = mkdtempSync(join(this.dataDir, "uv-download-"));
    const archivePath = join(tempDir, "uv.tar.gz");
    const extractDir = join(tempDir, "extract");

    this.logger.info("[mlx-audio/venv] Downloading uv...");

    try {
      const archive = await this.downloadUvArchive(url);
      writeFileSync(archivePath, archive);
      mkdirSync(extractDir, { recursive: true });
      await this.run("/usr/bin/tar", ["-xzf", archivePath, "-C", extractDir]);

      const extractedUv = join(extractDir, `uv-${target}`, "uv");
      if (!existsSync(extractedUv)) {
        throw new Error(`Extracted uv binary not found at ${extractedUv}`);
      }

      copyFileSync(extractedUv, this.uvBin);
      chmodSync(this.uvBin, 0o755);
      return this.uvBin;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[mlx-audio/venv] Failed to bootstrap uv: ${msg}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private getUvTarget(): string {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }

  private async downloadUvArchive(url: string): Promise<Buffer> {
    let lastErr: Error | null = null;

    for (let attempt = 1; attempt <= UV_DOWNLOAD_MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, UV_DOWNLOAD_TIMEOUT_MS);

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return Buffer.from(await response.arrayBuffer());
      } catch (err: unknown) {
        const base = err instanceof Error ? err.message : String(err);
        const message = timedOut ? `timed out after ${UV_DOWNLOAD_TIMEOUT_MS}ms` : base;
        lastErr = new Error(`Attempt ${attempt}/${UV_DOWNLOAD_MAX_ATTEMPTS}: ${message}`);

        if (attempt < UV_DOWNLOAD_MAX_ATTEMPTS) {
          this.logger.warn(`[mlx-audio/venv] uv download failed (${message}), retrying...`);
          const delayMs = UV_DOWNLOAD_RETRY_BASE_DELAY_MS * attempt;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } finally {
        clearTimeout(timeoutTimer);
      }
    }

    throw lastErr ?? new Error("uv download failed");
  }

  private async run(cmd: string, args: string[]): Promise<void> {
    try {
      await this.runCommand(cmd, args, {
        timeoutMs: 600000, // 10 min max
        env: process.env,
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
