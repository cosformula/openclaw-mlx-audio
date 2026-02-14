/**
 * Manages a Python virtual environment for mlx-audio.
 * Auto-creates venv, installs dependencies, provides the python binary path.
 */
export declare class VenvManager {
    private venvDir;
    private logger;
    constructor(dataDir: string, logger: VenvManager["logger"]);
    /** Returns path to python binary inside venv. Ensures venv + deps are ready. */
    ensure(): Promise<string>;
    /** Check if venv exists, python works, and manifest version matches. */
    private isReady;
    /** Find a suitable Python binary on the system. */
    private findPython;
    private getPythonVersion;
    private pip;
    private run;
}
