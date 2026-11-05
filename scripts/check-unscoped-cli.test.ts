import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { scanRepository, scanText } from "./check-unscoped-cli";

function flagged(line: string): boolean {
  return scanText("f.md", line).length === 1;
}

describe("check-unscoped-cli: scanText", () => {
  test("flags the unscoped package with every runner", () => {
    expect(flagged("npx promptlang test classify-ticket.prompt")).toBe(true);
    expect(flagged("npx -y promptlang compile x.prompt")).toBe(true);
    expect(flagged("npx --yes promptlang")).toBe(true);
    expect(flagged("bunx promptlang test")).toBe(true);
    expect(flagged("pnpx promptlang test")).toBe(true);
    expect(flagged("pnpm dlx promptlang test")).toBe(true);
    expect(flagged("yarn dlx promptlang test")).toBe(true);
    expect(flagged("npm exec promptlang -- test")).toBe(true);
    expect(flagged("npm x promptlang test")).toBe(true);
    expect(flagged("Run `npx promptlang test` first.")).toBe(true);
    expect(flagged('"demo": "npx promptlang compile"')).toBe(true);
    expect(flagged("bun x promptlang test")).toBe(true);
  });

  test("flags a version suffix, `--`, flag values and package flags", () => {
    expect(flagged("npx promptlang@latest test")).toBe(true);
    expect(flagged("npx promptlang@1.0.0 test")).toBe(true);
    expect(flagged("bunx promptlang@latest test")).toBe(true);
    expect(flagged("npm exec -- promptlang test")).toBe(true);
    expect(flagged("npx -y -- promptlang test")).toBe(true);
    expect(flagged("npx --yes=true promptlang")).toBe(true);
    expect(flagged("npx -p promptlang promptlang")).toBe(true);
    expect(flagged("npx --package=promptlang promptlang")).toBe(true);
    expect(flagged("npm exec --package=promptlang -- promptlang")).toBe(true);
  });

  test("flags Markdown and HTML contexts", () => {
    expect(flagged("<code>npx promptlang test</code>")).toBe(true);
    expect(flagged("[npx promptlang](x)")).toBe(true);
    expect(flagged("*npx promptlang*")).toBe(true);
    expect(flagged("$ npx promptlang test")).toBe(true);
  });

  test("flags installs of the unscoped package", () => {
    expect(flagged("npm i -g promptlang")).toBe(true);
    expect(flagged("npm install promptlang")).toBe(true);
    expect(flagged("npm install -D typescript promptlang")).toBe(true);
    expect(flagged("bun add -g promptlang")).toBe(true);
    expect(flagged("bun install -g promptlang")).toBe(true);
    expect(flagged("pnpm add promptlang@3")).toBe(true);
    expect(flagged("yarn add promptlang")).toBe(true);
    expect(flagged("yarn global add promptlang")).toBe(true);
  });

  test("joins a command continued with a backslash, reports its first line", () => {
    expect(scanText("f.md", "x\nnpx -y \\\n  promptlang test\n")).toEqual([
      { file: "f.md", line: 2, excerpt: "npx -y \\" },
    ]);
  });

  test("accepts the scoped package and the installed binary", () => {
    expect(flagged("npx @promptlang/core test classify-ticket.prompt")).toBe(false);
    expect(flagged("npx -y @promptlang/core compile x.prompt")).toBe(false);
    expect(flagged("npx -p @promptlang/core promptlang test")).toBe(false);
    expect(flagged("npx --package=@promptlang/core promptlang test")).toBe(false);
    expect(flagged("bunx @promptlang/core test")).toBe(false);
    expect(flagged("promptlang test classify-ticket.prompt")).toBe(false);
    expect(flagged("npm install @promptlang/core")).toBe(false);
    expect(flagged("npx promptlang-other test")).toBe(false);
    expect(flagged("npx --package @promptlang/core promptlang test")).toBe(false);
    expect(flagged("npm exec --package=@promptlang/core -- promptlang test")).toBe(false);
    expect(flagged("npm install @promptlang/core && promptlang test")).toBe(false);
    expect(flagged("npx @promptlang/core compile promptlang.prompt")).toBe(false);
    expect(flagged("bun add @promptlang/core; npx tsc promptlang")).toBe(false);
  });

  test("reports file and line", () => {
    expect(scanText("README.md", "ok\nnpx promptlang test\n")).toEqual([
      { file: "README.md", line: 2, excerpt: "npx promptlang test" },
    ]);
  });
});

describe("check-unscoped-cli: repository", () => {
  test("no tracked file runs the unscoped promptlang package", async () => {
    expect(await scanRepository(join(import.meta.dir, ".."))).toEqual([]);
  });
});
