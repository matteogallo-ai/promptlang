import type { AstNode, Program, StructType, TypeExpression } from "../ast/nodes";
import { CompilerError } from "./errors";
import { toConstName, toPascalCase } from "./type-mapper";

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

/**
 * The parameters of every generated chain function, in scope throughout its
 * body; the other one, `input`, is a PromptLang keyword.
 */
const CHAIN_PARAMETERS = new Set(["client"]);

const LANGUAGE: Record<Target, string> = { typescript: "TypeScript", python: "Python" };

/**
 * Module-level names the generated code imports, or globals its function bodies
 * call, which a declaration of the same name would shadow.
 */
const GENERATED_GLOBALS: Record<Target, ReadonlySet<string>> = {
  typescript: new Set([
    "PromptClient",
    "PromptRequest",
    "Promise",
    "Number",
    "isNaN",
    "Error",
    "JSON",
  ]),
  python: new Set([
    "PromptClient",
    "PromptRequest",
    "ValueError",
    "TypedDict",
    "NotRequired",
    "Literal",
    "annotations",
    "str",
    "float",
    "bool",
    "int",
    "list",
    "dict",
  ]),
};

/** Whether `name` is a reserved word of `target`, e.g. to name a Python module. */
export function isReservedWord(name: string, target: Target): boolean {
  return (target === "python" ? PYTHON_RESERVED : TYPESCRIPT_RESERVED).has(name);
}

interface Emitted {
  name: string;
  /** The declaration it comes from, for the message: "the prompt foo". */
  source: string;
  node: AstNode;
}

/**
 * The module-level names the generated code declares for each declaration of
 * `program`: its own name, `FooInput` and `foo_meta` (Python: `FOO_META`) for a
 * prompt or chain, `FOO_VALUES` (Python: `_FOO_VALUES`) for an enum.
 */
function emittedNames(program: Program, target: Target): Emitted[] {
  const out: Emitted[] = [];
  for (const d of program.declarations) {
    if (d.kind === "TypeDeclaration") {
      const source = `the type ${d.name}`;
      out.push({ name: d.name, source, node: d });
      if (d.definition.kind === "EnumType")
        out.push({
          name: target === "python" ? `_${toConstName(d.name)}` : toConstName(d.name),
          source,
          node: d,
        });
    } else if (d.kind === "PromptDeclaration" || d.kind === "ChainDeclaration") {
      const source = `the ${d.kind === "PromptDeclaration" ? "prompt" : "chain"} ${d.name}`;
      out.push({ name: d.name, source, node: d });
      out.push({ name: `${toPascalCase(d.name)}Input`, source, node: d });
      if (d.kind === "PromptDeclaration")
        out.push({
          name: target === "python" ? `${d.name.toUpperCase()}_META` : `${d.name}_meta`,
          source,
          node: d,
        });
    }
  }
  return out;
}

/** The names a module exports, which an index re-exporting several modules must hold once each. */
export function exportedNames(program: Program, target: Target): string[] {
  // Python's `import *` skips names that start with `_`.
  return emittedNames(program, target)
    .map((e) => e.name)
    .filter((n) => target === "typescript" || !n.startsWith("_"));
}

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
 * target language where the code binds it, a name with `-` (the lexer accepts
 * one for model names, no target in an identifier), a name the generated code
 * imports or relies on, a step named after a callable, or two declarations
 * that generate the same module-level name.
 * Without this the compiler wrote a module that does not parse, and exited 0.
 */
export function checkTargetNames(program: Program, target: Target): void {
  const language = LANGUAGE[target];
  // A step of that name shadows the callable inside the chain.
  const callables = new Set(
    program.declarations.flatMap((d) =>
      d.kind === "PromptDeclaration" || d.kind === "ChainDeclaration" ? [d.name] : []
    )
  );
  for (const { name, role, node, bound } of names(program, target)) {
    const moduleLevel = role !== "a step" && role !== "a field" && role !== "a parameter";
    let problem: string | undefined;
    if (name.includes("-")) problem = `${language} identifiers cannot contain '-'`;
    else if (bound && (target === "python" ? PYTHON_RESERVED : TYPESCRIPT_RESERVED).has(name))
      problem = `it is a reserved word in ${language}`;
    else if (target === "typescript" && role === "a type" && TYPESCRIPT_TYPE_NAMES.has(name))
      problem = `TypeScript reserves it as a type name`;
    else if (moduleLevel && GENERATED_GLOBALS[target].has(name))
      problem = `the generated ${language} uses that name`;
    else if ((moduleLevel || role === "a step") && CHAIN_PARAMETERS.has(name) && role !== "a type")
      problem = "the generated chain's parameters use that name";
    else if (role === "a step" && callables.has(name))
      problem = "the file declares a prompt or chain of that name";
    if (problem)
      throw new CompilerError(`'${name}' cannot name ${role}: ${problem}`, node.line, node.column);
  }
  const first = new Map<string, Emitted>();
  for (const e of emittedNames(program, target)) {
    const other = first.get(e.name);
    if (other)
      throw new CompilerError(
        `'${e.name}' is generated twice: for ${other.source} and for ${e.source}`,
        e.node.line,
        e.node.column
      );
    first.set(e.name, e);
  }
}
