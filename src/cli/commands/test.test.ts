import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PromptClient } from "../../runtime/client";
import { InvalidRequestError, NetworkError } from "../../runtime/errors";
import { captureConsole } from "../../../tests/support/console";
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

const capture = captureConsole;

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
    expect(r.stderr).toContain("1 call(s) on claude-haiku-4-5");
    expect(r.stderr).toMatch(/total ≈ \$0\.000\d/);
    expect(r.stderr).toContain("Aborted: no provider call was made.");
  });

  test("runs against the provider once approved, ignoring mock, and reports usage", async () => {
    const file = await write("live-yes.prompt", failing);
    const calls: string[] = [];
    const r = await capture(() => runTest([file, "--live", "--json"], fakeDeps(true, calls)));
    expect(calls).toEqual(["claude-haiku-4-5"]);
    // The live client answers "bug", so the test whose mock says "other" passes.
    expect(r.code).toBe(0);
    // stdout is the JSON document alone; the estimate goes to stderr.
    const report = JSON.parse(r.stdout);
    expect(r.stderr).toContain("1 call(s) on claude-haiku-4-5");
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
    expect(r.stderr).toContain("no price is recorded for model llama3.1");
    expect(calls).toEqual(["claude-haiku-4-5"]);
  });

  test("provider down: exit 3 and an ERROR line, never a FAIL verdict", async () => {
    const file = await write("live-down.prompt", passing);
    const deps: TestCommandDeps = {
      createClient: () => ({
        async complete() {
          throw new NetworkError("fetch failed: ECONNREFUSED", "anthropic");
        },
      }),
      confirm: () => true,
    };
    const r = await capture(() => runTest([file, "--live", "--yes"], deps));
    expect(r.code).toBe(3);
    expect(r.stdout).toContain(`ERROR  ${file}:8  pass`);
    expect(r.stdout).toContain(
      "provider failure, no verdict (retry later): NetworkError: fetch failed: ECONNREFUSED"
    );
    expect(r.stdout).not.toContain("FAIL");
    expect(r.stdout).toContain("0 passed, 0 failed, 1 without a verdict (1 provider failure)");
  });

  test("a call that overspends stops the next test: exit 3, a configuration error, nothing sent", async () => {
    const file = await write("live-budget.prompt", passing + failing);
    let sent = 0;
    const deps: TestCommandDeps = {
      createClient: () => ({
        async complete() {
          sent++;
          return { content: "bug", usage: { input_tokens: 7, output_tokens: 1_000_000 } };
        },
      }),
      confirm: () => true,
    };
    const r = await capture(() => runTest([file, "--live", "--yes"], deps));
    expect(sent).toBe(1);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain(
      "configuration error, no verdict (fix the file, the key or the approved budget): BudgetExceededError: budget:"
    );
  });

  test("a template using an input twice still fits the cap set to its estimate", async () => {
    const twice = `@version "1.0.0"\n@model claude-haiku-4-5\n@max_tokens 10\ntype Kind = enum { bug, other }\nprompt classify(text: string) -> Kind {\n  user: "Classify: {{text}}. Again: {{text}}"\n}\ntest "long" {\n  input: classify("${"crash ".repeat(500)}")\n  mock: "bug"\n  expect: bug\n}\n`;
    const file = join(dir, "live-twice.prompt");
    await Bun.write(file, twice);
    let sent = 0;
    const deps: TestCommandDeps = {
      createClient: () => ({
        async complete() {
          sent++;
          return { content: "bug" };
        },
      }),
      confirm: () => true,
    };
    const r = await capture(() => runTest([file, "--live", "--yes"], deps));
    expect(r.stdout).not.toContain("BudgetExceededError");
    expect(sent).toBe(1);
    expect(r.code).toBe(0);
  });

  test("a chain step that inserts an earlier output, and a number argument, fit the cap set to the estimate", async () => {
    // Step a answers its full 100 tokens as 450 characters (English, ~4.5 per token),
    // which step b then sends: the estimate must allow for that text as the cap measures it.
    const source = `@version "1.0.0"\n@model claude-haiku-5-5\n@max_tokens 100\nprompt p(x: string) -> string {\n  user: "Rewrite: {{x}}"\n}\nprompt q(n: number) -> string {\n  user: "Score {{n}}"\n}\nchain c(x: string) -> string {\n  step a = p(x: x)\n  step b = p(x: a)\n  return b\n}\ntest "chain" {\n  input: c("hi")\n  expect contains: "w"\n}\ntest "number" {\n  input: q(123456789012)\n  expect contains: "w"\n}\n`;
    const file = join(dir, "live-chain.prompt");
    await Bun.write(file, source);
    let sent = 0;
    const deps: TestCommandDeps = {
      createClient: () => ({
        async complete(req) {
          sent++;
          return {
            content: "word ".repeat(90),
            usage: {
              input_tokens: Math.ceil(req.messages[0]!.content.length / 4),
              output_tokens: 100,
            },
          };
        },
      }),
      confirm: () => true,
    };
    const r = await capture(() => runTest([file, "--live", "--yes"], deps));
    expect(r.stdout).not.toContain("BudgetExceededError");
    expect(sent).toBe(3);
    expect(r.code).toBe(0);
  });

  test("a rejected request: exit 3, reported as a configuration error, not an outage", async () => {
    const file = await write("live-bad-request.prompt", passing);
    const deps: TestCommandDeps = {
      createClient: () => ({
        async complete() {
          throw new InvalidRequestError("max_tokens: too large for this model", "anthropic");
        },
      }),
      confirm: () => true,
    };
    const r = await capture(() => runTest([file, "--live", "--yes"], deps));
    expect(r.code).toBe(3);
    expect(r.stdout).toContain(
      "configuration error, no verdict (fix the file, the key or the approved budget): InvalidRequestError: max_tokens: too large for this model"
    );
    expect(r.stdout).toContain("0 passed, 0 failed, 1 without a verdict (1 configuration error)");
  });
});
