import { describe, test, expect } from "bun:test";
import pkg from "../package.json";
import { main } from "../src/cli/cli";

/**
 * Regression tests pinning the 2.x package surface. If any of these fail, a
 * documented stability promise is broken and the change needs a MAJOR
 * release, not a MINOR or PATCH.
 */

describe("2.x stability: package metadata", () => {
  test("package.json version is 2.0.0 or a 2.x compatible successor", () => {
    expect(pkg.version).toMatch(/^2\.\d+\.\d+(-.+)?$/);
  });

  // The unscoped `promptlang` name on npm belongs to a third party, so the package is
  // scoped; the CLI binary keeps the `promptlang` name (asserted below).
  test("package.json name is '@promptlang/core'", () => {
    expect(pkg.name).toBe("@promptlang/core");
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

  // The SPDX id lives in each package.json, where npm and GitHub read it; the LICENSE
  // text stays the unmodified MIT text, which GitHub's detection matches as "MIT".
  test("both packages declare the SPDX id MIT and ship the MIT licence text", async () => {
    const yamlPkg = await Bun.file(
      `${import.meta.dir}/../packages/yaml-parser/package.json`
    ).json();
    expect([pkg.license, yamlPkg.license]).toEqual(["MIT", "MIT"]);
    for (const dir of ["..", "../packages/yaml-parser"]) {
      const text = await Bun.file(`${import.meta.dir}/${dir}/LICENSE`).text();
      expect(text.startsWith("MIT License\n")).toBe(true);
      expect(text).toContain("Permission is hereby granted, free of charge");
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

describe("2.x stability: CLI surface", () => {
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
