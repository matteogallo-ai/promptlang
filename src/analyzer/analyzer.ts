import type { Program } from "../ast/nodes";
import { missingTestsRule } from "./rules/missing-tests";
import { unboundedTemplateRule } from "./rules/unbounded-template";
import { promptInjectionRiskRule } from "./rules/prompt-injection-risk";
import { tokenCostEstimateRule } from "./rules/token-cost-estimate";
import { chainComplexityRule } from "./rules/chain-complexity";
import { duplicatePromptsRule } from "./rules/duplicate-prompts";

export interface Issue {
  severity: "error" | "warning" | "info";
  rule: string;
  file: string;
  line: number;
  column: number;
  message: string;
  suggestion?: string;
}

export interface AnalysisContext {
  file: string;
  ast: Program;
}

export interface Rule {
  name: string;
  severity: "error" | "warning" | "info";
  check(context: AnalysisContext, allFiles?: AnalysisContext[]): Issue[];
}

const RULES: Rule[] = [
  missingTestsRule,
  unboundedTemplateRule,
  promptInjectionRiskRule,
  tokenCostEstimateRule,
  chainComplexityRule,
  duplicatePromptsRule,
];

export function analyze(contexts: AnalysisContext[]): Issue[] {
  const issues: Issue[] = [];
  for (const rule of RULES) {
    for (const context of contexts) {
      issues.push(...rule.check(context, contexts));
    }
  }
  return issues;
}
