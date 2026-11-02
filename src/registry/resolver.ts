// node:fs, not Bun.file: resolveGraph is public API and must run under Node too.
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { LexerError } from "../lexer/errors";
import { ParserError } from "../parser/errors";
import type { SourceEntry } from "../config/config";
import type { Program } from "../ast/nodes";
import { satisfies } from "../semver/semver";

/**
 * A resolved entry produced by the resolver — maps a raw import path (as
 * written in a `.prompt` file) to an absolute filesystem path.
 */
export interface ResolvedImport {
  /** The raw path string as it appeared in the `import "..."` statement. */
  requested: string;
  /** The alias declared with `as`. */
  alias: string;
  /** The file that contained the import. */
  fromFile: string;
  /** The absolute resolved filesystem path. */
  resolvedPath: string;
}

/**
 * Result of resolving the full import graph rooted at a set of entry files.
 * `order` is the topological order (dependencies first).
 */
export interface ResolutionResult {
  /** Every file discovered (roots + transitive), as absolute paths. */
  files: string[];
  /** All resolved imports found during the crawl. */
  imports: ResolvedImport[];
  /** Files in topological order — dependencies always appear before dependents. */
  order: string[];
}

export class ResolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolverError";
  }
}

/**
 * An import's `requires "<range>"` is not met by the imported file's
 * `@version` (or the imported file declares no version).
 */
export class VersionMismatchError extends ResolverError {
  constructor(
    readonly importingFile: string,
    readonly line: number,
    readonly column: number,
    readonly importPath: string,
    readonly range: string,
    readonly actual: string | null
  ) {
    const found = actual === null ? `but '${importPath}' declares no @version` : `got ${actual}`;
    super(
      `${importingFile}:${line}:${column}: import "${importPath}" requires "${range}", ${found}. ` +
        "Update the requires range, or import a version of the file that satisfies it."
    );
    this.name = "VersionMismatchError";
  }
}

export interface ResolverOptions {
  /** Directories (from `promptlang.yaml`'s `sources`) to search for imports. */
  sources?: SourceEntry[];
  /** Root directory that `sources[*].path` values are relative to (default: cwd). */
  projectRoot?: string;
}

/**
 * Resolves a single `import "path" as Alias` statement, returning the absolute
 * filesystem path of the target file.
 *
 * Lookup order:
 *   1. Relative to the importing file (if `path` starts with `./` or `../`
 *      or if the file exists at that resolved location).
 *   2. Relative to each `sources[*].path` in the project config, in order.
 *
 * Absolute paths are used as-is (with existence check).
 *
 * @throws {ResolverError} when the file cannot be found in any candidate.
 */
export async function resolveImport(
  requestedPath: string,
  fromFile: string,
  options: ResolverOptions = {}
): Promise<string> {
  const candidates = candidatePaths(requestedPath, fromFile, options);
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  const tried = candidates.map((c) => `  - ${c}`).join("\n");
  throw new ResolverError(
    `Could not resolve import '${requestedPath}' from '${fromFile}'.\nTried:\n${tried}`
  );
}

/**
 * Walks the full import graph starting from `entryFiles`, resolving every
 * `import "..." as X` recursively. Detects and rejects circular imports and
 * checks each `requires "<range>"` against the imported file's `@version`.
 *
 * @throws {VersionMismatchError} when a `requires` range is not satisfied.
 * @throws {ResolverError} on unresolvable imports or import cycles.
 */
export async function resolveGraph(
  entryFiles: string[],
  options: ResolverOptions = {}
): Promise<ResolutionResult> {
  const absEntries = entryFiles.map((f) => resolve(f));
  const files = new Set<string>();
  const imports: ResolvedImport[] = [];
  const order: string[] = [];
  const visiting = new Set<string>();
  const asts = new Map<string, Program>();

  async function load(file: string): Promise<Program> {
    let ast = asts.get(file);
    if (!ast) {
      const source = await readFile(file, "utf8");
      try {
        ast = parse(tokenize(source));
      } catch (error) {
        // Syntax errors carry a position but not the file; add it so `install`
        // and `check` can say which file in the graph is broken.
        if (error instanceof LexerError || error instanceof ParserError) {
          throw new ResolverError(`${file}:${error.line}:${error.column}: ${error.message}`);
        }
        throw error;
      }
      asts.set(file, ast);
    }
    return ast;
  }

  async function visit(file: string, stack: string[]): Promise<void> {
    if (visiting.has(file)) {
      const cycle = [...stack.slice(stack.indexOf(file)), file].join(" -> ");
      throw new ResolverError(`Circular import detected: ${cycle}`);
    }
    if (files.has(file)) return;
    visiting.add(file);
    const ast = await load(file);
    for (const imp of ast.imports) {
      const resolved = await resolveImport(imp.path, file, options);
      if (imp.versionRange !== undefined) {
        const version = (await load(resolved)).metadata.find((m) => m.kind === "VersionMetadata");
        if (!version || !satisfies(version.value, imp.versionRange)) {
          throw new VersionMismatchError(
            file,
            imp.line,
            imp.column,
            imp.path,
            imp.versionRange,
            version?.value ?? null
          );
        }
      }
      imports.push({
        requested: imp.path,
        alias: imp.alias,
        fromFile: file,
        resolvedPath: resolved,
      });
      await visit(resolved, [...stack, file]);
    }
    visiting.delete(file);
    files.add(file);
    order.push(file);
  }

  for (const entry of absEntries) {
    await visit(entry, []);
  }

  return { files: [...files], imports, order };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function candidatePaths(
  requestedPath: string,
  fromFile: string,
  options: ResolverOptions
): string[] {
  const paths: string[] = [];

  if (isAbsolute(requestedPath)) {
    paths.push(normalize(requestedPath));
    return paths;
  }

  const fromDir = dirname(resolve(fromFile));

  if (requestedPath.startsWith("./") || requestedPath.startsWith("../")) {
    paths.push(resolve(fromDir, requestedPath));
    return paths;
  }

  // Bare paths: try relative-to-file first (convenient for co-located imports),
  // then each configured source directory.
  paths.push(resolve(fromDir, requestedPath));

  const projectRoot = options.projectRoot ?? process.cwd();
  const sources = options.sources ?? [];
  for (const s of sources) {
    const base = resolve(projectRoot, s.path);
    paths.push(resolve(base, requestedPath));
  }

  // Deduplicate while preserving order.
  return [...new Set(paths)];
}

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false
  );
}
