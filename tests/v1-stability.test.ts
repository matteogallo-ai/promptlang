import { describe, test, expect } from "bun:test";
import pkg from "../package.json";
import { main } from "../src/cli/cli";

/**
 * Regression tests pinning the v1.0 API surface. If any of these fail, we
 * have broken a documented stability promise and the change needs a proper
 * MAJOR-version release, not a MINOR or PATCH.
 */

describe("v1.0 stability: package metadata", () => {
  test("package.json version is 1.0.0 or a 1.x compatible successor", () => {
    expect(pkg.version).toMatch(/^1\.\d+\.\d+(-.+)?$/);
  });

  test("package.json name is 'promptlang'", () => {
    expect(pkg.name).toBe("promptlang");
  });

  test("bin entry exposes the CLI", () => {
    expect(pkg.bin).toBeDefined();
    expect((pkg.bin as Record<string, string>).promptlang).toBe(
      "./src/cli/cli.ts"
    );
  });

  test("runtime is exported at ./runtime for compiled stubs to import", () => {
    const exports_ = pkg.exports as Record<string, string>;
    expect(exports_["./runtime"]).toBe("./src/runtime/index.ts");
  });

  test("no runtime dependencies (dependencies field is absent or empty)", () => {
    const deps = (pkg as { dependencies?: Record<string, string> }).dependencies;
    if (deps !== undefined) {
      expect(Object.keys(deps)).toHaveLength(0);
    }
  });
});

describe("v1.0 stability: CLI surface", () => {
  function captureLog(): { output: () => string; restore: () => void } {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(" "));
    return {
      output: () => lines.join("\n"),
      restore: () => {
        console.log = orig;
      },
    };
  }

  test("help lists every documented command", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli", "--help"]);
    restore();
    expect(code).toBe(0);
    const help = output();
    for (const cmd of [
      "parse",
      "tokens",
      "analyze",
      "compile",
      "init",
      "install",
      "list",
      "check",
      "version",
    ]) {
      expect(help).toContain(cmd);
    }
  });

  test("version command prints the package version", async () => {
    const { output, restore } = captureLog();
    const code = await main(["bun", "cli", "version"]);
    restore();
    expect(code).toBe(0);
    expect(output()).toContain(pkg.version);
  });
});
