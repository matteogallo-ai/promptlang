import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";

/**
 * Contents of `.promptlang/integrity.json`: a map from a file path, relative to
 * the project root and POSIX-separated, to its SHA-256 digest at the time of the
 * last `install`. Relative keys keep the file identical across checkouts and
 * machines, so it can be committed.
 */
export interface IntegrityRecord {
  [projectRelativePath: string]: string;
}

/**
 * A path relative to the project root with `/` separators. Registry files use it
 * so they are identical across checkouts, machines and operating systems.
 */
export function toProjectPath(file: string, projectRoot: string): string {
  return relative(projectRoot, file).split(sep).join("/");
}

/**
 * Rewrites keys written by older versions (absolute paths) as project-relative
 * POSIX paths. Relative keys pass through unchanged.
 */
export function migrateIntegrity(record: IntegrityRecord, projectRoot: string): IntegrityRecord {
  const migrated: IntegrityRecord = {};
  for (const [key, hash] of Object.entries(record)) {
    migrated[isAbsolute(key) ? toProjectPath(key, projectRoot) : key] = hash;
  }
  return migrated;
}

/**
 * Computes the SHA-256 hex digest of a `.prompt` file.
 * Normalizes line endings (CRLF → LF) so a file that is checked out on
 * Windows and Unix produces the same hash.
 */
export async function hashFile(path: string): Promise<string> {
  const source = await Bun.file(path).text();
  return hashString(source);
}

/** Computes the SHA-256 hex digest of a source string. */
export function hashString(source: string): string {
  const normalized = source.replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Builds an integrity record for a set of files. Order does not matter —
 * the resulting object is a plain path→hash lookup.
 */
export async function buildIntegrity(
  files: string[],
  projectRoot: string
): Promise<IntegrityRecord> {
  const record: IntegrityRecord = {};
  for (const file of [...files].sort()) {
    record[toProjectPath(file, projectRoot)] = await hashFile(file);
  }
  return record;
}

/**
 * Verifies that every file in `record` still matches its stored hash.
 * Returns the list of files whose hashes have changed (empty when OK).
 * Files that no longer exist are reported as `mismatched` too, with a
 * sentinel `<missing>` hash in the diagnostic.
 */
export async function verifyIntegrity(
  record: IntegrityRecord,
  projectRoot: string
): Promise<IntegrityMismatch[]> {
  const mismatches: IntegrityMismatch[] = [];
  for (const [file, expected] of Object.entries(record)) {
    const path = join(projectRoot, file);
    if (!(await Bun.file(path).exists())) {
      mismatches.push({ file, expected, actual: "<missing>" });
      continue;
    }
    const actual = await hashFile(path);
    if (actual !== expected) {
      mismatches.push({ file, expected, actual });
    }
  }
  return mismatches;
}

export interface IntegrityMismatch {
  file: string;
  expected: string;
  actual: string;
}

/**
 * Merges a partial integrity record into an existing one. Newer entries win.
 * Useful when only some files were re-hashed after a change.
 */
export function mergeIntegrity(base: IntegrityRecord, update: IntegrityRecord): IntegrityRecord {
  return { ...base, ...update };
}
