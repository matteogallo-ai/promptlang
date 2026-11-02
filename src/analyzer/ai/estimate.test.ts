import { describe, expect, test } from "bun:test";
import { tokenize } from "../../lexer/lexer";
import { parse } from "../../parser/parser";
import { UnpricedModelError } from "../../testing/cost";
import { estimateLinterCost } from "./estimate";

const ctx = (source: string) => ({ file: "f.prompt", ast: parse(tokenize(source)) });
const TWO = `prompt a(x: string) -> string {\n  user: "A {{x}}"\n}\nprompt b() -> string {\n  user: "B"\n}\n`;

describe("estimateLinterCost", () => {
  test("one call per prompt, each at the linter's full max_tokens", () => {
    const e = estimateLinterCost([ctx(TWO)]);
    expect(e).toMatchObject({ model: "claude-haiku-5-5", calls: 2, maxOutputTokens: 8192 });
    // $0.10 / $0.50 per MTok.
    expect(e.estimatedUsd).toBeCloseTo((e.inputTokens * 0.1 + 8192 * 0.5) / 1e6, 12);
  });

  test("no prompt, no call, no cost", () => {
    expect(estimateLinterCost([ctx(`type T = string\n`)])).toMatchObject({
      calls: 0,
      estimatedUsd: 0,
    });
  });

  test("refuses a model with no recorded price", () => {
    expect(() => estimateLinterCost([ctx(TWO)], "gpt-5")).toThrow(UnpricedModelError);
  });
});
