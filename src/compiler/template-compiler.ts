import { enclosingDelimiters } from "./delimiters";
import { CompilerError } from "./errors";

/**
 * Compiles a section string to a TypeScript template literal. Parameters in
 * `optionalNames` may be absent from the input; they interpolate as "".
 * Parameters in `jsonNames` are inserted as JSON. A value between delimiters goes
 * through `$neutralizeDelimiters`, so it cannot close or reopen them.
 */
export function compileStringLiteral(
  value: string,
  isTemplate: boolean,
  paramNames: Set<string>,
  optionalNames: ReadonlySet<string> = new Set(),
  jsonNames: ReadonlySet<string> = new Set()
): string {
  if (isTemplate) {
    for (const match of value.matchAll(/\{\{(\w+)\}\}/g)) {
      const varName = match[1]!;
      if (!paramNames.has(varName)) {
        throw new CompilerError(`Template variable "{{${varName}}}" is not a declared parameter`);
      }
    }
  }

  // Escape for use inside a template literal: backslashes, backticks, ${ sequences.
  const escaped = value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

  if (isTemplate) {
    // Escaping leaves every {{name}} in place, so the n-th match is the n-th placeholder.
    const around = templatePlaceholders(value).map((p) => enclosingDelimiters(value, p.index));
    let n = 0;
    const withInterpolations = escaped.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
      const delimiters = around[n++]!;
      const guard = (text: string) =>
        delimiters.length === 0
          ? text
          : `$neutralizeDelimiters(${text}, ${JSON.stringify(delimiters)})`;
      if (jsonNames.has(name)) {
        const json = guard(`globalThis.JSON.stringify(input.${name})`);
        return optionalNames.has(name)
          ? `\${input.${name} === undefined ? "" : ${json}}`
          : `\${${json}}`;
      }
      if (delimiters.length === 0)
        return optionalNames.has(name) ? `\${input.${name} ?? ""}` : `\${input.${name}}`;
      return optionalNames.has(name)
        ? `\${${guard(`String(input.${name} ?? "")`)}}`
        : `\${${guard(`String(input.${name})`)}}`;
    });
    return `\`${withInterpolations}\``;
  }

  return `\`${escaped}\``;
}

/** Each `{{name}}` in `value`, with the offset of its opening brace. */
export function templatePlaceholders(value: string): Array<{ name: string; index: number }> {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => ({ name: m[1]!, index: m.index }));
}

export function extractTemplateVars(value: string): string[] {
  return templatePlaceholders(value).map((p) => p.name);
}
