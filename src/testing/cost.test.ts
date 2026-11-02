import { describe, expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { estimateLiveCost, UnpricedModelError } from "./cost";

const est = (source: string) => estimateLiveCost(parse(tokenize(source)));
// 30 characters of message text, so 10 input tokens per call before arguments.
const PROMPT = `prompt p(x: string) -> string {\n  user: "${"a".repeat(30)}"\n}\n`;
const TEST = `test "t" {\n  input: p("${"b".repeat(9)}")\n  expect: x\n}\n`;

describe("estimateLiveCost", () => {
  test("input from message text and arguments; output at max_tokens; priced on @model", () => {
    const e = est(`@model claude-opus-5-5\n@max_tokens 100\n${PROMPT}${TEST}${TEST}`);
    // 2 calls × (30 + 9) chars / 3 = 26 input tokens; 2 × 100 output tokens.
    expect(e).toEqual({
      model: "claude-opus-5-5",
      calls: 2,
      inputTokens: 26,
      maxOutputTokens: 200,
      maxUsd: (26 * 4 + 200 * 20) / 1e6,
    });
  });

  test("output defaults to the client's 1024 max_tokens", () => {
    expect(est(`@model claude-haiku-4-5\n${PROMPT}${TEST}`)?.maxOutputTokens).toBe(1024);
  });

  test("a chain test counts one call per prompt step", () => {
    const chain = `chain c(x: string) -> string {\n  step a = p(x: x)\n  step b = p(x: a)\n  return b\n}\n`;
    const t = `test "t" {\n  input: c("x")\n  expect: x\n}\n`;
    expect(est(`@model claude-haiku-5-5\n${PROMPT}${chain}${t}`)?.calls).toBe(2);
  });

  test("no tests, no estimate; an unpriced or missing model refuses", () => {
    expect(est(`@model claude-opus-5-5\n${PROMPT}`)).toBeNull();
    expect(() => est(`@model llama3.1\n${PROMPT}${TEST}`)).toThrow(UnpricedModelError);
    expect(() => est(`${PROMPT}${TEST}`)).toThrow("no @model");
  });
});
