import { describe, expect, test } from "bun:test";
import type { PromptClient } from "../src/runtime/client";
import { BUDGET_USD, estimate, loadContexts, run } from "./ai-linter-live-run";

describe("ai-linter-live-run", () => {
  test("the worst-case estimate for the five prompts fits the approved budget", async () => {
    const e = estimate(await loadContexts());
    expect(e.calls).toBe(5);
    expect(e.maxUsd).toBeLessThanOrEqual(BUDGET_USD);
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
    const r = await run(client, await loadContexts(), new Date("2026-11-02T00:00:00Z"));
    expect(r).toMatchObject({
      model: "claude-haiku-4-5",
      usage: { input_tokens: 4000, output_tokens: 400 },
    });
    expect(r.calls).toHaveLength(4);
    // $1 / $5 per MTok: 4000 × 1 + 400 × 5 = 6000 micro-dollars.
    expect(r.cost_usd).toBeCloseTo(0.006, 10);
    expect(r.issues.map((i) => i.rule)).toEqual(["ai:request-failure"]);
  });
});
