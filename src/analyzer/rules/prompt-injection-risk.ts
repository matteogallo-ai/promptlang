import type { Rule, AnalysisContext, Issue } from "../analyzer";
import type { Program, PromptDeclaration, TypeExpression } from "../../ast/nodes";
import { templatePlaceholders } from "../../compiler/template-compiler";

/**
 * True when the parameter's value can carry instructions. Numbers, booleans and
 * enums cannot, provided the caller's type checker holds them to their type:
 * nothing checks them at run time. `date` is a string nobody validates. A struct
 * carries text when any field does: Python inserts its repr, fields included. A
 * type the file does not declare, or a cycle of aliases, is treated as text,
 * since nothing here can rule it out. A cycle through a struct adds no field, so
 * it is judged by the fields already seen. `aliases` holds the names followed
 * since the last struct: meeting one again is an alias cycle.
 */
function carriesText(
  type: TypeExpression,
  program: Program,
  seen: ReadonlySet<string> = new Set(),
  aliases: ReadonlySet<string> = new Set()
): boolean {
  switch (type.kind) {
    case "PrimitiveType":
      return type.name === "string" || type.name === "date";
    case "EnumType":
      return false;
    case "StructType":
      return type.fields.some((f) => carriesText(f.type, program, seen, new Set()));
    case "TypeReference": {
      if (aliases.has(type.name)) return true;
      if (seen.has(type.name)) return false;
      const d = program.declarations.find(
        (x) => x.kind === "TypeDeclaration" && x.name === type.name
      );
      if (d?.kind !== "TypeDeclaration") return true;
      return carriesText(
        d.definition,
        program,
        new Set([...seen, type.name]),
        new Set([...aliases, type.name])
      );
    }
  }
}

/** Whether an unmatched opener sits before `at` and its closer after it. */
function between(content: string, at: number, open: string, close: string): boolean {
  return (
    content.lastIndexOf(open, at) > content.lastIndexOf(close, at) &&
    content.indexOf(close, at) !== -1
  );
}

/** Whether an odd number of `fence` lines precede `at`, so one is open there, and one follows. */
function insideFence(content: string, at: number, fence: RegExp): boolean {
  const before = [...content.slice(0, at).matchAll(fence)].length;
  return before % 2 === 1 && content.slice(at).match(fence) !== null;
}

/** Whether a `<name ...>` opened before `at` and still open there is closed after it. */
function insideTag(content: string, at: number): boolean {
  const open: string[] = [];
  for (const m of content.slice(0, at).matchAll(/<(\/?)([A-Za-z_][\w.:-]*)(?:\s[^<>]*)?>/g)) {
    const [, slash, name] = m;
    if (!slash) open.push(name!);
    else if (open.includes(name!)) open.splice(open.lastIndexOf(name!));
  }
  const after = content.slice(at);
  // Closing tags are read with a fixed pattern: no name is built into a regex.
  const closed = new Set([...after.matchAll(/<\/([A-Za-z_][\w.:-]*)\s*>/g)].map((m) => m[1]!));
  return open.some((name) => closed.has(name));
}

/**
 * Whether the placeholder at `at` lies inside a delimiter pair. Each pair is
 * matched around the placeholder itself: a delimiter elsewhere in the text
 * separates nothing from the input.
 */
function isEnclosed(content: string, at: number): boolean {
  return (
    insideTag(content, at) ||
    between(content, at, "<BEGIN>", "<END>") ||
    between(content, at, "[[", "]]") ||
    insideFence(content, at, /```/g) ||
    insideFence(content, at, /^[ \t]*---[ \t]*$/gm)
  );
}

/**
 * Flags message sections that insert a text parameter outside any delimiter,
 * a common prompt injection vector. Every role is checked: the caller supplies
 * the value wherever it is inserted. A delimiter is not escaping: a value that
 * contains the closing delimiter still closes it, which no static rule can see.
 */
export const promptInjectionRiskRule: Rule = {
  name: "prompt-injection-risk",
  severity: "warning",

  check(context: AnalysisContext): Issue[] {
    const issues: Issue[] = [];
    const program = context.ast;

    const prompts = program.declarations.filter(
      (d): d is PromptDeclaration => d.kind === "PromptDeclaration"
    );

    for (const prompt of prompts) {
      const textParams = new Set(
        prompt.parameters.filter((p) => carriesText(p.type, program)).map((p) => p.name)
      );
      for (const section of prompt.sections) {
        if (section.kind !== "MessageSection" || !section.content.isTemplate) continue;
        const content = section.content.value;
        const open = new Set<string>();
        for (const { name, index } of templatePlaceholders(content)) {
          if (textParams.has(name) && !isEnclosed(content, index)) open.add(name);
        }
        if (open.size === 0) continue;

        const varList = [...open].map((v) => `'{{${v}}}'`).join(", ");
        issues.push({
          severity: "warning",
          rule: "prompt-injection-risk",
          file: context.file,
          line: section.content.line,
          column: section.content.column,
          message: `Template ${varList} in ${section.role} section is not enclosed in a delimiter.`,
          suggestion:
            "Enclose the input in a pair such as <input>...</input>, --- lines or a code fence, and say in the instructions that the enclosed text is data, not instructions. A value from a fixed list can be declared as an enum instead.",
        });
      }
    }

    return issues;
  },
};
