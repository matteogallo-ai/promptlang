import type { AstNode, Program, StructType, TypeExpression } from "../ast/nodes";
import { CompilerError } from "./errors";

export type Target = "typescript" | "python";

/** ECMAScript reserved words, strict mode (generated modules are strict) included. */
const TYPESCRIPT_RESERVED = new Set(
  (
    "await break case catch class const continue debugger default delete do else enum " +
    "export extends false finally for function if import in instanceof new null return " +
    "super switch this throw true try typeof var void while with yield " +
    "implements interface let package private protected public static arguments eval"
  ).split(" ")
);

/** Names TypeScript refuses for a type alias (TS2457), on top of the reserved words. */
const TYPESCRIPT_TYPE_NAMES = new Set(
  "any unknown never string number boolean symbol object bigint undefined".split(" ")
);

/** Python's `keyword.kwlist`. */
const PYTHON_RESERVED = new Set(
  (
    "False None True and as assert async await break class continue def del elif else " +
    "except finally for from global if import in is lambda nonlocal not or pass raise " +
    "return try while with yield"
  ).split(" ")
);

const LANGUAGE: Record<Target, string> = { typescript: "TypeScript", python: "Python" };

interface Binding {
  name: string;
  /** What the name names, for the message: "a prompt", "a field". */
  role: string;
  node: AstNode;
  /** A binding in the generated code; otherwise a property name, which TypeScript allows to be a reserved word. */
  bound: boolean;
}

function fieldsOf(type: TypeExpression): StructType["fields"] {
  return type.kind === "StructType" ? type.fields : [];
}

function names(program: Program, target: Target): Binding[] {
  // Python spells parameters and struct fields as TypedDict class attributes.
  const attributes = target === "python";
  const out: Binding[] = [];
  for (const d of program.declarations) {
    if (d.kind === "TypeDeclaration") {
      out.push({ name: d.name, role: "a type", node: d, bound: true });
      for (const f of fieldsOf(d.definition))
        out.push({ name: f.name, role: "a field", node: f, bound: attributes });
    } else if (d.kind === "PromptDeclaration" || d.kind === "ChainDeclaration") {
      const role = d.kind === "PromptDeclaration" ? "a prompt" : "a chain";
      out.push({ name: d.name, role, node: d, bound: true });
      for (const p of d.parameters) {
        out.push({ name: p.name, role: "a parameter", node: p, bound: attributes });
        for (const f of fieldsOf(p.type))
          out.push({ name: f.name, role: "a field", node: f, bound: attributes });
      }
      if (d.kind === "ChainDeclaration")
        for (const s of d.steps) out.push({ name: s.name, role: "a step", node: s, bound: true });
    }
  }
  return out;
}

/**
 * Refuses a name the generated code could not hold: a reserved word of the
 * target language where the code binds it, or a name with `-`, which the
 * lexer accepts for model names but no target accepts in an identifier.
 * Without this the compiler wrote a module that does not parse, and exited 0.
 */
export function checkTargetNames(program: Program, target: Target): void {
  const language = LANGUAGE[target];
  for (const { name, role, node, bound } of names(program, target)) {
    let problem: string | undefined;
    if (name.includes("-")) problem = `${language} identifiers cannot contain '-'`;
    else if (bound && (target === "python" ? PYTHON_RESERVED : TYPESCRIPT_RESERVED).has(name))
      problem = `it is a reserved word in ${language}`;
    else if (target === "typescript" && role === "a type" && TYPESCRIPT_TYPE_NAMES.has(name))
      problem = `TypeScript reserves it as a type name`;
    if (problem)
      throw new CompilerError(`'${name}' cannot name ${role}: ${problem}`, node.line, node.column);
  }
}
