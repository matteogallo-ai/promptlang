import { enclosingDelimiters } from "../delimiters";
import { CompilerError } from "../errors";
import { templatePlaceholders } from "../template-compiler";

/**
 * Compiles a PromptLang string section to a Python string expression.
 * - Non-template strings → plain quoted string (triple-quoted if multiline)
 * - Template strings with {{var}} → f-string with input['var']
 * - Literal curly braces in non-template content are doubled for f-string safety.
 */
export function compilePythonStringLiteral(
  value: string,
  isTemplate: boolean,
  paramNames: Set<string>,
  optionalNames: ReadonlySet<string> = new Set(),
  jsonNames: ReadonlySet<string> = new Set()
): string {
  if (isTemplate) {
    // Validate all template vars are declared params
    for (const match of value.matchAll(/\{\{(\w+)\}\}/g)) {
      const varName = match[1]!;
      if (!paramNames.has(varName)) {
        throw new CompilerError(`Template variable "{{${varName}}}" is not a declared parameter`);
      }
    }
  }

  const isMultiline = value.includes("\n");
  const quote = isMultiline ? '"""' : '"';

  if (isTemplate) {
    // Escape literal braces that are NOT part of {{...}} templates.
    // Strategy: replace {{var}} with a placeholder, escape remaining { and },
    // then restore as f-string interpolations.
    const around = templatePlaceholders(value).map((p) => enclosingDelimiters(value, p.index));
    const placeholders: string[] = [];
    const withPlaceholders = value.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
      const idx = placeholders.length;
      placeholders.push(varName as string);
      return `\x00PL${idx}\x00`;
    });

    // Escape remaining literal braces for f-strings
    const withEscapedBraces = withPlaceholders.replace(/\{/g, "{{").replace(/\}/g, "}}");

    // Restore placeholders as f-string interpolations
    let result = withEscapedBraces;
    for (let i = 0; i < placeholders.length; i++) {
      const name = placeholders[i]!;
      // The separators and ensure_ascii of JSON.stringify; numbers are printed
      // by each language (Python writes 3.0 and 1e+20, TypeScript 3 and 1e20).
      const json = `_promptlang_json.dumps(input['${name}'], ensure_ascii=False, separators=(',', ':'))`;
      // Single quotes only: Python 3.11 refuses the f-string's own quote inside it.
      const delimiters = around[i]!.map((d) => `'${d}', `).join("");
      const guard = (text: string) =>
        around[i]!.length === 0 ? text : `_promptlang_neutralize(${text}, (${delimiters}))`;
      const access = jsonNames.has(name)
        ? optionalNames.has(name)
          ? `${guard(json)} if '${name}' in input else ''`
          : guard(json)
        : around[i]!.length === 0
          ? optionalNames.has(name)
            ? `input.get('${name}', '')`
            : `input['${name}']`
          : guard(
              optionalNames.has(name) ? `str(input.get('${name}', ''))` : `str(input['${name}'])`
            );
      result = result.replace(`\x00PL${i}\x00`, `{${access}}`);
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
    return value.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
  }
  // In regular double-quoted strings
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
