import { describe, expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import type { PromptClient } from "../runtime/client";
import { BudgetedClient } from "./budget";
import { estimateLiveCost, UnpricedModelError } from "./cost";
import { runTests } from "./runner";

const est = (source: string) => estimateLiveCost(parse(tokenize(source)));
// 30 characters of text plus the 5 of "{{x}}", where the argument is inserted.
const PROMPT = `prompt p(x: string) -> string {\n  user: "${"a".repeat(30)}{{x}}"\n}\n`;
const TEST = `test "t" {\n  input: p("${"b".repeat(9)}")\n  expect: x\n}\n`;

describe("estimateLiveCost", () => {
  test("input from message text and arguments; output at max_tokens; priced on @model", () => {
    const e = est(`@model claude-opus-5-5\n@max_tokens 100\n${PROMPT}${TEST}${TEST}`);
    // 2 calls × (35 + 9) chars / 3 → 30 input tokens; 2 × 100 output tokens.
    expect(e).toEqual({
      model: "claude-opus-5-5",
      calls: 2,
      inputTokens: 30,
      maxOutputTokens: 200,
      estimatedUsd: (30 * 4 + 200 * 20) / 1e6,
    });
  });

  test("an argument counts once per placeholder that inserts it, and not at all when unused", () => {
    const twice = `prompt p(x: string, y: string) -> string {\n  user: "{{x}} {{x}}"\n}\n`;
    const t = `test "t" {\n  input: p("${"b".repeat(30)}", "${"c".repeat(300)}")\n  expect: x\n}\n`;
    // 11 chars of template + 2 × 30; the unused 300-char argument is not sent.
    expect(est(`@model claude-haiku-5-5\n${twice}${t}`)?.inputTokens).toBe(Math.ceil(71 / 3));
  });

  test("output defaults to the client's 1024 max_tokens", () => {
    expect(est(`@model claude-haiku-4-5\n${PROMPT}${TEST}`)?.maxOutputTokens).toBe(1024);
  });

  test("a chain test counts one call per prompt step", () => {
    const chain = `chain c(x: string) -> string {\n  step a = p(x: x)\n  step b = p(x: a)\n  return b\n}\n`;
    const t = `test "t" {\n  input: c("x")\n  expect: x\n}\n`;
    const e = est(`@model claude-haiku-5-5\n@max_tokens 100\n${PROMPT}${chain}${t}`);
    expect(e?.calls).toBe(2);
    // Step a: 35 chars + at least the 15 of "[object Object]" for its "{{x}}". Step b's
    // "{{x}}" may insert step a's output: ≤100 tokens at up to 6 characters each.
    expect(e?.inputTokens).toBe(Math.ceil((35 + 15 + 35 + 600) / 3));
  });

  test("numbers, booleans and enum members count as the text they are inserted as", () => {
    const p = `prompt p(n: number) -> string {\n  user: "Score {{n}}"\n}\n`;
    const t = `test "t" {\n  input: p(123456789012)\n  expect: x\n}\n`;
    expect(est(`@model claude-haiku-5-5\n${p}${t}`)?.inputTokens).toBe(Math.ceil((11 + 12) / 3));
  });

  test("a literal written in a chain step counts, at every placeholder", () => {
    const chain = `chain c(x: string) -> string {\n  step a = p(x: "${"z".repeat(60)}")\n  return a\n}\n`;
    const t = `test "t" {\n  input: c("x")\n  expect: x\n}\n`;
    expect(est(`@model claude-haiku-5-5\n${PROMPT}${chain}${t}`)?.inputTokens).toBe(
      Math.ceil((35 + 60) / 3)
    );
  });

  test("no tests, no estimate; an unpriced or missing model refuses", () => {
    expect(est(`@model claude-opus-5-5\n${PROMPT}`)).toBeNull();
    expect(() => est(`@model llama3.1\n${PROMPT}${TEST}`)).toThrow(UnpricedModelError);
    expect(() => est(`${PROMPT}${TEST}`)).toThrow("no @model");
  });
});

describe("the estimate as a cap, end to end", () => {
  // Each program's test runs through the real generated code with the cap set to its
  // estimate; the provider answers every call with its whole max_tokens, as estimated.
  const p = (n = 1) => `prompt p(x: string) -> string {\n  user: "${"{{x}}".repeat(n)}"\n}\n`;
  const cases: Array<[string, string, number]> = [
    [
      "a call in the return expression",
      `${p()}chain c(x: string) -> string {\n  step a = p(x: x)\n  return p(x: a)\n}\n`,
      10,
    ],
    [
      "a call nested in an argument",
      `${p()}chain c(x: string) -> string {\n  step a = p(x: p(x: x))\n  return a\n}\n`,
      10,
    ],
    [
      "an absent optional argument, inserted as undefined",
      `prompt q(x: string, y?: string) -> string {\n  user: "{{x}}${"{{y}}".repeat(6)}"\n}\nchain c(x: string, y?: string) -> string {\n  step a = q(x: x, y: y)\n  return a\n}\n`,
      10,
    ],
    [
      "a member of a string, inserted as undefined",
      `${p(6)}chain c(x: string) -> string {\n  step a = p(x: x.foo)\n  return a\n}\n`,
      10,
    ],
    [
      "a struct output inserted whole",
      `prompt o(x: string) -> struct { a: string } {\n  user: "{{x}}"\n}\n${p(4)}chain c(x: string) -> string {\n  step s = o(x: x)\n  step b = p(x: s)\n  return b\n}\n`,
      1,
    ],
  ];
  for (const [name, decls, maxTokens] of cases) {
    test(`${name}: every call fits`, async () => {
      const source = `@model claude-haiku-5-5\n@max_tokens ${maxTokens}\n${decls}test "t" {\n  input: c("h")\n  expect: x\n}\n`;
      const program = parse(tokenize(source));
      const estimate = estimateLiveCost(program)!;
      let sent = 0;
      const client: PromptClient = {
        async complete(req) {
          sent++;
          const chars = req.messages.reduce((n, m) => n + m.content.length, 0);
          const struct = req.messages.some((m) => m.content === "h");
          return {
            content: struct ? '{"a":"w"}' : "w".repeat(maxTokens * 6),
            usage: { input_tokens: Math.ceil(chars / 3), output_tokens: maxTokens },
          };
        },
      };
      const [result] = await runTests(program, "t.prompt", {
        kind: "live",
        client: new BudgetedClient(client, estimate.estimatedUsd),
      });
      expect(result!.providerError).toBeUndefined();
      expect(sent).toBe(estimate.calls);
    });
  }
});
