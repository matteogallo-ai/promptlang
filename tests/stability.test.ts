import { describe, test, expect } from "bun:test";
import pkg from "../package.json";
import { main } from "../src/cli/cli";

/**
 * Regression tests pinning the 3.x package surface. If any of these fail, a
 * documented stability promise is broken and the change needs a MAJOR
 * release, not a MINOR or PATCH.
 */

describe("3.x stability: package metadata", () => {
  test("package.json version is 3.0.0 or a 3.x compatible successor", () => {
    expect(pkg.version).toMatch(/^3\.\d+\.\d+(-.+)?$/);
  });

  // The unscoped `promptlang` name on npm belongs to a third party, so the package is
  // scoped; the CLI binary keeps the `promptlang` name (asserted below).
  test("package.json name is '@promptlang/core'", () => {
    expect(pkg.name).toBe("@promptlang/core");
  });

  // The npm page is read before the README: it names both compile targets and
  // claims nothing that docs/CLAIMS.md does not list.
  test("npm description and keywords match what is shipped", () => {
    expect(pkg.description).toBe("A typed language for LLM prompts");
    expect(pkg.keywords).toEqual(expect.arrayContaining(["typescript", "python"]));
  });

  test("bin entry exposes the CLI", () => {
    expect(pkg.bin).toBeDefined();
    expect((pkg.bin as Record<string, string>).promptlang).toBe("dist/cli/cli.js");
  });

  test("runtime is exported at ./runtime for compiled stubs to import", () => {
    const exports_ = pkg.exports as Record<string, unknown>;
    expect(exports_["./runtime"]).toEqual({
      types: "./dist/runtime/index.d.ts",
      import: "./dist/runtime/index.js",
    });
  });

  // npm reads the SPDX id from package.json; GitHub detects the licence from the LICENSE
  // text, which it matches as SPDX "MIT" only while that text stays unmodified.
  test("both packages declare the SPDX id MIT and ship the unmodified MIT licence text", async () => {
    const yamlPkg = await Bun.file(
      `${import.meta.dir}/../packages/yaml-parser/package.json`
    ).json();
    expect([pkg.license, yamlPkg.license]).toEqual(["MIT", "MIT"]);
    for (const dir of ["..", "../packages/yaml-parser"]) {
      const bytes = await Bun.file(`${import.meta.dir}/${dir}/LICENSE`).arrayBuffer();
      // SHA-256 of the MIT text with the "Copyright (c) 2026 Matteo Gallo" line.
      expect(new Bun.CryptoHasher("sha256").update(bytes).digest("hex")).toBe(
        "a53505f1c2f52f02edf6bb2990a37d7b54c7d3aac6ad9f1724efb6c0b424a477"
      );
    }
  });

  test("the published files are the build output, not the sources", () => {
    expect(pkg.files).toEqual(["dist", "README.md", "CHANGELOG.md", "LICENSE"]);
  });

  test("no third-party runtime dependencies (only first-party @promptlang/* allowed)", () => {
    const deps = (pkg as { dependencies?: Record<string, string> }).dependencies;
    if (deps === undefined) return;
    // First-party monorepo packages under the @promptlang/* scope are
    // permitted; anything else would break the zero-external-dep promise.
    const thirdParty = Object.keys(deps).filter((n) => !n.startsWith("@promptlang/"));
    expect(thirdParty).toHaveLength(0);
  });
});

describe("3.x stability: CLI surface", () => {
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
