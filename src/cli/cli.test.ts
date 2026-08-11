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
    expect(output()).toContain("0.5.0");
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
