/**
 * Manages a Python virtual environment for mlx-audio.
 * Auto-creates venv, installs dependencies, provides the python binary path.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/** All packages needed for Kokoro TTS — mlx-audio doesn't declare them all. */
const REQUIRED_PACKAGES = [
    "mlx-audio",
    "uvicorn",
    "fastapi",
    "python-multipart",
    "setuptools", // for pkg_resources (webrtcvad)
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
const MANIFEST_VERSION = 2; // Bump when deps change to force reinstall.
export class VenvManager {
    venvDir;
    logger;
    constructor(dataDir, logger) {
        this.venvDir = join(dataDir, "venv");
        this.logger = logger;
    }
    /** Returns path to python binary inside venv. Ensures venv + deps are ready. */
    async ensure() {
        const pythonBin = join(this.venvDir, "bin", "python");
        if (this.isReady(pythonBin)) {
            this.logger.info("[mlx-audio/venv] Environment ready");
            return pythonBin;
        }
        this.logger.info("[mlx-audio/venv] Setting up Python environment (first run, may take 1-2 minutes)...");
        // Find suitable python
        const systemPython = this.findPython();
        if (!systemPython) {
            throw new Error("[mlx-audio] No compatible Python found (need 3.11-3.13). Install with: brew install python@3.12");
        }
        this.logger.info(`[mlx-audio/venv] Using system Python: ${systemPython}`);
        // Create venv
        if (!existsSync(this.venvDir)) {
            mkdirSync(this.venvDir, { recursive: true });
        }
        this.run(systemPython, ["-m", "venv", "--clear", this.venvDir]);
        // Upgrade pip
        this.pip(pythonBin, ["install", "--upgrade", "pip"], "Upgrading pip");
        // Install main packages
        this.pip(pythonBin, ["install", ...REQUIRED_PACKAGES], "Installing mlx-audio + dependencies");
        // Install binary-only packages (avoid C compilation)
        this.pip(pythonBin, ["install", "--only-binary", ":all:", ...BINARY_ONLY_PACKAGES], "Installing spacy (pre-built)");
        // Download spacy English model
        this.logger.info("[mlx-audio/venv] Downloading spacy English model...");
        this.run(pythonBin, ["-m", "spacy", "download", SPACY_MODEL]);
        // Write manifest
        const manifest = {
            version: MANIFEST_VERSION,
            packages: [...REQUIRED_PACKAGES, ...BINARY_ONLY_PACKAGES],
            pythonVersion: this.getPythonVersion(pythonBin),
            createdAt: new Date().toISOString(),
        };
        writeFileSync(join(this.venvDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
        this.logger.info("[mlx-audio/venv] Environment ready");
        return pythonBin;
    }
    /** Check if venv exists, python works, and manifest version matches. */
    isReady(pythonBin) {
        if (!existsSync(pythonBin))
            return false;
        const manifestPath = join(this.venvDir, MANIFEST_FILE);
        if (!existsSync(manifestPath))
            return false;
        try {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
            if (manifest.version !== MANIFEST_VERSION) {
                this.logger.info("[mlx-audio/venv] Manifest version mismatch, rebuilding...");
                return false;
            }
            // Quick sanity: can python import mlx_audio?
            execFileSync(pythonBin, ["-c", "import mlx_audio"], { timeout: 10000, stdio: "ignore" });
            return true;
        }
        catch {
            return false;
        }
    }
    /** Find a suitable Python binary on the system. */
    findPython() {
        for (const candidate of PYTHON_CANDIDATES) {
            try {
                const version = execSync(`${candidate} --version 2>&1`, { timeout: 5000 }).toString().trim();
                const match = version.match(/Python (\d+)\.(\d+)/);
                if (match) {
                    const [, major, minor] = match;
                    const maj = parseInt(major, 10);
                    const min = parseInt(minor, 10);
                    if (maj === 3 && min >= 11 && min <= 13) {
                        return candidate;
                    }
                }
            }
            catch {
                // candidate not found
            }
        }
        return null;
    }
    getPythonVersion(pythonBin) {
        try {
            return execFileSync(pythonBin, ["--version"], { timeout: 5000 }).toString().trim();
        }
        catch {
            return "unknown";
        }
    }
    pip(pythonBin, args, label) {
        this.logger.info(`[mlx-audio/venv] ${label}...`);
        this.run(pythonBin, ["-m", "pip", "--disable-pip-version-check", ...args]);
    }
    run(cmd, args) {
        try {
            execFileSync(cmd, args, {
                timeout: 600000, // 10 min max
                stdio: ["ignore", "pipe", "pipe"],
                env: { ...process.env, VIRTUAL_ENV: this.venvDir, PATH: `${join(this.venvDir, "bin")}:${process.env.PATH}` },
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.stderr?.toString() || err.message : String(err);
            throw new Error(`[mlx-audio/venv] Command failed: ${cmd} ${args.join(" ")}\n${msg}`);
        }
    }
}
