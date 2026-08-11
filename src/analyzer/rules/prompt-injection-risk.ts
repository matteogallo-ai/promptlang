import type { Rule, AnalysisContext, Issue } from "../analyzer";
import type { PromptDeclaration } from "../../ast/nodes";

/** Extracts all {{variable}} names from a string. */
function extractTemplateVars(content: string): string[] {
  return [...content.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
}

/**
 * Returns true if the content contains delimiters that clearly separate
 * user-controlled input from the surrounding instructions.
 */
function isDelimited(content: string): boolean {
  return /---|```|<[A-Za-z_]+>|<BEGIN>|<END>|\[\[|\]\]/.test(content);
}

/**
 * Flags user-role sections that interpolate template variables without
 * protective delimiters — a common prompt injection vector.
 */
export const promptInjectionRiskRule: Rule = {
  name: "prompt-injection-risk",
  severity: "warning",

  check(context: AnalysisContext): Issue[] {
    const issues: Issue[] = [];

    const prompts = context.ast.declarations.filter(
      (d): d is PromptDeclaration => d.kind === "PromptDeclaration"
    );

    for (const prompt of prompts) {
      for (const section of prompt.sections) {
        if (section.kind !== "MessageSection") continue;
        if (section.role !== "user") continue;
        if (!section.content.isTemplate) continue;

        const vars = extractTemplateVars(section.content.value);
        if (vars.length === 0) continue;
        if (isDelimited(section.content.value)) continue;

        const varList = vars.map((v) => `'{{${v}}}'`).join(", ");
        issues.push({
          severity: "warning",
          rule: "prompt-injection-risk",
          file: context.file,
          line: section.content.line,
          column: section.content.column,
          message: `Template ${varList} in user section is not delimited.`,
          suggestion:
            "Wrap user input with markers like --- or <BEGIN>...<END> to prevent prompt injection.",
        });
      }
    }

    return issues;
  },
};
