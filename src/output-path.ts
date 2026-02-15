import { promises as fs } from "node:fs";
import path from "node:path";

export type OutputPathOptions = {
  tmpDir: string;
  systemTmpDir: string;
  outputDir: string;
  homeDir: string;
  now?: () => number;
};

function isPathWithin(baseDir: string, candidatePath: string): boolean {
  const relative = path.relative(baseDir, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function expandUserPath(inputPath: string, homeDir: string): string {
  if (inputPath === "~") return homeDir;
  if (inputPath.startsWith("~/")) return path.join(homeDir, inputPath.slice(2));
  return inputPath;
}

function resolveOutputPath(outputPath: string | undefined, opts: OutputPathOptions): string {
  if (!outputPath) {
    return path.join(opts.tmpDir, `mlx-audio-${(opts.now ?? Date.now)()}.mp3`);
  }

  const trimmed = outputPath.trim();
  if (!trimmed) {
    throw new Error("outputPath must be a non-empty string");
  }

  const expanded = expandUserPath(trimmed, opts.homeDir);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(opts.outputDir, expanded);
}

function getAllowedRoots(opts: OutputPathOptions): string[] {
  return Array.from(new Set([path.resolve(opts.tmpDir), path.resolve(opts.systemTmpDir), path.resolve(opts.outputDir)]));
}

function selectAllowedRoot(targetPath: string, opts: OutputPathOptions): string {
  const allowedRoots = getAllowedRoots(opts);
  for (const root of allowedRoots) {
    if (isPathWithin(root, targetPath)) return root;
  }
  throw new Error(`outputPath must be under ${opts.tmpDir} or ${opts.outputDir}`);
}

function isNotFoundError(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function ensureSafeDirectoryTree(rootDir: string, parentDir: string): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true });

  const rootStat = await fs.stat(rootDir);
  if (!rootStat.isDirectory()) {
    throw new Error(`outputPath root is not a directory: ${rootDir}`);
  }

  const relative = path.relative(rootDir, parentDir);
  if (relative === "") return;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("outputPath resolves outside the allowed root");
  }

  const segments = relative.split(path.sep).filter(Boolean);
  let current = rootDir;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      await fs.mkdir(current);
      continue;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") {
        throw err;
      }
    }

    const st = await fs.lstat(current);
    if (st.isSymbolicLink()) {
      throw new Error(`outputPath contains a symbolic link segment: ${current}`);
    }
    if (!st.isDirectory()) {
      throw new Error(`outputPath parent includes a non-directory segment: ${current}`);
    }
  }
}

async function assertRealPathWithinRoot(rootDir: string, parentDir: string): Promise<void> {
  const rootRealPath = await fs.realpath(rootDir);
  const parentRealPath = await fs.realpath(parentDir);
  if (!isPathWithin(rootRealPath, parentRealPath)) {
    throw new Error("outputPath resolves outside the allowed root via symbolic links");
  }
}

async function assertTargetIsSafe(targetPath: string): Promise<void> {
  let targetStat;
  try {
    targetStat = await fs.lstat(targetPath);
  } catch (err: unknown) {
    if (isNotFoundError(err)) return;
    throw err;
  }
  if (targetStat.isSymbolicLink()) {
    throw new Error(`outputPath cannot be a symbolic link: ${targetPath}`);
  }
  if (!targetStat.isFile()) {
    throw new Error(`outputPath must point to a regular file: ${targetPath}`);
  }
}

export async function resolveSecureOutputPath(outputPath: string | undefined, opts: OutputPathOptions): Promise<string> {
  const targetPath = resolveOutputPath(outputPath, opts);
  const allowedRoot = selectAllowedRoot(targetPath, opts);
  const parentDir = path.dirname(targetPath);

  await ensureSafeDirectoryTree(allowedRoot, parentDir);
  await assertRealPathWithinRoot(allowedRoot, parentDir);
  await assertTargetIsSafe(targetPath);

  return targetPath;
}

export async function writeOutputFileSecure(
  payload: Buffer,
  outputPath: string | undefined,
  opts: OutputPathOptions,
): Promise<{ path: string; bytes: number }> {
  const targetPath = await resolveSecureOutputPath(outputPath, opts);
  await fs.writeFile(targetPath, payload);
  return { path: targetPath, bytes: payload.length };
}
