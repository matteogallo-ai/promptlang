import { describe, expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import type { PromptClient } from "../runtime/client";
import { TimeoutError } from "../runtime/errors";
import { runTests } from "./runner";

const HEADER = `@version "1.0.0"\n@model claude-opus-5-5\n`;
const CLASSIFY = `type Kind = enum { bug, other }
prompt classify(text: string) -> Kind {
  user: "Classify: {{text}}"
}
`;
const EXTRACT = `type Invoice = struct { total: number, ref?: string }
prompt extract(doc: string) -> Invoice {
  user: "Extract: {{doc}}"
}
`;

async function run(body: string) {
  return runTests(parse(tokenize(HEADER + body)), "t.prompt", { kind: "mock" });
}

describe("runTests in mock mode", () => {
  test("an equality assertion passes on the parsed mock output", async () => {
    const [r] = await run(
      `${CLASSIFY}test "crash" {\n  input: classify("it crashes")\n  mock: "bug"\n  expect: bug\n}`
    );
    expect(r).toMatchObject({ test: "crash", line: 7, passed: true, failures: [], output: "bug" });
  });

  test("a failed equality names expected and actual", async () => {
    const [r] = await run(
      `${CLASSIFY}test "t" {\n  input: classify("x")\n  mock: "other"\n  expect: bug\n}`
    );
    expect(r?.failures).toEqual(['expect: expected "bug", got "other"']);
  });

  test("the generated code's own validation is the verdict when it throws", async () => {
    const [r] = await run(
      `${CLASSIFY}test "t" {\n  input: classify("x")\n  mock: "feature"\n  expect: bug\n}`
    );
    expect(r?.passed).toBe(false);
    expect(r?.failures).toEqual([
      "classify output does not match its type: output: expected one of bug, other, got a string",
    ]);
  });

  test("field equality, contains, matches and schema on a struct output", async () => {
    const mock = `"{\\"total\\": 120, \\"ref\\": \\"INV-7\\"}"`;
    const [r] = await run(
      `${EXTRACT}test "t" {\n  input: extract(doc: "Total 120")\n  mock: ${mock}\n  expect.total: 120\n  expect.ref contains: "INV"\n  expect.ref matches: "^INV-\\\\d+$"\n  expect schema\n}`
    );
    expect(r).toMatchObject({ passed: true, output: { total: 120, ref: "INV-7" } });
  });

  test("an answer outside the declared type fails the test before its assertions run", async () => {
    const mock = `"{\\"total\\": \\"120\\"}"`;
    const [r] = await run(
      `${EXTRACT}test "t" {\n  input: extract("x")\n  mock: ${mock}\n  expect.total contains: "1"\n  expect.ref matches: "x"\n  expect schema\n}`
    );
    expect(r?.failures).toEqual([
      "extract output does not match its type: output.total: expected number, got a string",
    ]);
  });

  test("a test without mock fails in mock mode, telling how to fix it", async () => {
    const [r] = await run(`${CLASSIFY}test "t" {\n  input: classify("x")\n  expect: bug\n}`);
    expect(r?.failures).toEqual([
      'no mock: response to replay; add `mock: "..."` to the test, or run with --live',
    ]);
  });

  test("a chain's model calls all receive the mock", async () => {
    const chain = `${CLASSIFY}chain twice(text: string) -> Kind {\n  step a = classify(text: text)\n  step b = classify(text: text)\n  return b\n}\n`;
    const [r] = await run(
      `${chain}test "t" {\n  input: twice("x")\n  mock: "bug"\n  expect: bug\n}`
    );
    expect(r?.passed).toBe(true);
  });

  test("a file without tests runs nothing", async () => {
    expect(await run(CLASSIFY)).toEqual([]);
  });
});

describe("runTests in live mode", () => {
  test("uses the given client, ignores mock, and reports token usage", async () => {
    const seen: string[] = [];
    const client: PromptClient = {
      async complete(req) {
        seen.push(req.messages.at(-1)?.content ?? "");
        return { content: "bug", usage: { input_tokens: 12, output_tokens: 1 } };
      },
    };
    const program = parse(
      tokenize(
        `${HEADER}${CLASSIFY}test "t" {\n  input: classify("boom")\n  mock: "other"\n  expect: bug\n}`
      )
    );
    const [r] = await runTests(program, "t.prompt", { kind: "live", client });
    expect(seen).toEqual(["Classify: boom"]);
    expect(r).toMatchObject({ passed: true, usage: { input_tokens: 12, output_tokens: 1 } });
  });

  test("a provider failure is reported as a provider error, not as a failed assertion", async () => {
    const client: PromptClient = {
      async complete() {
        throw new TimeoutError("Request timed out after 30000ms.", "anthropic");
      },
    };
    const program = parse(
      tokenize(`${HEADER}${CLASSIFY}test "t" {\n  input: classify("boom")\n  expect: bug\n}`)
    );
    const [r] = await runTests(program, "t.prompt", { kind: "live", client });
    expect(r).toMatchObject({
      passed: false,
      failures: [],
      providerError: {
        kind: "provider",
        message: "TimeoutError: Request timed out after 30000ms.",
      },
    });
  });
});
