import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PromptClient } from "../../runtime/client";
import { runTest, type TestCommandDeps } from "./test";

let dir: string;
const HEADER = `@version "1.0.0"\n@model claude-haiku-4-5\n@max_tokens 10\n`;
const PROMPT = `type Kind = enum { bug, other }\nprompt classify(text: string) -> Kind {\n  user: "Classify: {{text}}"\n}\n`;
const passing = `test "pass" {\n  input: classify("crash")\n  mock: "bug"\n  expect: bug\n}\n`;
const failing = `test "fail" {\n  input: classify("crash")\n  mock: "other"\n  expect: bug\n}\n`;

async function write(name: string, body: string): Promise<string> {
  const file = join(dir, name);
  await Bun.write(file, HEADER + PROMPT + body);
  return file;
}

async function capture(fn: () => Promise<number>) {
  const out: string[] = [];
  const err: string[] = [];
  const [log, error, warn] = [console.log, console.error, console.warn];
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  console.error = (...a: unknown[]) => err.push(a.join(" "));
  console.warn = (...a: unknown[]) => err.push(a.join(" "));
  try {
    const code = await fn();
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    [console.log, console.error, console.warn] = [log, error, warn];
  }
}

function fakeDeps(answer: boolean, calls: string[] = []): TestCommandDeps {
  const client: PromptClient = {
    async complete(req) {
      calls.push(req.model);
      return { content: "bug", usage: { input_tokens: 7, output_tokens: 1 } };
    },
  };
  return { createClient: () => client, confirm: () => answer };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "promptlang-test-cmd-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("promptlang test (mock mode)", () => {
  test("passing tests exit 0 with a readable report", async () => {
    const file = await write("ok.prompt", passing);
    const r = await capture(() => runTest([file]));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`pass   ${file}:8  pass`);
    expect(r.stdout).toContain("1 passed, 0 failed");
  });

  test("a failing test exits 1 and shows the failed assertion", async () => {
    const file = await write("bad.prompt", passing + failing);
    const r = await capture(() => runTest([file]));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(`FAIL   ${file}:13  fail`);
    expect(r.stdout).toContain('expect: expected "bug", got "other"');
    expect(r.stdout).toContain("1 passed, 1 failed");
  });

  test("--json reports results and zero usage in mock mode", async () => {
    const file = await write("json.prompt", failing);
    const r = await capture(() => runTest([file, "--json"]));
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report).toMatchObject({
      ok: false,
      mode: "mock",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    expect(report.files[0].results[0]).toMatchObject({ test: "fail", passed: false });
  });

  test("a test on an unknown prompt is reported as a file error, exit 1", async () => {
    const file = await write(
      "unknown.prompt",
      `test "t" {\n  input: nope("x")\n  expect: bug\n}\n`
    );
    const r = await capture(() => runTest([file]));
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("ERROR");
    expect(r.stdout).toContain("input calls 'nope'");
  });

  test("eval blocks produce the not-executed warning", async () => {
    const file = await write(
      "eval.prompt",
      `${passing}eval "e" {\n  dataset: "d.jsonl"\n  prompt: classify\n  metric: accuracy\n  threshold: 0.9\n}\n`
    );
    const r = await capture(() => runTest([file]));
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("eval blocks are parsed but not executed in this version");
  });

  test("usage errors exit 2", async () => {
    expect((await capture(() => runTest([]))).code).toBe(2);
    expect((await capture(() => runTest(["x.prompt", "--bogus"]))).code).toBe(2);
    expect((await capture(() => runTest(["x.prompt", "--yes"]))).code).toBe(2);
  });
});

describe("promptlang test --live", () => {
  test("prints the cost estimate before any call and stops when not approved", async () => {
    const file = await write("live-no.prompt", passing);
    const calls: string[] = [];
    const r = await capture(() => runTest([file, "--live"], fakeDeps(false, calls)));
    expect(r.code).toBe(2);
    expect(calls).toEqual([]);
    expect(r.stdout).toContain("1 call(s) on claude-haiku-4-5");
    expect(r.stdout).toMatch(/total ≤ \$0\.000\d/);
    expect(r.stderr).toContain("Aborted: no provider call was made.");
  });

  test("runs against the provider once approved, ignoring mock, and reports usage", async () => {
    const file = await write("live-yes.prompt", failing);
    const calls: string[] = [];
    const r = await capture(() => runTest([file, "--live", "--json"], fakeDeps(true, calls)));
    expect(calls).toEqual(["claude-haiku-4-5"]);
    // The live client answers "bug", so the test whose mock says "other" passes.
    expect(r.code).toBe(0);
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf("{")));
    expect(report).toMatchObject({
      ok: true,
      mode: "live",
      usage: { input_tokens: 7, output_tokens: 1 },
    });
  });

  test("--yes skips the question; an unpriced model refuses before any call", async () => {
    const calls: string[] = [];
    const ok = await write("live-auto.prompt", passing);
    const asked: string[] = [];
    const deps = {
      ...fakeDeps(false, calls),
      confirm: (q: string) => {
        asked.push(q);
        return false;
      },
    };
    expect((await capture(() => runTest([ok, "--live", "--yes"], deps))).code).toBe(0);
    expect(asked).toEqual([]);

    const unpriced = join(dir, "unpriced.prompt");
    await Bun.write(unpriced, `@version "1.0.0"\n@model llama3.1\n${PROMPT}${passing}`);
    const r = await capture(() => runTest([unpriced, "--live", "--yes"], fakeDeps(true, calls)));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("no price is recorded for @model llama3.1");
    expect(calls).toEqual(["claude-haiku-4-5"]);
  });
});
