import type { Rule, AnalysisContext, Issue } from "../analyzer";
import type { PromptDeclaration } from "../../ast/nodes";

const TOKEN_THRESHOLD = 500;
const WORDS_TO_TOKENS_RATIO = 1.3;

/** Rough word count for a string. */
function countWords(s: string): number {
  return s.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Estimates the token count of each prompt (sum of all section content).
 * Reports an info-level issue for prompts exceeding the threshold.
 */
export const tokenCostEstimateRule: Rule = {
  name: "token-cost-estimate",
  severity: "info",

  check(context: AnalysisContext): Issue[] {
    const issues: Issue[] = [];

    const prompts = context.ast.declarations.filter(
      (d): d is PromptDeclaration => d.kind === "PromptDeclaration"
    );

    for (const prompt of prompts) {
      let totalWords = 0;

      for (const section of prompt.sections) {
        if (section.kind !== "MessageSection") continue;
        totalWords += countWords(section.content.value);
      }

      const estimatedTokens = Math.ceil(totalWords * WORDS_TO_TOKENS_RATIO);

      if (estimatedTokens > TOKEN_THRESHOLD) {
        issues.push({
          severity: "info",
          rule: "token-cost-estimate",
          file: context.file,
          line: prompt.line,
          column: prompt.column,
          message: `Prompt '${prompt.name}' is ~${estimatedTokens} tokens (estimated).`,
          suggestion:
            "Consider splitting or optimizing to reduce token usage and latency.",
        });
      }
    }

    return issues;
  },
};
