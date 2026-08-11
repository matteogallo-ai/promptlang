import type { Rule, AnalysisContext, Issue } from "../analyzer";
import type { PromptDeclaration, TestDeclaration } from "../../ast/nodes";

/** Detects prompt declarations that have no corresponding test block in the same file. */
export const missingTestsRule: Rule = {
  name: "missing-tests",
  severity: "warning",

  check(context: AnalysisContext): Issue[] {
    const issues: Issue[] = [];

    const prompts = context.ast.declarations.filter(
      (d): d is PromptDeclaration => d.kind === "PromptDeclaration"
    );
    const tests = context.ast.declarations.filter(
      (d): d is TestDeclaration => d.kind === "TestDeclaration"
    );

    for (const prompt of prompts) {
      const hasTest = tests.some(
        (t) =>
          t.input.kind === "CallExpression" && t.input.callee === prompt.name
      );

      if (!hasTest) {
        issues.push({
          severity: "warning",
          rule: "missing-tests",
          file: context.file,
          line: prompt.line,
          column: prompt.column,
          message: `Prompt '${prompt.name}' has no tests.`,
          suggestion:
            "Add at least one test { input: ... expect: ... } block.",
        });
      }
    }

    return issues;
  },
};
