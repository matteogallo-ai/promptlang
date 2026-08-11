import { CompilerError } from "./errors";

export function compileStringLiteral(
  value: string,
  isTemplate: boolean,
  paramNames: Set<string>
): string {
  if (isTemplate) {
    for (const match of value.matchAll(/\{\{(\w+)\}\}/g)) {
      const varName = match[1]!;
      if (!paramNames.has(varName)) {
        throw new CompilerError(
          `Template variable "{{${varName}}}" is not a declared parameter`
        );
      }
    }
  }

  // Escape for use inside a template literal: backslashes, backticks, ${ sequences.
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");

  if (isTemplate) {
    const withInterpolations = escaped.replace(
      /\{\{(\w+)\}\}/g,
      "${input.$1}"
    );
    return "`" + withInterpolations + "`";
  }

  return "`" + escaped + "`";
}

export function extractTemplateVars(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
}
