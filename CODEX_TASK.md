# Task: Replace system Python dependency with uv-managed toolchain

## Goal

Eliminate all system Python/brew dependencies. The plugin should bootstrap its entire Python toolchain from scratch using `uv`.

## Current behavior

`src/venv-manager.ts` searches for system Python 3.11-3.13. If not found, throws an error telling the user to `brew install python@3.12`. This is a bad first-run experience.

## New behavior

On first run, the plugin should:

1. Check for `uv` binary at `{dataDir}/bin/uv`
2. If missing, download the correct uv release binary from `https://github.com/astral-sh/uv/releases/latest/download/uv-{target}.tar.gz` (target: `aarch64-apple-darwin` or `x86_64-apple-darwin`), extract to `{dataDir}/bin/uv`, chmod +x
3. Run `{dataDir}/bin/uv python install 3.12` to get a standalone Python (no system dependency)
4. Run `{dataDir}/bin/uv venv --python 3.12 {dataDir}/venv` to create the venv
5. Run `{dataDir}/bin/uv pip install --python {dataDir}/venv/bin/python mlx-audio` (and other deps from REQUIRED_PACKAGES)
6. Continue with existing manifest/version check logic

`dataDir` is `~/.openclaw/mlx-audio/`.

## Important: non-blocking background setup

The setup (download uv, install Python, create venv, install deps) should start immediately when the service starts, but run in the background without blocking gateway startup. If a TTS request arrives before setup is complete, it should await the ongoing setup promise. If setup is already done, TTS requests proceed immediately.

Do NOT defer setup to the first TTS request (bad UX: user waits 1-2 minutes for their first voice message). Do NOT block gateway startup either.

## Constraints

- Keep the existing manifest version bump mechanism (MANIFEST_VERSION) to force reinstall when deps change
- Keep the existing `isReady()` fast-path: if venv exists and manifest matches, skip everything
- The `ensurePython()` method should return the venv python binary path, same interface as now
- System Python should still be used if available and compatible (skip uv python install), but uv should still be used for venv creation and pip install (it's faster)
- Log progress clearly: "Downloading uv...", "Installing Python 3.12...", "Creating virtual environment...", "Installing mlx-audio..."
- All downloads use Node.js built-in fetch (no external curl/wget dependency)
- Handle architecture detection: `process.arch === 'arm64'` → `aarch64-apple-darwin`, else `x86_64-apple-darwin`

## Files to modify

- `src/venv-manager.ts` (main changes)

## Reference

- uv releases: https://github.com/astral-sh/uv/releases
- uv docs: https://docs.astral.sh/uv/
- Current venv-manager.ts is at `src/venv-manager.ts`
