import type { PromptClient, PromptRequest, PromptResponse } from "../runtime";
import { PromptClientError } from "../runtime/errors";
import { CHARS_PER_TOKEN, pricePerMTok, UnpricedModelError } from "./cost";

/** AnthropicClient's max_tokens when a request sets none. */
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Thrown before a call whose worst case would take the spend past the approved
 * cap. Nothing was sent. Retrying cannot help: only a larger approval can.
 */
export class BudgetExceededError extends PromptClientError {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/**
 * The most `request` can cost: its input at the estimate's rate (characters ÷ 3)
 * and its whole max_tokens of output. Not rounded per call: the estimates round
 * the total once, and a cap set to an estimate must hold every call it counted.
 */
export function worstCaseUsd(request: PromptRequest): number {
  const price = pricePerMTok(request.model);
  if (!price) throw new UnpricedModelError(`no price is recorded for model ${request.model}`);
  const chars = request.messages.reduce((n, m) => n + m.content.length, 0);
  const output = request.max_tokens ?? DEFAULT_MAX_TOKENS;
  return ((chars / CHARS_PER_TOKEN) * price[0] + output * price[1]) / 1e6;
}

/**
 * Wraps the client of a paid run and enforces the approved spend in code: each
 * call reserves its worst case before it is sent, so concurrent calls cannot
 * overshoot together, and is then charged what the provider reports. A call
 * that fails, or reports no usage, stays charged at its worst case: it may
 * have been billed.
 */
export class BudgetedClient implements PromptClient {
  private spent = 0;
  private reserved = 0;

  constructor(
    private readonly inner: PromptClient,
    readonly capUsd: number
  ) {}

  /** What the calls made so far cost, as far as the provider reported it. */
  get spentUsd(): number {
    return this.spent;
  }

  async complete(request: PromptRequest): Promise<PromptResponse> {
    const worst = worstCaseUsd(request);
    const price = pricePerMTok(request.model)!;
    // Sums of float dollars drift by ~1e-18; a run exactly at its estimate must fit.
    if (this.spent + this.reserved + worst > this.capUsd + 1e-12) {
      throw new BudgetExceededError(
        `budget: this call could cost up to $${worst.toFixed(4)}, and $${(this.spent + this.reserved).toFixed(4)} of the approved $${this.capUsd.toFixed(4)} is already spent or reserved; nothing was sent`
      );
    }
    this.reserved += worst;
    let charge = worst;
    try {
      const response = await this.inner.complete(request);
      if (response.usage)
        charge =
          (response.usage.input_tokens * price[0] + response.usage.output_tokens * price[1]) / 1e6;
      return response;
    } finally {
      this.reserved -= worst;
      this.spent += charge;
    }
  }
}
