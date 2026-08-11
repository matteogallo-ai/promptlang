import type { Rule, AnalysisContext, Issue } from "../analyzer";
import type { ChainDeclaration } from "../../ast/nodes";

const STEP_THRESHOLD = 5;

/**
 * Flags chains with more than 5 steps as potentially hard to maintain,
 * similar to cyclomatic complexity warnings in traditional linters.
 */
export const chainComplexityRule: Rule = {
  name: "chain-complexity",
  severity: "warning",

  check(context: AnalysisContext): Issue[] {
    const issues: Issue[] = [];

    const chains = context.ast.declarations.filter(
      (d): d is ChainDeclaration => d.kind === "ChainDeclaration"
    );

    for (const chain of chains) {
      if (chain.steps.length > STEP_THRESHOLD) {
        issues.push({
          severity: "warning",
          rule: "chain-complexity",
          file: context.file,
          line: chain.line,
          column: chain.column,
          message: `Chain '${chain.name}' has ${chain.steps.length} steps.`,
          suggestion:
            "Consider splitting into sub-chains for better maintainability.",
        });
      }
    }

    return issues;
  },
};
