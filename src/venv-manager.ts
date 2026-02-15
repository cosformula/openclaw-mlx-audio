/**
 * Manages a uv-locked Python runtime for mlx-audio.
 * Bootstraps uv, syncs dependencies from uv.lock, and provides launch metadata.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./run-command.js";

const PYTHON_VERSION = "3.12";
const UV_RELEASE_BASE_URL = "https://github.com/astral-sh/uv/releases/latest/download";
const UV_DOWNLOAD_TIMEOUT_MS = 60_000;
const UV_DOWNLOAD_MAX_ATTEMPTS = 3;
const UV_DOWNLOAD_RETRY_BASE_DELAY_MS = 1_500;
const RUNTIME_TEMPLATE_DIR = "python-runtime";
const RUNTIME_PROJECT_DIR = "runtime";
const RUNTIME_FILES = ["pyproject.toml", "uv.lock"] as const;

export interface ManagedRuntime {
  pythonBin: string;
  uvBin: string;
  projectDir: string;
  launchArgsPrefix: string[];
}

export class VenvManager {
  private dataDir: string;
  private binDir: string;
  private uvBin: string;
  private runtimeProjectDir: string;
  private logger: { info: (m: string) => void; error: (m: string) => void; warn: (m: string) => void };

  constructor(dataDir: string, logger: VenvManager["logger"]) {
    this.dataDir = dataDir;
    this.binDir = join(dataDir, "bin");
    this.uvBin = join(this.binDir, "uv");
    this.runtimeProjectDir = join(dataDir, RUNTIME_PROJECT_DIR);
    this.logger = logger;
  }

  /** Returns managed runtime metadata for spawning mlx_audio.server. */
  async ensure(): Promise<ManagedRuntime> {
    const uvBin = await this.ensureUv();
    this.prepareRuntimeProject();

    const pythonBin = this.getManagedPythonBin();
    if (await this.isReady(uvBin, pythonBin)) {
      this.logger.info("[mlx-audio/venv] Environment ready");
      return {
        pythonBin,
        uvBin,
        projectDir: this.runtimeProjectDir,
        launchArgsPrefix: this.getUvRunLaunchPrefix(),
      };
    }

    this.logger.info("[mlx-audio/venv] Setting up managed Python runtime (first run may take 1-2 minutes)...");
    this.logger.info("[mlx-audio/venv] Syncing dependencies from uv.lock...");
    await this.run(uvBin, this.getUvSyncArgs());

    // Quick sanity: can the synced interpreter import mlx_audio?
    await this.runCommand(pythonBin, ["-c", "import mlx_audio"], { timeoutMs: 10000, cwd: this.runtimeProjectDir });

    this.logger.info("[mlx-audio/venv] Environment ready");
    return {
      pythonBin,
      uvBin,
      projectDir: this.runtimeProjectDir,
      launchArgsPrefix: this.getUvRunLaunchPrefix(),
    };
  }

  /** Check if environment exists, is synced to lockfile, and can import mlx_audio. */
  private async isReady(uvBin: string, pythonBin: string): Promise<boolean> {
    if (!existsSync(pythonBin)) return false;

    try {
      await this.run(uvBin, this.getUvSyncArgs(["--check"]));
      await this.runCommand(pythonBin, ["-c", "import mlx_audio"], { timeoutMs: 10000, cwd: this.runtimeProjectDir });
      return true;
    } catch {
      return false;
    }
  }

  private getUvSyncArgs(extraArgs: string[] = []): string[] {
    return [
      "sync",
      "--project",
      this.runtimeProjectDir,
      "--frozen",
      "--managed-python",
      "--python",
      PYTHON_VERSION,
      "--no-dev",
      "--no-install-project",
      ...extraArgs,
    ];
  }

  private getUvRunLaunchPrefix(): string[] {
    return [
      "run",
      "--project",
      this.runtimeProjectDir,
      "--frozen",
      "--managed-python",
      "--python",
      PYTHON_VERSION,
      "--no-dev",
      "--no-install-project",
      "--no-sync",
      "--",
      "python",
    ];
  }

  private getManagedPythonBin(): string {
    return join(this.runtimeProjectDir, ".venv", "bin", "python");
  }

  private prepareRuntimeProject(): void {
    mkdirSync(this.runtimeProjectDir, { recursive: true });
    const templateDir = this.resolveRuntimeTemplateDir();

    for (const file of RUNTIME_FILES) {
      const source = join(templateDir, file);
      const target = join(this.runtimeProjectDir, file);
      if (!existsSync(source)) {
        throw new Error(`[mlx-audio/venv] Runtime template missing: ${source}`);
      }
      copyFileSync(source, target);
    }
  }

  private resolveRuntimeTemplateDir(): string {
    let searchDir = dirname(fileURLToPath(import.meta.url));

    for (let i = 0; i < 8; i++) {
      const candidate = join(searchDir, RUNTIME_TEMPLATE_DIR);
      const pyproject = join(candidate, "pyproject.toml");
      const lockfile = join(candidate, "uv.lock");
      if (existsSync(pyproject) && existsSync(lockfile)) {
        return candidate;
      }

      const parent = join(searchDir, "..");
      if (parent === searchDir) break;
      searchDir = parent;
    }

    throw new Error(
      `[mlx-audio/venv] Runtime project template not found. Expected ${RUNTIME_TEMPLATE_DIR}/pyproject.toml and uv.lock near plugin files.`,
    );
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

  private async runCommand(
    cmd: string,
    args: string[],
    options: { timeoutMs: number; env?: NodeJS.ProcessEnv; cwd?: string },
  ): Promise<{ stdout: string; stderr: string }> {
    const { stdout, stderr } = await runCommand(cmd, args, options);
    return { stdout, stderr };
  }
}
