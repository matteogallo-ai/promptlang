import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A checkout has the TypeScript source; the published package has only the
// built dist/runtime/index.js, next to the bundled CLI.
const RUNTIME_SOURCE = join(import.meta.dir, "..", "runtime", "index.ts");
const RUNTIME_ENTRY = existsSync(RUNTIME_SOURCE)
  ? RUNTIME_SOURCE
  : join(import.meta.dir, "..", "runtime", "index.js");
const RUNTIME_SPECIFIER = '"@promptlang/core/runtime"';

/**
 * Imports TypeScript produced by `compile()` in this process, so tests run the
 * generated code itself rather than a re-implementation of its semantics.
 * The `@promptlang/core/runtime` specifier is rewritten to this checkout's runtime
 * because the package is not installed under that name.
 */
export async function importCompiled<T = Record<string, unknown>>(source: string): Promise<T> {
  if (!source.includes(RUNTIME_SPECIFIER)) {
    throw new Error(
      "importCompiled: source does not import @promptlang/core/runtime; is it compiler output?"
    );
  }
  const dir = await mkdtemp(join(tmpdir(), "promptlang-compiled-"));
  try {
    const file = join(dir, "module.ts");
    await writeFile(file, source.replaceAll(RUNTIME_SPECIFIER, JSON.stringify(RUNTIME_ENTRY)));
    return (await import(file)) as T;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
