import type { Rule, AnalysisContext, Issue } from "../analyzer";
import type { Program, PromptDeclaration, TypeExpression } from "../../ast/nodes";

/**
 * True when the parameter's value can carry instructions. Numbers, booleans and
 * enums cannot; a struct is inserted as "[object Object]". A type the file does
 * not declare (imported) is treated as text, since nothing here can rule it out.
 */
function carriesText(type: TypeExpression, program: Program, seen = new Set<string>()): boolean {
  switch (type.kind) {
    case "PrimitiveType":
      return type.name === "string";
    case "EnumType":
    case "StructType":
      return false;
    case "TypeReference": {
      if (seen.has(type.name)) return false;
      const d = program.declarations.find(
        (x) => x.kind === "TypeDeclaration" && x.name === type.name
      );
      if (d?.kind !== "TypeDeclaration") return true;
      return carriesText(d.definition, program, new Set([...seen, type.name]));
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

function insideFence(content: string, at: number, fence: RegExp): boolean {
  const before = [...content.slice(0, at).matchAll(fence)].length;
  return before % 2 === 1 && content.slice(at).match(fence) !== null;
}

/** Whether a `<name ...>` opened before `at` and still open there is closed after it. */
function insideTag(content: string, at: number): boolean {
  const open: string[] = [];
  for (const m of content.slice(0, at).matchAll(/<(\/?)([A-Za-z_][\w.-]*)(?:\s[^<>]*)?>/g)) {
    const [, slash, name] = m;
    if (!slash) open.push(name!);
    else if (open.includes(name!)) open.splice(open.lastIndexOf(name!));
  }
  const after = content.slice(at);
  return open.some((name) => after.includes(`</${name}>`));
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
        for (const m of content.matchAll(/\{\{(\w+)\}\}/g)) {
          const name = m[1]!;
          if (textParams.has(name) && !isEnclosed(content, m.index)) open.add(name);
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
            "Enclose the input in a pair such as <input>...</input>, --- lines or a code fence, and say in the instructions that the enclosed text is data, not instructions.",
        });
      }
    }

    return issues;
  },
};
