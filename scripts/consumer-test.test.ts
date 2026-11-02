import { describe, expect, test } from "bun:test";
import { checkTarballFiles, readmeQuickExample } from "./consumer-test";

const GOOD = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/runtime/index.js",
  "dist/runtime/index.d.ts",
  "dist/cli/cli.js",
];

describe("checkTarballFiles", () => {
  test("accepts the build output", () => {
    expect(checkTarballFiles(GOOD)).toEqual([]);
  });
  test("names a missing entry point and any shipped source or test", () => {
    const files = [
      ...GOOD.filter((f) => f !== "dist/runtime/index.js"),
      "src/index.ts",
      "tests/a.test.ts",
    ];
    expect(checkTarballFiles(files)).toEqual([
      "missing dist/runtime/index.js",
      "unexpected src/index.ts",
      "unexpected tests/a.test.ts",
    ]);
  });
});

describe("readmeQuickExample", () => {
  test("finds the README's quick example and its usage snippet", async () => {
    const readme = await Bun.file(new URL("../README.md", import.meta.url)).text();
    const { prompt, usage } = readmeQuickExample(readme);
    expect(prompt).toContain("prompt classify_ticket(");
    expect(usage).toContain('from "@promptlang/core/runtime"');
  });
});
