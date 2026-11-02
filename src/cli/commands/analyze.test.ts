import { describe, expect, test } from "bun:test";
import { captureConsole } from "../../../tests/support/console";
import type { PromptClient } from "../../runtime/client";
import { confirmInTerminal } from "../live";
import { type AnalyzeDeps, runAnalyze } from "./analyze";

const FILE = "docs/examples/classify-ticket.prompt";

function deps(confirm: AnalyzeDeps["confirm"], calls: string[]): AnalyzeDeps {
  const client: PromptClient = {
    async complete(req) {
      calls.push(req.model);
      return { content: '{"issues": []}', usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
  return { createClient: () => client, confirm };
}

describe("analyze --ai cost approval", () => {
  test("prints the estimate, asks, and calls nothing when the answer is no", async () => {
    const calls: string[] = [];
    const questions: string[] = [];
    const r = await captureConsole(() =>
      runAnalyze(
        ["--ai", FILE],
        deps((q) => {
          questions.push(q);
          return false;
        }, calls)
      )
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("AI linter estimate: 1 call(s) on claude-haiku-5-5");
    expect(questions).toEqual([expect.stringMatching(/^Spend about \$0\.00\d+\? \[y\/N\] $/)]);
    expect(r.stderr).toContain("Aborted: no provider call was made.");
    expect(calls).toEqual([]);
  });

  test("--yes skips the question and makes one call per prompt", async () => {
    const calls: string[] = [];
    const r = await captureConsole(() =>
      runAnalyze(
        ["--ai", "--yes", FILE],
        deps(() => {
          throw new Error("confirm must not be called with --yes");
        }, calls)
      )
    );
    expect(r.code).toBe(0);
    expect(calls).toEqual(["claude-haiku-5-5"]);
  });

  test("without a terminal and without --yes, refuses before any call", async () => {
    const calls: string[] = [];
    const r = await captureConsole(() =>
      runAnalyze(
        ["--ai", FILE],
        deps((q) => confirmInTerminal("--ai", q), calls)
      )
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--ai without a terminal needs --yes to approve the cost");
    expect(calls).toEqual([]);
  });

  test("--yes without --ai is a usage error", async () => {
    const r = await captureConsole(() =>
      runAnalyze(
        ["--yes", FILE],
        deps(() => true, [])
      )
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--yes only applies to --ai");
  });
});
