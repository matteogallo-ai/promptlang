import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { analyze } from "../src/analyzer/analyzer";
import { tokenize } from "../src/lexer/lexer";
import { parse } from "../src/parser/parser";
import { runTests } from "../src/testing/runner";
import { CLONE_URL, freshCloneCommand } from "../scripts/fresh-clone";

const ROOT = resolve(import.meta.dir, "..");
const readme = await Bun.file(resolve(ROOT, "README.md")).text();
const usage = await Bun.file(resolve(ROOT, "docs/usage.md")).text();
const promptlangBlocks = (doc: string) =>
  [...doc.matchAll(/```promptlang\n([\s\S]*?)```/g)].map((m) => m[1]!);
const quickExample = promptlangBlocks(readme)[0]!;
const testsSnippet = promptlangBlocks(usage)[0]!;

// The README's `promptlang` snippets are documentation that must stay true.
describe("README and docs/usage.md promptlang snippets", () => {
  test("the quick example passes promptlang test and the static analyzer", async () => {
    const program = parse(tokenize(quickExample));
    const results = await runTests(program, "README quick example", { kind: "mock" });
    expect(results.map((r) => r.failures)).toEqual([[], []]);
    expect(
      analyze([{ file: "README", ast: program }]).filter((i) => i.severity !== "info")
    ).toEqual([]);
  });

  test("the docs/usage.md Tests snippet passes against extract-invoice.prompt", async () => {
    const example = await Bun.file(resolve(ROOT, "docs/examples/extract-invoice.prompt")).text();
    const prompts = example.slice(0, example.indexOf("// --- Tests ---"));
    const results = await runTests(parse(tokenize(prompts + testsSnippet)), "README tests", {
      kind: "mock",
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.failures).toEqual([]);
  });
});

describe("README fresh-clone command", () => {
  test("is one command that clones the repository, installs from the lockfile and runs", () => {
    const command = freshCloneCommand(readme);
    expect(command).toStartWith(`git clone ${CLONE_URL} && cd promptlang && `);
    expect(command).toContain("bun install --frozen-lockfile");
  });

  test("a README without the markers, or cloning elsewhere, is rejected", () => {
    expect(() => freshCloneCommand("no markers")).toThrow("fresh-clone markers");
    const other =
      "<!-- fresh-clone:start -->\n```bash\ngit clone https://example.com/x.git && cd x\n```\n<!-- fresh-clone:end -->";
    expect(() => freshCloneCommand(other)).toThrow("must start with git clone");
  });
});
