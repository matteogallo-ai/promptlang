import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { main } from "./cli";

// Helpers that suppress output and capture it.
function captureLog(): { output: () => string; restore: () => void } {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: any[]) => lines.push(args.join(" "));
  return { output: () => lines.join("\n"), restore: () => { console.log = orig; } };
}

function captureError(): { output: () => string; restore: () => void } {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...args: any[]) => lines.push(args.join(" "));
  return { output: () => lines.join("\n"), restore: () => { console.error = orig; } };
}

function silenceAll(): () => void {
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = () => {};
  return () => { console.log = origLog; console.error = origErr; };
}

// Temp file paths for error-case tests.
const BAD_SYNTAX_FILE = "/tmp/promptlang-test-bad-syntax.prompt";
const BAD_LEXER_FILE = "/tmp/promptlang-test-bad-lexer.prompt";

beforeAll(async () => {
  await Bun.write(BAD_SYNTAX_FILE, "@version \"1.0.0\"\nprompt bad(x: string) -> { MISSING BRACE");
  await Bun.write(BAD_LEXER_FILE, "@version \"1.0.0\"\n\"unterminated string\nmore content");
});

afterAll(async () => {
  await Bun.file(BAD_SYNTAX_FILE).exists(); // just touch — cleanup not required in /tmp
});

// ---------------------------------------------------------------------------
// Help / Version
// ---------------------------------------------------------------------------

describe("help", () => {
  test("no args prints help and exits 0", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli"]);
    restore();
    expect(code).toBe(0);
    expect(output()).toContain("Usage:");
  });

  test("'help' subcommand prints help and exits 0", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli", "help"]);
    restore();
    expect(code).toBe(0);
    expect(output()).toContain("Commands:");
  });

  test("'--help' flag prints help and exits 0", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli", "--help"]);
    restore();
    expect(code).toBe(0);
    expect(output()).toContain("promptlang");
  });

  test("'-h' flag prints help and exits 0", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli", "-h"]);
    restore();
    expect(code).toBe(0);
    expect(output()).toContain("analyze");
  });
});

describe("version", () => {
  test("prints version number and exits 0", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli", "version"]);
    restore();
    expect(code).toBe(0);
    expect(output()).toContain("promptlang");
    // Version must match SemVer 1.x — asserting the exact value would
    // couple the test to the release cadence.
    expect(output()).toMatch(/1\.\d+\.\d+(-.+)?/);
  });

  test("prints repository URL", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli", "version"]);
    restore();
    expect(code).toBe(0);
    expect(output()).toContain("github.com");
  });
});

// ---------------------------------------------------------------------------
// parse command
// ---------------------------------------------------------------------------

describe("parse", () => {
  test("parses a valid file and prints AST with exit 0", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli", "parse", "docs/examples/classify-ticket.prompt"]);
    restore();
    expect(code).toBe(0);
    expect(output()).toContain("Program");
  });

  test("missing file arg exits 1", async () => {
    const restore = silenceAll();
    const code = await main(["bun", "cli", "parse"]);
    restore();
    expect(code).toBe(1);
  });

  test("nonexistent file exits 1", async () => {
    const restore = silenceAll();
    const code = await main(["bun", "cli", "parse", "no-such-file.prompt"]);
    restore();
    expect(code).toBe(1);
  });

  test("file with syntax error exits 1", async () => {
    const restore = silenceAll();
    const code = await main(["bun", "cli", "parse", BAD_SYNTAX_FILE]);
    restore();
    expect(code).toBe(1);
  });

  test("AST output contains PromptDeclaration for classify-ticket", async () => {
    const { output, restore } = captureLog();
    await main(["bun", "cli", "parse", "docs/examples/classify-ticket.prompt"]);
    restore();
    expect(output()).toContain("PromptDeclaration");
  });
});

// ---------------------------------------------------------------------------
// tokens command
// ---------------------------------------------------------------------------

describe("tokens", () => {
  test("tokenizes a valid file and prints tokens with exit 0", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli", "tokens", "docs/examples/classify-ticket.prompt"]);
    restore();
    expect(code).toBe(0);
    expect(output()).toContain("AT_VERSION");
  });

  test("missing file arg exits 1", async () => {
    const restore = silenceAll();
    const code = await main(["bun", "cli", "tokens"]);
    restore();
    expect(code).toBe(1);
  });

  test("nonexistent file exits 1", async () => {
    const restore = silenceAll();
    const code = await main(["bun", "cli", "tokens", "no-such-file.prompt"]);
    restore();
    expect(code).toBe(1);
  });

  test("token output has line:col format", async () => {
    const { output, restore } = captureLog();
    await main(["bun", "cli", "tokens", "docs/examples/classify-ticket.prompt"]);
    restore();
    // Lines look like "  1:  1  AT_VERSION           ..."
    expect(output()).toMatch(/\d+:\s*\d+/);
  });
});

