import type { Rule, AnalysisContext, Issue } from "../analyzer";
import type { PromptDeclaration } from "../../ast/nodes";

/**
 * Detects prompt names declared in multiple files.
 * Each duplicate pair is reported exactly once, from the lexicographically
 * first file, to avoid duplicate issue entries.
 */
export const duplicatePromptsRule: Rule = {
  name: "duplicate-prompts",
  severity: "warning",

  check(context: AnalysisContext, allFiles: AnalysisContext[] = []): Issue[] {
    const issues: Issue[] = [];

    const prompts = context.ast.declarations.filter(
      (d): d is PromptDeclaration => d.kind === "PromptDeclaration"
    );

    for (const prompt of prompts) {
      const otherFiles = allFiles.filter(
        (other) =>
          other.file !== context.file &&
          other.ast.declarations.some(
            (d): d is PromptDeclaration =>
              d.kind === "PromptDeclaration" && d.name === prompt.name
          )
      );

      if (otherFiles.length === 0) continue;

      // Only report from the lexicographically first file to avoid duplicates.
      const allWithPrompt = [context.file, ...otherFiles.map((f) => f.file)];
      const firstFile = allWithPrompt.reduce((a, b) => (a < b ? a : b));
      if (firstFile !== context.file) continue;

      const locations = allFiles
        .filter((f) =>
          f.ast.declarations.some(
            (d): d is PromptDeclaration =>
              d.kind === "PromptDeclaration" && d.name === prompt.name
          )
        )
        .map((f) => {
          const decl = f.ast.declarations.find(
            (d): d is PromptDeclaration =>
              d.kind === "PromptDeclaration" && d.name === prompt.name
          ) as PromptDeclaration;
          return `${f.file}:${decl.line}`;
        })
        .join(", ");

      issues.push({
        severity: "warning",
        rule: "duplicate-prompts",
        file: context.file,
        line: prompt.line,
        column: prompt.column,
        message: `Prompt '${prompt.name}' is declared in multiple files: ${locations}.`,
        suggestion: "Rename or consolidate duplicate prompt declarations.",
      });
    }

    return issues;
  },
};
