import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Glob } from "bun";
import type { PromptLangConfig } from "../config/config";
import { resolveGraph, type ResolvedImport } from "./resolver";
import {
  buildIntegrity,
  migrateIntegrity,
  toProjectPath,
  verifyIntegrity,
  type IntegrityRecord,
  type IntegrityMismatch,
} from "./integrity";

/** Directory (relative to the project root) where the registry lives. */
const REGISTRY_DIR = ".promptlang";
const MANIFEST_FILE = "manifest.json";
const INTEGRITY_FILE = "integrity.json";

/**
 * On-disk shape of `.promptlang/manifest.json`: the resolved import graph. Every
 * path is project-relative POSIX (see `toProjectPath`), so the file does not
 * leak the machine's directory layout and matches across checkouts.
 */
export interface Manifest {
  /** Schema version. 1 stored absolute paths; 2 stores project-relative ones. */
  version: 2;
  /** Timestamp the manifest was last written. */
  generatedAt: string;
  /** Every discovered `.prompt` file, sorted. */
  files: string[];
  /** Every resolved import edge. */
  imports: ManifestImport[];
}

interface ManifestImport {
  requested: string;
  alias: string;
  fromFile: string;
  resolvedPath: string;
}

/** Result of `install()` — the manifest and its accompanying integrity record. */
export interface InstallResult {
  manifest: Manifest;
  integrity: IntegrityRecord;
  registryPath: string;
}

/**
 * Populates `.promptlang/` from the current project state:
 *   1. Discover every local `.prompt` file under `sources[*].path`.
 *   2. Walk the import graph starting from those files.
 *   3. Write `manifest.json` and `integrity.json`.
 *
 * Existing files are overwritten. The registry directory is created if needed.
 */
export async function install(
  config: PromptLangConfig,
  projectRoot: string
): Promise<InstallResult> {
  const roots = await discoverLocalPrompts(config, projectRoot);
  const graph = await resolveGraph(roots, {
    sources: config.sources,
    projectRoot,
  });
  const integrity = await buildIntegrity(graph.files, projectRoot);

  const manifest: Manifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    files: graph.files.map((f) => toProjectPath(f, projectRoot)).sort(),
    imports: graph.imports.map((imp) => toManifestImport(imp, projectRoot)),
  };

  const registryPath = join(projectRoot, REGISTRY_DIR);
  await mkdir(join(registryPath, "cache"), { recursive: true });
  await Bun.write(join(registryPath, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  await Bun.write(join(registryPath, INTEGRITY_FILE), `${JSON.stringify(integrity, null, 2)}\n`);

  return { manifest, integrity, registryPath };
}

/**
 * Reads the persisted manifest from disk. Returns `null` when it does not
 * exist yet — callers can decide whether that's an error (`check`) or a
 * signal to run `install` first (`compile`).
 */
export async function readManifest(projectRoot: string): Promise<Manifest | null> {
  const path = join(projectRoot, REGISTRY_DIR, MANIFEST_FILE);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return migrateManifest(JSON.parse(await file.text()), projectRoot);
}

/** Rewrites a version 1 manifest (absolute paths) as version 2. */
function migrateManifest(
  raw: Omit<Manifest, "version"> & { version: number },
  projectRoot: string
): Manifest {
  const rel = (p: string) => (isAbsolute(p) ? toProjectPath(p, projectRoot) : p);
  return {
    version: 2,
    generatedAt: raw.generatedAt,
    files: raw.files.map(rel),
    imports: raw.imports.map((imp) => ({
      ...imp,
      fromFile: rel(imp.fromFile),
      resolvedPath: rel(imp.resolvedPath),
    })),
  };
}

/**
 * Reads the persisted integrity record. Returns `{}` when it does not exist
 * yet, so callers can safely pass the result to `verifyIntegrity`.
 */
async function readIntegrity(projectRoot: string): Promise<IntegrityRecord> {
  const path = join(projectRoot, REGISTRY_DIR, INTEGRITY_FILE);
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  return migrateIntegrity(JSON.parse(await file.text()) as IntegrityRecord, projectRoot);
}

/**
 * Runs `install` if the registry is missing, then re-verifies every file's
 * hash. Returns the list of mismatches (empty when the project is clean).
 */
export async function check(
  config: PromptLangConfig,
  projectRoot: string
): Promise<IntegrityMismatch[]> {
  let record = await readIntegrity(projectRoot);
  if (Object.keys(record).length === 0) {
    const result = await install(config, projectRoot);
    record = result.integrity;
  }
  return verifyIntegrity(record, projectRoot);
}

/** Scans the project for all local `.prompt` files under configured sources. */
export async function discoverLocalPrompts(
  config: PromptLangConfig,
  projectRoot: string
): Promise<string[]> {
  const files = new Set<string>();
  const dirs = config.sources.length > 0 ? config.sources.map((s) => s.path) : ["."];
  for (const dir of dirs) {
    const abs = resolve(projectRoot, dir);
    const glob = new Glob("**/*.prompt");
    for await (const rel of glob.scan(abs)) {
      files.add(join(abs, rel));
    }
  }
  return [...files];
}

function toManifestImport(imp: ResolvedImport, projectRoot: string): ManifestImport {
  return {
    requested: imp.requested,
    alias: imp.alias,
    fromFile: toProjectPath(imp.fromFile, projectRoot),
    resolvedPath: toProjectPath(imp.resolvedPath, projectRoot),
  };
}