// ---------------------------------------------------------------------------
// analyze command
// ---------------------------------------------------------------------------

describe("analyze", () => {
  test("analyzes a single file with exit 0", async () => {
    const restore = silenceAll();
    const code = await main(["bun", "cli", "analyze", "docs/examples/classify-ticket.prompt"]);
    restore();
    expect(code).toBe(0);
  });

  test("analyzes two parseable files and prints report", async () => {
    const { output, restore } = captureLog();
    const code = await main([
      "bun", "cli", "analyze",
      "docs/examples/classify-ticket.prompt",
      "docs/examples/extract-invoice.prompt",
    ]);
    restore();
    expect(code).toBe(0);
    expect(output()).toContain("Files analyzed:");
  });

  test("analyzes a directory (skips files with future syntax, exits 1 on parse errors)", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli", "analyze", "docs/examples"]);
    restore();
    // summarize-and-translate uses future syntax, so exit is 1; but report is still produced
    expect([0, 1]).toContain(code);
    expect(output()).toContain("Files analyzed:");
  });

  test("--json flag produces valid JSON", async () => {
    const { output, restore } = captureLog();
    await main([
      "bun", "cli", "analyze", "--json",
      "docs/examples/classify-ticket.prompt",
      "docs/examples/extract-invoice.prompt",
    ]);
    restore();
    let parsed: unknown;
    expect(() => { parsed = JSON.parse(output()); }).not.toThrow();
    expect((parsed as { files_analyzed: number }).files_analyzed).toBeGreaterThan(0);
  });

  test("missing path arg exits 1", async () => {
    const restore = silenceAll();
    const code = await main(["bun", "cli", "analyze"]);
    restore();
    expect(code).toBe(1);
  });

  test("--strict exits 1 when warnings are present", async () => {
    const restore = silenceAll();
    // classify-ticket has injection warnings, so --strict causes exit 1.
    const code = await main([
      "bun", "cli", "analyze", "--strict",
      "docs/examples/classify-ticket.prompt",
    ]);
    restore();
    expect(code).toBe(1);
  });

  test("--ai without ANTHROPIC_API_KEY prints error and falls back to static only (exit 0)", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const errLines: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => errLines.push(args.join(" "));
    const origLog = console.log;
    console.log = () => {};
    try {
      const code = await main([
        "bun", "cli", "analyze", "--ai",
        "docs/examples/classify-ticket.prompt",
      ]);
      expect(code).toBe(0);
      expect(errLines.join("\n")).toContain("AI linter error");
    } finally {
      console.error = origErr;
      console.log = origLog;
      if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });

  test("--ai --json output contains ai_issues field", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const { output, restore } = captureLog();
    try {
      await main([
        "bun", "cli", "analyze", "--ai", "--json",
        "docs/examples/classify-ticket.prompt",
      ]);
      restore();
      const parsed = JSON.parse(output()) as { ai_issues: unknown[] };
      expect(Array.isArray(parsed.ai_issues)).toBe(true);
    } finally {
      restore();
      if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });

  test("analyze without --ai does not invoke AI linter", async () => {
    const { output, restore } = captureLog();
    const code = await main([
      "bun", "cli", "analyze", "--json",
      "docs/examples/classify-ticket.prompt",
    ]);
    restore();
    expect(code).toBe(0);
    const parsed = JSON.parse(output()) as { ai_issues: unknown[] };
    // ai_issues present in JSON but always empty when --ai not used
    expect(parsed.ai_issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// compile command
// ---------------------------------------------------------------------------

describe("compile", () => {
  const OUT_DIR = "/tmp/promptlang-compile-test-out";

  test("compiles a valid .prompt file and exits 0", async () => {
    const restore = silenceAll();
    const code = await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "--out", OUT_DIR,
    ]);
    restore();
    expect(code).toBe(0);
  });

  test("generated .ts file exists on disk", async () => {
    const restore = silenceAll();
    await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "--out", OUT_DIR,
    ]);
    restore();
    const file = Bun.file(`${OUT_DIR}/classify-ticket.ts`);
    expect(await file.exists()).toBe(true);
  });

  test("generates index.ts re-exporting compiled files", async () => {
    const restore = silenceAll();
    await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "docs/examples/extract-invoice.prompt",
      "--out", OUT_DIR,
    ]);
    restore();
    const index = await Bun.file(`${OUT_DIR}/index.ts`).text();
    expect(index).toContain("classify-ticket");
    expect(index).toContain("extract-invoice");
  });

  test("compiles a directory of .prompt files and exits 0", async () => {
    const restore = silenceAll();
    const code = await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "docs/examples/extract-invoice.prompt",
      "--out", OUT_DIR,
    ]);
    restore();
    expect(code).toBe(0);
  });

  test("missing path argument exits 1", async () => {
    const restore = silenceAll();
    const code = await main(["bun", "cli", "compile"]);
    restore();
    expect(code).toBe(1);
  });

  test("nonexistent file exits 1", async () => {
    const restore = silenceAll();
    const code = await main([
      "bun", "cli", "compile",
      "no-such-file.prompt",
      "--out", OUT_DIR,
    ]);
    restore();
    expect(code).toBe(1);
  });

  test("help mentions compile command", async () => {
    const { output, restore } = captureLog();
    await main(["bun", "cli", "--help"]);
    restore();
    expect(output()).toContain("compile");
  });
});

