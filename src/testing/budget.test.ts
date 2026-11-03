import { describe, expect, test } from "bun:test";
import type { PromptClient, PromptRequest } from "../runtime";
import { BudgetExceededError, BudgetedClient, worstCaseUsd } from "./budget";
import { callUsd, priceEstimate } from "./cost";

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
    const cap = priceEstimate("claude-haiku-5-5", 2, [1000, 1000], 2000).estimatedUsd;
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

  test("an unpriced model is refused before any call, as a budget error the runner classifies", async () => {
    const { client, calls } = counting();
    const budgeted = new BudgetedClient(client, 1);
    const refused = budgeted.complete({ ...req(10), model: "gpt-x" });
    await expect(refused).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(refused).rejects.toThrow(/no price/);
    expect(calls).toHaveLength(0);
  });
});

// Above a 100K-token prompt claude-haiku-5-5 bills $0.5 / $2.5 per million, five times its short rate.
describe("long-context rate card", () => {
  test("a prompt over 100K tokens is priced at the long-context rate, input and output", () => {
    expect(callUsd("claude-haiku-5-5", 100_000, 1000)).toBeCloseTo(
      (100_000 * 0.1 + 1000 * 0.5) / 1e6,
      12
    );
    expect(callUsd("claude-haiku-5-5", 100_001, 1000)).toBeCloseTo(
      (100_001 * 0.5 + 1000 * 2.5) / 1e6,
      12
    );
    expect(callUsd("claude-haiku-4-5", 200_000, 1000)).toBeCloseTo(
      (200_000 * 1 + 1000 * 5) / 1e6,
      12
    );
  });

  test("the worst case of a long request uses the long-context rate", () => {
    // 330 000 chars → 110 000 tokens × $0.5/M + 1000 × $2.5/M
    expect(worstCaseUsd(req(330_000))).toBeCloseTo(0.0575, 10);
  });

  test("a call charged from usage uses the rate of the prompt length the provider reports", async () => {
    // Estimated short (3000 chars), reported long: the charge follows the report.
    const { client } = counting({ input_tokens: 150_000, output_tokens: 100 });
    const budgeted = new BudgetedClient(client, 1);
    await budgeted.complete(req(3000));
    expect(budgeted.spentUsd).toBeCloseTo((150_000 * 0.5 + 100 * 2.5) / 1e6, 12);
  });

  test("an estimate prices each call on its own rate card, not the total on one", () => {
    // Two 60K-token prompts: each is short, though together they pass 100K.
    const e = priceEstimate("claude-haiku-5-5", 2, [180_000, 180_000], 2000);
    expect(e.estimatedUsd).toBeCloseTo((120_000 * 0.1 + 2000 * 0.5) / 1e6, 12);
    expect(e.inputTokens).toBe(120_000);
  });
});
