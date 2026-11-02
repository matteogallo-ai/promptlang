import { CompilerError } from "./errors";

/**
 * Compiles a section string to a TypeScript template literal. Parameters in
 * `optionalNames` may be absent from the input; they interpolate as "".
 */
export function compileStringLiteral(
  value: string,
  isTemplate: boolean,
  paramNames: Set<string>,
  optionalNames: ReadonlySet<string> = new Set()
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
    const withInterpolations = escaped.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      optionalNames.has(name) ? `\${input.${name} ?? ""}` : `\${input.${name}}`
    );
    return `\`${withInterpolations}\``;
  }

  return `\`${escaped}\``;
}

export function extractTemplateVars(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
}