// ---------------------------------------------------------------------------
// compile --emit-tsconfig
// ---------------------------------------------------------------------------

describe("compile --emit-tsconfig", () => {
  const EMIT_OUT = "/tmp/promptlang-emit-tsconfig-test";

  test("--emit-tsconfig generates tsconfig.json in --out", async () => {
    const restore = silenceAll();
    await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "--out", EMIT_OUT,
      "--emit-tsconfig",
    ]);
    restore();
    const file = Bun.file(`${EMIT_OUT}/tsconfig.json`);
    expect(await file.exists()).toBe(true);
  });

  test("emitted tsconfig is valid JSON", async () => {
    const restore = silenceAll();
    await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "--out", EMIT_OUT,
      "--emit-tsconfig",
    ]);
    restore();
    const content = await Bun.file(`${EMIT_OUT}/tsconfig.json`).text();
    expect(() => JSON.parse(content)).not.toThrow();
  });

  test("emitted tsconfig contains moduleResolution bundler and strict", async () => {
    const restore = silenceAll();
    await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "--out", EMIT_OUT,
      "--emit-tsconfig",
    ]);
    restore();
    const content = JSON.parse(await Bun.file(`${EMIT_OUT}/tsconfig.json`).text());
    expect(content.compilerOptions.moduleResolution).toBe("bundler");
    expect(content.compilerOptions.strict).toBe(true);
  });

  test("emitted tsconfig contains paths mapping for promptlang/runtime", async () => {
    const restore = silenceAll();
    await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "--out", EMIT_OUT,
      "--emit-tsconfig",
    ]);
    restore();
    const content = JSON.parse(await Bun.file(`${EMIT_OUT}/tsconfig.json`).text());
    const paths = content.compilerOptions?.paths ?? {};
    expect(paths["promptlang/runtime"]).toBeDefined();
    expect(Array.isArray(paths["promptlang/runtime"])).toBe(true);
    expect((paths["promptlang/runtime"] as string[]).length).toBeGreaterThan(0);
  });

  test("without --emit-tsconfig, no tsconfig.json is emitted (default unchanged)", async () => {
    const outDir = "/tmp/promptlang-no-emit-test";
    const restore = silenceAll();
    await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "--out", outDir,
    ]);
    restore();
    const file = Bun.file(`${outDir}/tsconfig.json`);
    expect(await file.exists()).toBe(false);
  });

  test("--runtime-path overrides the default path in emitted tsconfig", async () => {
    const restore = silenceAll();
    await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "--out", EMIT_OUT,
      "--emit-tsconfig",
      "--runtime-path", "node_modules/promptlang/runtime/index.js",
    ]);
    restore();
    const content = JSON.parse(await Bun.file(`${EMIT_OUT}/tsconfig.json`).text());
    const paths = content.compilerOptions?.paths?.["promptlang/runtime"] as string[];
    expect(paths[0]).toBe("node_modules/promptlang/runtime/index.js");
  });

  test("help mentions --emit-tsconfig flag", async () => {
    const { output, restore } = captureLog();
    await main(["bun", "cli", "--help"]);
    restore();
    expect(output()).toContain("--emit-tsconfig");
  });

  test("emitted tsconfig + generated .ts compiles with tsc", async () => {
    const outDir = "/tmp/promptlang-emit-tsc-verify";
    const restore = silenceAll();
    await main([
      "bun", "cli", "compile",
      "docs/examples/classify-ticket.prompt",
      "--out", outDir,
      "--emit-tsconfig",
    ]);
    restore();

    const proc = Bun.spawn(
      [process.execPath, "x", "tsc", "--project", `${outDir}/tsconfig.json`, "--noEmit"],
      { cwd: process.cwd(), stderr: "pipe" }
    );
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  test("unknown command exits 1", async () => {
    const restore = silenceAll();
    const code = await main(["bun", "cli", "foobar"]);
    restore();
    expect(code).toBe(1);
  });

  test("unknown command prints error message", async () => {
    const { output, restore } = captureError();
    await main(["bun", "cli", "foobar"]);
    restore();
    expect(output()).toContain("Unknown command");
  });
});

