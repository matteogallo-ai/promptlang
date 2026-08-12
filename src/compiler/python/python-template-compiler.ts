import { CompilerError } from "../errors";

/**
 * Compiles a PromptLang string section to a Python string expression.
 * - Non-template strings → plain quoted string (triple-quoted if multiline)
 * - Template strings with {{var}} → f-string with input['var']
 * - Literal curly braces in non-template content are doubled for f-string safety.
 */
export function compilePythonStringLiteral(
  value: string,
  isTemplate: boolean,
  paramNames: Set<string>
): string {
  if (isTemplate) {
    // Validate all template vars are declared params
    for (const match of value.matchAll(/\{\{(\w+)\}\}/g)) {
      const varName = match[1]!;
      if (!paramNames.has(varName)) {
        throw new CompilerError(
          `Template variable "{{${varName}}}" is not a declared parameter`
        );
      }
    }
  }

  const isMultiline = value.includes("\n");
  const quote = isMultiline ? '"""' : '"';

  if (isTemplate) {
    // Escape literal braces that are NOT part of {{...}} templates.
    // Strategy: replace {{var}} with a placeholder, escape remaining { and },
    // then restore as f-string interpolations.
    const placeholders: string[] = [];
    const withPlaceholders = value.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
      const idx = placeholders.length;
      placeholders.push(varName as string);
      return `\x00PL${idx}\x00`;
    });

    // Escape remaining literal braces for f-strings
    const withEscapedBraces = withPlaceholders
      .replace(/\{/g, "{{")
      .replace(/\}/g, "}}");

    // Restore placeholders as f-string interpolations
    let result = withEscapedBraces;
    for (let i = 0; i < placeholders.length; i++) {
      result = result.replace(`\x00PL${i}\x00`, `{input['${placeholders[i]}']}` );
    }

    // Escape backslashes and quotes for the chosen quote style
    const escaped = escapeForPython(result, isMultiline);
    return `f${quote}${escaped}${quote}`;
  }

  // Non-template: plain string
  const escaped = escapeForPython(value, isMultiline);
  return `${quote}${escaped}${quote}`;
}

function escapeForPython(value: string, isMultiline: boolean): string {
  if (isMultiline) {
    // In triple-quoted strings, only need to escape backslashes and triple-quotes
    return value
      .replace(/\\/g, "\\\\")
      .replace(/"""/g, '\\"\\"\\"');
  }
  // In regular double-quoted strings
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
