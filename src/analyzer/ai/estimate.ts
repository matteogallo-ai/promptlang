import type { AnalysisContext } from "../analyzer";
import { type CostEstimate, priceEstimate } from "../../testing/cost";
import { AI_LINTER_MAX_TOKENS, AI_LINTER_MODEL } from "./ai-linter";
import { AI_LINTER_SYSTEM_PROMPT, buildAnalysisUserMessage } from "./prompts/analysis-prompt";

/**
 * Cost of one AI linter pass over `contexts`: one call per prompt, each at its
 * full max_tokens, no retries. Throws UnpricedModelError for an unpriced model.
 */
export function estimateLinterCost(
  contexts: AnalysisContext[],
  model: string = AI_LINTER_MODEL
): CostEstimate {
  const perCall: Array<{ chars: number; maxTokens: number }> = [];
  for (const ctx of contexts) {
    for (const d of ctx.ast.declarations) {
      if (d.kind !== "PromptDeclaration") continue;
      perCall.push({
        chars: AI_LINTER_SYSTEM_PROMPT.length + buildAnalysisUserMessage(d).length,
        maxTokens: AI_LINTER_MAX_TOKENS,
      });
    }
  }
  return priceEstimate(model, perCall);
}