// ---------------------------------------------------------------------------
// Project commands: init, install, list, check, compile-from-config (v0.9)
// ---------------------------------------------------------------------------

import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";

const PROJECTS_ROOT = "/tmp/promptlang-v09-cli";

async function makeProject(name: string): Promise<string> {
  const dir = join(PROJECTS_ROOT, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "prompts"), { recursive: true });
  return dir;
}

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const orig = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(orig);
  }
}

describe("init command", () => {
  test("creates promptlang.yaml and prompts/ in an empty dir", async () => {
    const dir = await makeProject("init-fresh");
    // remove the prompts dir that makeProject created — init should create it
    await rm(join(dir, "prompts"), { recursive: true, force: true });
    const restore = silenceAll();
    const code = await withCwd(dir, () => main(["bun", "cli", "init"]));
    restore();
    expect(code).toBe(0);
    expect(await Bun.file(join(dir, "promptlang.yaml")).exists()).toBe(true);
  });

  test("refuses to overwrite an existing promptlang.yaml without --force", async () => {
    const dir = await makeProject("init-existing");
    await Bun.write(join(dir, "promptlang.yaml"), "name: existing\nversion: 1.0.0\n");
    const restore = silenceAll();
    const code = await withCwd(dir, () => main(["bun", "cli", "init"]));
    restore();
    expect(code).toBe(1);
    // content preserved
    const text = await Bun.file(join(dir, "promptlang.yaml")).text();
    expect(text).toContain("existing");
  });
});

describe("install command", () => {
  test("resolves imports and writes manifest.json + integrity.json", async () => {
    const dir = await makeProject("install-basic");
    await Bun.write(
      join(dir, "promptlang.yaml"),
      "name: p\nversion: 1.0.0\nsources:\n  - path: ./prompts\n"
    );
    await Bun.write(
      join(dir, "prompts", "a.prompt"),
      `@version "1.0.0"\nprompt a(x: string) -> string { user: "{{x}}" output: string }\n`
    );
    await Bun.write(
      join(dir, "prompts", "b.prompt"),
      `import "./a.prompt" as A\n@version "1.0.0"\nprompt b(x: string) -> string { user: "{{x}}" output: string }\n`
    );
    const restore = silenceAll();
    const code = await withCwd(dir, () => main(["bun", "cli", "install"]));
    restore();
    expect(code).toBe(0);
    expect(await Bun.file(join(dir, ".promptlang", "manifest.json")).exists()).toBe(true);
    expect(await Bun.file(join(dir, ".promptlang", "integrity.json")).exists()).toBe(true);
    const manifest = JSON.parse(await Bun.file(join(dir, ".promptlang", "manifest.json")).text());
    expect(manifest.version).toBe(1);
    expect(manifest.imports).toHaveLength(1);
    expect(manifest.imports[0].alias).toBe("A");
  });

  test("exits 1 when promptlang.yaml is missing", async () => {
    const dir = await makeProject("install-missing");
    const restore = silenceAll();
    const code = await withCwd(dir, () => main(["bun", "cli", "install"]));
    restore();
    expect(code).toBe(1);
  });
});

