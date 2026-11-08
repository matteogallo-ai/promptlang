import type { Rule, AnalysisContext, Issue } from "../analyzer";
import type { Program, PromptDeclaration, TypeExpression } from "../../ast/nodes";
import { enclosingDelimiters } from "../../compiler/delimiters";
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

/**
 * Flags message sections that insert a text parameter outside any delimiter,
 * a common prompt injection vector. Every role is checked: the caller supplies
 * the value wherever it is inserted. The value itself is known only at run time:
 * generated code passes it through neutralizeDelimiters with the pairs found here,
 * so it cannot close or reopen them, alone or next to another value.
 */
// The template text before a placeholder, other placeholders removed, ends in "<"
// and optional whitespace or "/": the value can complete a tag there. The runtime
// rewrites values only, so this is reported instead of handled.
const LESS_THAN_BEFORE = /<[ \t\n\v\f\r]*(?:\/[ \t\n\v\f\r]*)?$/;

function followsLessThan(content: string, at: number): boolean {
  return LESS_THAN_BEFORE.test(content.slice(0, at).replace(/\{\{\w+\}\}/g, ""));
}

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
        const afterLessThan = new Set<string>();
        for (const { name, index } of templatePlaceholders(content)) {
          if (!textParams.has(name)) continue;
          const around = enclosingDelimiters(content, index);
          if (around.length === 0) open.add(name);
          else if (around.some((d) => d.startsWith("tag:")) && followsLessThan(content, index))
            afterLessThan.add(name);
        }
        if (afterLessThan.size > 0) {
          const list = [...afterLessThan].map((v) => `'{{${v}}}'`).join(", ");
          issues.push({
            severity: "warning",
            rule: "prompt-injection-risk",
            file: context.file,
            line: section.content.line,
            column: section.content.column,
            message: `Template ${list} in ${section.role} section follows a "<": a value starting with "/name>" closes the tag around it, and the runtime rewrites only the value.`,
            suggestion:
              'Put other text between the "<" and the placeholder (<mailto:{{x}}>), or write &lt; in the template.',
          });
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
