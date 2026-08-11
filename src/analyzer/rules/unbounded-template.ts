import type { Rule, AnalysisContext, Issue } from "../analyzer";
import type { PromptDeclaration } from "../../ast/nodes";

/** Extracts all {{variable}} references from a string. */
function extractTemplateVars(content: string): string[] {
  const matches = [...content.matchAll(/\{\{(\w+)\}\}/g)];
  return matches.map((m) => m[1]);
}

/**
 * Detects template variables inside prompt sections that are not declared
 * as parameters of the enclosing prompt.
 */
export const unboundedTemplateRule: Rule = {
  name: "unbounded-template",
  severity: "warning",

  check(context: AnalysisContext): Issue[] {
    const issues: Issue[] = [];

    const prompts = context.ast.declarations.filter(
      (d): d is PromptDeclaration => d.kind === "PromptDeclaration"
    );

    for (const prompt of prompts) {
      const paramNames = new Set(prompt.parameters.map((p) => p.name));

      for (const section of prompt.sections) {
        if (section.kind !== "MessageSection") continue;
        if (!section.content.isTemplate) continue;

        const vars = extractTemplateVars(section.content.value);
        for (const v of vars) {
          if (!paramNames.has(v)) {
            issues.push({
              severity: "warning",
              rule: "unbounded-template",
              file: context.file,
              line: section.content.line,
              column: section.content.column,
              message: `Template '{{${v}}}' references undefined parameter.`,
              suggestion: `Declared params: [${[...paramNames].join(", ")}].`,
            });
          }
        }
      }
    }

    return issues;
  },
};
