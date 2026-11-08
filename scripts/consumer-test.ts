#!/usr/bin/env bun
/**
 * Installs @promptlang/core the way a user does and uses it from Node:
 *   1. `npm pack` (prepack builds dist/) and check the tarball's file list;
 *   2. `npm install <tarball>` into an empty temporary project;
 *   3. under Node: import both entry points, compile an example, run the
 *      generated code against MockClient;
 *   4. type-check the generated TypeScript against the installed declarations,
 *      with no paths mapping;
 *   5. play the README quick example with the installed `promptlang` binary
 *      (test, compile) and type-check its "Use it" snippet against the output.
 * Exit 0 only if every step passes.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function run(cmd: string[], cwd: string): string {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) {
    throw new Error(
      `${cmd.join(" ")} exited ${r.exitCode}\n${r.stdout.toString()}\n${r.stderr.toString()}`
    );
  }
  return r.stdout.toString();
}

/** Every path a user imports or runs must be in the tarball; sources and tests must not. */
export function checkTarballFiles(files: string[]): string[] {
  const problems: string[] = [];
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/runtime/index.js",
    "dist/runtime/index.d.ts",
    "dist/cli/cli.js",
  ]) {
    if (!files.includes(required)) problems.push(`missing ${required}`);
  }
  for (const f of files) {
    if (/^(src|tests|scripts|packages|docs|benchmarks|runs)\//.test(f) || f.endsWith(".test.js"))
      problems.push(`unexpected ${f}`);
  }
  return problems;
}

const CONSUMER = `
import { readFileSync, writeFileSync } from "node:fs";
import { VERSION, compile, parse, tokenize } from "@promptlang/core";
import { MockClient, AnthropicClient } from "@promptlang/core/runtime";

const source = readFileSync(process.argv[2], "utf8");
const ts = compile(parse(tokenize(source)), "classify-ticket.prompt");
if (!ts.includes("export async function")) throw new Error("compile produced no function");
if (!ts.includes('from "@promptlang/core/runtime"')) throw new Error("generated code imports the wrong runtime");
writeFileSync("classify-ticket.ts", ts);
new AnthropicClient({ apiKey: "sk-consumer-test" });
const reply = await new MockClient([{ content: "ok" }]).complete({ model: "m", messages: [] });
if (reply.content !== "ok") throw new Error("MockClient did not answer");
console.log("node consumer ok", VERSION, process.version);
`;

/** Exercises the main entry point's declarations, which the generated file does not import. */
const LIBRARY_TYPES = `
import { analyze, compile, parse, tokenize, type Issue, type Program } from "@promptlang/core";
const program: Program = parse(tokenize("prompt p() -> string { user: \\"hi\\" }"));
const ts: string = compile(program, "p.prompt");
const issues: Issue[] = analyze([{ file: "p.prompt", ast: program }]);
export { ts, issues };
`;

/** The README's quick example: the first promptlang block and the first TypeScript block after "Use it". */
export function readmeQuickExample(readme: string): { prompt: string; usage: string } {
  const prompt = /```promptlang\n([\s\S]*?)```/.exec(readme)?.[1];
  const usage = /\bUse it\b[\s\S]*?```typescript\n([\s\S]*?)```/.exec(readme)?.[1];
  if (!prompt || !usage) throw new Error("README quick example not found");
  return { prompt, usage };
}

/** An application's settings: extensionless relative imports, as the README snippet uses. */
const APP_TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: [],
    lib: ["ES2022", "DOM"],
  },
  include: ["quickstart/**/*.ts"],
};

const TSCONFIG = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: [],
    lib: ["ES2022", "DOM"],
  },
  include: ["classify-ticket.ts", "library-types.ts"],
};

if (import.meta.main) {
  const work = await mkdtemp(join(tmpdir(), "promptlang-consumer-"));
  try {
    const packed = JSON.parse(
      run(["npm", "pack", "--json", "--pack-destination", work], ROOT)
    ) as Array<{
      filename: string;
      files: Array<{ path: string }>;
    }>;
    const problems = checkTarballFiles(packed[0]!.files.map((f) => f.path));
    if (problems.length > 0) throw new Error(`tarball contents:\n  ${problems.join("\n  ")}`);
    console.log(`tarball ok: ${packed[0]!.filename}, ${packed[0]!.files.length} files`);

    const app = join(work, "app");
    run(["mkdir", "-p", app], work);
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({ name: "app", private: true, type: "module" })
    );
    run(["npm", "install", "--no-audit", "--no-fund", join(work, packed[0]!.filename)], app);

    await writeFile(join(app, "consumer.mjs"), CONSUMER);
    process.stdout.write(
      run(["node", "consumer.mjs", join(ROOT, "docs/examples/classify-ticket.prompt")], app)
    );

    await writeFile(join(app, "tsconfig.json"), JSON.stringify(TSCONFIG));
    await writeFile(join(app, "library-types.ts"), LIBRARY_TYPES);
    run([join(ROOT, "node_modules/.bin/tsc"), "-p", "tsconfig.json"], app);
    console.log("generated code and library calls type-check against the installed package");

    const cli = join(app, "node_modules/.bin/promptlang");
    process.stdout.write(run([cli, "version"], app));

    const quick = join(app, "quickstart");
    run(["mkdir", "-p", quick], app);
    const { prompt, usage } = readmeQuickExample(await Bun.file(join(ROOT, "README.md")).text());
    await writeFile(join(quick, "classify-ticket.prompt"), prompt);
    // `process` is the one Node global the snippet reads; declared so no @types/node is needed.
    await writeFile(
      join(quick, "use.ts"),
      `declare const process: { env: Record<string, string | undefined> };\n${usage}`
    );
    process.stdout.write(run([cli, "test", "classify-ticket.prompt"], quick));
    run([cli, "compile", "classify-ticket.prompt", "--out", "./generated"], quick);
    await writeFile(join(app, "tsconfig.app.json"), JSON.stringify(APP_TSCONFIG));
    run([join(ROOT, "node_modules/.bin/tsc"), "-p", "tsconfig.app.json"], app);
    console.log("README quick example: tests pass, compiles, and its usage type-checks");

    // The installed CLI and the generated code it runs load the runtime from two
    // bundles; an answer of the wrong type must still be reported as a mismatch.
    const wrong = join(app, "wrong-type");
    run(["mkdir", "-p", wrong], app);
    await writeFile(
      join(wrong, "kind.prompt"),
      `@version "1.0.0"\ntype Kind = enum { bug, other }\nprompt kind(x: string) -> Kind {\n  user: "<t>{{x}}</t>"\n}\ntest "a wrong answer" {\n  input: kind("a")\n  mock: "feature"\n  expect: bug\n}\n`
    );
    const failed = Bun.spawnSync([cli, "test", "kind.prompt"], { cwd: wrong, stdout: "pipe" });
    const report = failed.stdout.toString();
    if (
      failed.exitCode === 0 ||
      !report.includes("kind output does not match its type: output: expected one of bug, other")
    )
      throw new Error(`a wrong-type answer was not reported as a type mismatch:\n${report}`);
    console.log("a wrong-type answer is reported as a type mismatch");
    console.log("consumer test: ok");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
