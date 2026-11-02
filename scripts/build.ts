#!/usr/bin/env bun
/**
 * Builds the published files of @promptlang/core into dist/:
 *   dist/index.js, dist/runtime/index.js   ESM for Node >= 20 and Bun
 *   dist/cli/cli.js                        the `promptlang` binary (Bun)
 *   dist/**\/*.d.ts                        declarations from tsc
 * @promptlang/yaml-parser is bundled in, so the package has no runtime
 * dependency to resolve.
 */
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

async function bundle(entrypoints: string[], target: "node" | "bun"): Promise<void> {
  const result = await Bun.build({
    entrypoints: entrypoints.map((e) => join(ROOT, e)),
    outdir: DIST,
    root: join(ROOT, "src"),
    target,
    format: "esm",
    // Shared modules go to one chunk, so dist/index.js and dist/runtime/index.js
    // never hold two copies of the same class (instanceof would disagree).
    splitting: true,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`bun build (${target}) failed`);
  }
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false
  );
}

const RELATIVE_SPECIFIER = /(\bfrom\s+|\bimport\()(["'])(\.{1,2}\/[^"']+)\2/g;

/**
 * tsc writes the extensionless relative specifiers of the sources ("./lexer/lexer"),
 * which TypeScript projects using NodeNext resolution reject (TS2834). Each one
 * becomes the explicit path of the module it names: "./x.js" or "./x/index.js".
 */
export async function addDeclarationExtensions(file: string, text: string): Promise<string> {
  const replacements = new Map<string, string>();
  for (const m of text.matchAll(RELATIVE_SPECIFIER)) {
    const spec = m[3]!;
    if (replacements.has(spec) || /\.[cm]?js$/.test(spec)) continue;
    const base = join(dirname(file), spec);
    if (await isFile(`${base}.d.ts`)) replacements.set(spec, `${spec}.js`);
    else if (await isFile(join(base, "index.d.ts"))) replacements.set(spec, `${spec}/index.js`);
    else throw new Error(`${file}: cannot resolve declaration import "${spec}"`);
  }
  return text.replace(RELATIVE_SPECIFIER, (all, lead: string, q: string, spec: string) => {
    const to = replacements.get(spec);
    return to ? `${lead}${q}${to}${q}` : all;
  });
}

async function* declarations(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* declarations(path);
    else if (entry.name.endsWith(".d.ts")) yield path;
  }
}

if (import.meta.main) {
  await rm(DIST, { recursive: true, force: true });
  await bundle(["src/index.ts", "src/runtime/index.ts"], "node");
  await bundle(["src/cli/cli.ts"], "bun");
  const tsc = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json"], { cwd: ROOT });
  if (tsc.exitCode !== 0) {
    console.error(tsc.stdout.toString(), tsc.stderr.toString());
    throw new Error("tsc --emitDeclarationOnly failed");
  }
  for await (const file of declarations(DIST)) {
    const text = await readFile(file, "utf8");
    await writeFile(file, await addDeclarationExtensions(file, text));
  }
  // stderr: npm pack --json prints its result on stdout after the prepack script.
  console.error("built dist/");
}
