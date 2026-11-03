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

// The README quotes this estimate for `analyze --ai docs/examples/`; it must
// count what that command reads, subdirectories included.
test("the README's estimate for docs/examples/ matches what analyze would read", async () => {
  const { resolveFiles } = await import("../../cli/files");
  const files = await resolveFiles(["docs/examples/"]);
  const contexts = await Promise.all(files.map(async (file) => ctx(await Bun.file(file).text())));
  const e = estimateLinterCost(contexts);
  const readme = await Bun.file("README.md").text();
  const m = /(\w+) example files \((\w+) prompts\) cost about \$(\d+\.\d+)/.exec(readme);
  expect(m).not.toBeNull();
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  expect([words.indexOf(m![1]!), words.indexOf(m![2]!)]).toEqual([files.length, e.calls]);
  expect(Number(m![3])).toBeCloseTo(e.estimatedUsd, 2);
});