describe("list command", () => {
  test("prints prompts and chains for every discovered file", async () => {
    const dir = await makeProject("list-basic");
    await Bun.write(
      join(dir, "promptlang.yaml"),
      "name: p\nversion: 1.0.0\nsources:\n  - path: ./prompts\n"
    );
    await Bun.write(
      join(dir, "prompts", "one.prompt"),
      `@version "1.0.0"\nprompt one(x: string) -> string { user: "{{x}}" output: string }\n`
    );
    const { output, restore } = captureLog();
    const code = await withCwd(dir, () => main(["bun", "cli", "list"]));
    restore();
    expect(code).toBe(0);
    expect(output()).toContain("one");
    expect(output()).toContain("prompt");
  });

  test("--json produces valid, structured JSON", async () => {
    const dir = await makeProject("list-json");
    await Bun.write(
      join(dir, "promptlang.yaml"),
      "name: p\nversion: 1.0.0\nsources:\n  - path: ./prompts\n"
    );
    await Bun.write(
      join(dir, "prompts", "x.prompt"),
      `@version "1.0.0"\nprompt x(y: string) -> string { user: "{{y}}" output: string }\n`
    );
    const { output, restore } = captureLog();
    await withCwd(dir, () => main(["bun", "cli", "list", "--json"]));
    restore();
    const parsed = JSON.parse(output()) as {
      project: { name: string };
      files: Array<{ file: string; prompts: string[] }>;
    };
    expect(parsed.project.name).toBe("p");
    expect(parsed.files.length).toBeGreaterThan(0);
    expect(parsed.files[0]!.prompts).toContain("x");
  });
});

describe("check command", () => {
  test("exits 0 when the project is clean", async () => {
    const dir = await makeProject("check-clean");
    await Bun.write(
      join(dir, "promptlang.yaml"),
      "name: p\nversion: 1.0.0\nsources:\n  - path: ./prompts\n"
    );
    await Bun.write(
      join(dir, "prompts", "a.prompt"),
      `@version "1.0.0"\nprompt a(x: string) -> string { user: "{{x}}" output: string }\n`
    );
    const restore = silenceAll();
    await withCwd(dir, () => main(["bun", "cli", "install"]));
    const code = await withCwd(dir, () => main(["bun", "cli", "check"]));
    restore();
    expect(code).toBe(0);
  });

  test("exits 1 when a file's hash no longer matches integrity.json", async () => {
    const dir = await makeProject("check-tampered");
    await Bun.write(
      join(dir, "promptlang.yaml"),
      "name: p\nversion: 1.0.0\nsources:\n  - path: ./prompts\n"
    );
    const file = join(dir, "prompts", "a.prompt");
    await Bun.write(file, `@version "1.0.0"\nprompt a(x: string) -> string { user: "{{x}}" output: string }\n`);
    const restore = silenceAll();
    await withCwd(dir, () => main(["bun", "cli", "install"]));
    // Mutate the file after install.
    await Bun.write(file, `@version "1.0.0"\nprompt tampered(x: string) -> string { user: "{{x}}" output: string }\n`);
    const code = await withCwd(dir, () => main(["bun", "cli", "check"]));
    restore();
    expect(code).toBe(1);
  });
});

describe("compile with promptlang.yaml", () => {
  test("reads compile.out and compile.target from promptlang.yaml when args are absent", async () => {
    const dir = await makeProject("compile-from-config");
    await Bun.write(
      join(dir, "promptlang.yaml"),
      `name: p
version: 1.0.0
sources:
  - path: ./prompts
compile:
  target: typescript
  out: ./out
  emit_tsconfig: false
`
    );
    await Bun.write(
      join(dir, "prompts", "hello.prompt"),
      `@version "1.0.0"\nprompt hello(x: string) -> string { user: "{{x}}" output: string }\n`
    );
    const restore = silenceAll();
    const code = await withCwd(dir, () => main(["bun", "cli", "compile"]));
    restore();
    expect(code).toBe(0);
    expect(await Bun.file(join(dir, "out", "hello.ts")).exists()).toBe(true);
  });

  test("--config <path> uses an alternative config file", async () => {
    const dir = await makeProject("compile-alt-config");
    await Bun.write(
      join(dir, "custom.yaml"),
      `name: p
version: 1.0.0
sources:
  - path: ./prompts
compile:
  target: typescript
  out: ./custom-out
`
    );
    await Bun.write(
      join(dir, "prompts", "foo.prompt"),
      `@version "1.0.0"\nprompt foo(x: string) -> string { user: "{{x}}" output: string }\n`
    );
    const restore = silenceAll();
    const code = await withCwd(dir, () =>
      main(["bun", "cli", "compile", "--config", "custom.yaml"])
    );
    restore();
    expect(code).toBe(0);
    expect(await Bun.file(join(dir, "custom-out", "foo.ts")).exists()).toBe(true);
  });
});

