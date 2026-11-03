import type { PromptClient, PromptRequest, PromptResponse } from "../runtime";
import { PromptClientError } from "../runtime/errors";
import { CHARS_PER_TOKEN, callUsd, pricePerMTok } from "./cost";

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
 * What the estimates charge `request` at most: its input at characters ÷ 3 and
 * its whole max_tokens of output, on the rate card that input selects. Not a
 * hard bound: text that tokenizes at under 3 characters per token (CJK, base64,
 * dense code) costs more input, and near 100K tokens it can also move the call
 * to a long-context card that bills several times more. Not rounded per call:
 * the estimates round each card's input once, and a cap set to an estimate must
 * hold every call it counted.
 */
export function worstCaseUsd(request: PromptRequest): number {
  const chars = request.messages.reduce((n, m) => n + m.content.length, 0);
  return callUsd(request.model, chars / CHARS_PER_TOKEN, request.max_tokens ?? DEFAULT_MAX_TOKENS);
}

/**
 * Wraps the client of a paid run and enforces the approved spend in code: a call
 * is sent only if its estimated worst case fits in what is left, it reserves that
 * amount while in flight, so concurrent calls cannot all pass the check together,
 * and it is then charged what the provider reports. A call that fails, or reports
 * no usage, stays charged at its worst case: it may have been billed.
 *
 * The check happens before each call, so the spend can pass the cap only by
 * what the calls in flight cost beyond their estimate (input that tokenizes at
 * under 3 characters per token); the next call is then refused.
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
    if (!pricePerMTok(request.model))
      throw new BudgetExceededError(
        `budget: no price is recorded for model ${request.model}, so its cost cannot be capped; nothing was sent`
      );
    const worst = worstCaseUsd(request);
    // Sums of float dollars drift by ~1e-18; a run exactly at its estimate must fit.
    if (this.spent + this.reserved + worst > this.capUsd + 1e-12) {
      throw new BudgetExceededError(
        `budget: this call is estimated at up to $${worst.toFixed(6)}, and $${(this.spent + this.reserved).toFixed(6)} of the approved $${this.capUsd.toFixed(6)} is already spent or reserved; nothing was sent`
      );
    }
    this.reserved += worst;
    let charge = worst;
    try {
      const response = await this.inner.complete(request);
      if (response.usage)
        charge = callUsd(request.model, response.usage.input_tokens, response.usage.output_tokens);
      return response;
    } finally {
      this.reserved -= worst;
      this.spent += charge;
    }
  }
}
