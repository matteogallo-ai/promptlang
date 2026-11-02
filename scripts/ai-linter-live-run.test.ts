import { describe, expect, test } from "bun:test";
import type { PromptClient } from "../src/runtime/client";
import { estimateLinterCost } from "../src/analyzer/ai/estimate";
import { BUDGET_USD, loadContexts, run } from "./ai-linter-live-run";

describe("ai-linter-live-run", () => {
  test("the estimate for the five prompts fits the approved budget", async () => {
    const e = estimateLinterCost(await loadContexts());
    expect(e.calls).toBe(5);
    expect(e.estimatedUsd).toBeLessThanOrEqual(BUDGET_USD);
  });

  test("records model, per-call usage, cost from usage, and failures as issues", async () => {
    let n = 0;
    const client: PromptClient = {
      async complete() {
        n++;
        if (n === 2) throw new Error("overloaded_error");
        return { content: '{"issues": []}', usage: { input_tokens: 1000, output_tokens: 100 } };
      },
    };
    const r = await run(
      client,
      await loadContexts(),
      new Date("2026-11-02T00:00:00Z"),
      "2026-10-21"
    );
    expect(r).toMatchObject({
      model: "claude-haiku-5-5",
      usage: { input_tokens: 4000, output_tokens: 400 },
    });
    expect(r.calls).toHaveLength(4);
    // $0.10 / $0.50 per MTok: 4000 × 0.1 + 400 × 0.5 = 600 micro-dollars.
    expect(r.cost_usd).toBeCloseTo(0.0006, 10);
    expect(r.issues.map((i) => i.rule)).toEqual(["ai:request-failure"]);
    expect(r.outcome).toBe("provider-errors");
    expect(r.anthropic_version).toBe("2026-10-21");
    expect(r.files).toContainEqual({
      file: "docs/examples/classify-ticket.prompt",
      version: "2.0.0",
    });
  });
});
