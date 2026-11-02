import { describe, expect, test } from "bun:test";
import type { PromptClient, PromptRequest } from "../runtime";
import { BudgetExceededError, BudgetedClient, worstCaseUsd } from "./budget";
import { priceEstimate } from "./cost";

// claude-haiku-5-5 is priced $0.1 / $0.5 per million tokens (src/testing/cost.ts).
const req = (chars: number, max_tokens = 1000): PromptRequest => ({
  model: "claude-haiku-5-5",
  max_tokens,
  messages: [{ role: "user", content: "x".repeat(chars) }],
});

function counting(usage = { input_tokens: 100, output_tokens: 100 }) {
  const calls: PromptRequest[] = [];
  const client: PromptClient = {
    async complete(r) {
      calls.push(r);
      return { content: "{}", usage };
    },
  };
  return { client, calls };
}

describe("BudgetedClient", () => {
  test("the worst case of a request is its input (chars ÷ 3) plus its whole max_tokens", () => {
    // 3000 chars → 1000 tokens × $0.1/M + 1000 × $0.5/M = $0.0006
    expect(worstCaseUsd(req(3000))).toBeCloseTo(0.0006, 10);
  });

  test("calls whose characters sum to the estimate's never pass a cap set to that estimate", async () => {
    // 1000 chars each: rounding each call up would charge 334 + 334 input tokens
    // against an estimate of ceil(2000 / 3) = 667.
    const calls: PromptRequest[] = [];
    const noUsage: PromptClient = {
      complete: async (r) => {
        calls.push(r);
        return { content: "{}" };
      },
    };
    const cap = priceEstimate("claude-haiku-5-5", 2, 2000, 0, 2000).estimatedUsd;
    const budgeted = new BudgetedClient(noUsage, cap);
    await budgeted.complete(req(1000));
    await budgeted.complete(req(1000));
    expect(calls).toHaveLength(2);
  });

  test("refuses a call whose worst case would pass the cap, without calling the provider", async () => {
    const { client, calls } = counting();
    const budgeted = new BudgetedClient(client, 0.0005);
    await expect(budgeted.complete(req(3000))).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toHaveLength(0);
  });

  test("charges what the provider reports, so a run within its estimate is never stopped", async () => {
    const { client, calls } = counting({ input_tokens: 1000, output_tokens: 200 });
    // Two calls at worst $0.0006 each: the estimate of this run is $0.0012.
    const budgeted = new BudgetedClient(client, 0.0012);
    await budgeted.complete(req(3000));
    await budgeted.complete(req(3000));
    expect(calls).toHaveLength(2);
    expect(budgeted.spentUsd).toBeCloseTo((2 * (1000 * 0.1 + 200 * 0.5)) / 1e6, 12);
  });

  test("stops the call that would pass the cap, after the calls the estimate covered", async () => {
    const { client, calls } = counting({ input_tokens: 1000, output_tokens: 1000 });
    const budgeted = new BudgetedClient(client, 0.0012);
    await budgeted.complete(req(3000));
    await budgeted.complete(req(3000));
    await expect(budgeted.complete(req(3000))).rejects.toThrow(/budget/);
    expect(calls).toHaveLength(2);
  });

  test("concurrent calls reserve their worst case before any of them returns", async () => {
    const { client, calls } = counting();
    const budgeted = new BudgetedClient(client, 0.0012);
    const results = await Promise.allSettled([1, 2, 3].map(() => budgeted.complete(req(3000))));
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(calls).toHaveLength(2);
  });

  // A failed call may still have been billed (a timeout can come after the provider
  // did the work), so it keeps its worst case: the cap never undercounts.
  test("a call without reported usage, or that failed, is charged its worst case", async () => {
    const noUsage: PromptClient = { complete: async () => ({ content: "{}" }) };
    const a = new BudgetedClient(noUsage, 0.01);
    await a.complete(req(3000));
    expect(a.spentUsd).toBeCloseTo(0.0006, 10);

    const failing: PromptClient = {
      complete: async () => {
        throw new Error("down");
      },
    };
    const b = new BudgetedClient(failing, 0.0006);
    await expect(b.complete(req(3000))).rejects.toThrow("down");
    expect(b.spentUsd).toBeCloseTo(0.0006, 10);
    await expect(b.complete(req(3000))).rejects.toBeInstanceOf(BudgetExceededError);
  });

  test("an unpriced model is refused before any call", async () => {
    const { client, calls } = counting();
    const budgeted = new BudgetedClient(client, 1);
    await expect(budgeted.complete({ ...req(10), model: "gpt-x" })).rejects.toThrow(/no price/);
    expect(calls).toHaveLength(0);
  });
});
