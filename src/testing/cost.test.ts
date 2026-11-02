import { describe, expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { estimateLiveCost, UnpricedModelError } from "./cost";

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
    // Step a: 35 chars + the longest argument (1). Step b's "{{x}}" may insert step
    // a's output: ≤100 tokens at up to 6 characters each.
    expect(e?.inputTokens).toBe(Math.ceil((36 + 35 + 600) / 3));
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
