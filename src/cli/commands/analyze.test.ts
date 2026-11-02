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
        deps((q) => confirmInTerminal("--ai", q, false), calls)
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

describe("analyze --ai budget cap", () => {
  test("a call that overspends stops the calls after it: the approved estimate is a cap", async () => {
    const files = [
      "docs/examples/classify-ticket.prompt",
      "docs/examples/extract-invoice.prompt",
      "docs/examples/summarize-and-translate.prompt",
      "docs/ai-linter-run/adversarial.prompt",
    ];
    let sent = 0;
    const overspending: AnalyzeDeps = {
      createClient: () => ({
        async complete() {
          sent++;
          // Far more than any max_tokens: the provider billed beyond the estimate.
          return {
            content: '{"issues": []}',
            usage: { input_tokens: 1, output_tokens: 1_000_000 },
          };
        },
      }),
      confirm: () => true,
    };
    const r = await captureConsole(() =>
      runAnalyze(["--ai", "--yes", "--json", ...files], overspending)
    );
    const issues = JSON.parse(r.stdout).ai_issues as { rule: string; message: string }[];
    const refused = issues.filter((i) => i.rule === "ai:request-failure");
    // Five prompts in batches of three: the first batch is sent, the second is refused.
    expect(sent).toBe(3);
    expect(refused).toHaveLength(2);
    expect(refused[0]!.message).toContain("budget:");
    expect(refused[0]!.message).toContain("nothing was sent");
  });
});
