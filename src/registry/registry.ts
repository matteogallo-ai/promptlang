import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Glob } from "bun";
import type { PromptLangConfig } from "../config/config";
import { resolveGraph, type ResolvedImport } from "./resolver";
import {
  buildIntegrity,
  verifyIntegrity,
  type IntegrityRecord,
  type IntegrityMismatch,
} from "./integrity";

/** Directory (relative to the project root) where the registry lives. */
export const REGISTRY_DIR = ".promptlang";
export const MANIFEST_FILE = "manifest.json";
export const INTEGRITY_FILE = "integrity.json";

/**
 * On-disk shape of `.promptlang/manifest.json`. Contains the fully-resolved
 * import graph so subsequent runs (`compile`, `check`) can skip re-resolution.
 */
export interface Manifest {
  /** Version of the manifest schema — bumped when the shape changes. */
  version: 1;
  /** Timestamp the manifest was last written. */
  generatedAt: string;
  /** Every discovered `.prompt` file (absolute path). */
  files: string[];
  /** Every resolved import edge. */
  imports: ManifestImport[];
}

export interface ManifestImport {
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
  const integrity = await buildIntegrity(graph.files);

  const manifest: Manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    files: graph.files.slice().sort(),
    imports: graph.imports.map(toManifestImport),
  };

  const registryPath = join(projectRoot, REGISTRY_DIR);
  await mkdir(join(registryPath, "cache"), { recursive: true });
  await Bun.write(join(registryPath, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
  await Bun.write(join(registryPath, INTEGRITY_FILE), JSON.stringify(integrity, null, 2) + "\n");

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
  return JSON.parse(await file.text()) as Manifest;
}

/**
 * Reads the persisted integrity record. Returns `{}` when it does not exist
 * yet, so callers can safely pass the result to `verifyIntegrity`.
 */
export async function readIntegrity(projectRoot: string): Promise<IntegrityRecord> {
  const path = join(projectRoot, REGISTRY_DIR, INTEGRITY_FILE);
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  return JSON.parse(await file.text()) as IntegrityRecord;
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
  return verifyIntegrity(record);
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

function toManifestImport(imp: ResolvedImport): ManifestImport {
  return {
    requested: imp.requested,
    alias: imp.alias,
    fromFile: imp.fromFile,
    resolvedPath: imp.resolvedPath,
  };
}
