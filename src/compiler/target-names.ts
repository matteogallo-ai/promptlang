import type { AstNode, ChainDeclaration, Program, StructType, TypeExpression } from "../ast/nodes";
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
  "any unknown never string number boolean symbol object bigint undefined keyof readonly unique infer".split(
    " "
  )
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
 * Names the generated module imports or its function bodies call. A declaration
 * of the same name would shadow one: in TypeScript only a value hides a value,
 * so the globals called (`Number`...) bind prompts and chains only; in Python a
 * type is a value too.
 */
const GENERATED_IMPORTS: Record<Target, ReadonlySet<string>> = {
  typescript: new Set(["PromptClient", "PromptRequest", "Promise"]),
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
const TYPESCRIPT_VALUE_GLOBALS = new Set(["Number", "isNaN", "Error", "JSON"]);

/** Whether `name` is a reserved word of `target`, e.g. to name a Python module. */
export function isReservedWord(name: string, target: Target): boolean {
  return (target === "python" ? PYTHON_RESERVED : TYPESCRIPT_RESERVED).has(name);
}

interface Emitted {
  name: string;
  /** The declaration it comes from, for the message: "the prompt foo". */
  source: string;
  node: AstNode;
  /** TypeScript keeps types and values apart; Python has values only. */
  space: "type" | "value";
  exported: boolean;
}

/**
 * The module-level names the generated code declares for each declaration of
 * `program`: its own name, `FooInput` and `foo_meta` (Python: `FOO_META`) for a
 * prompt or chain, `FOO_VALUES` (Python: `_FOO_VALUES`) for an enum.
 */
function emittedNames(program: Program, target: Target): Emitted[] {
  const out: Emitted[] = [];
  const type = target === "typescript" ? "type" : "value";
  for (const d of program.declarations) {
    if (d.kind === "TypeDeclaration") {
      const source = `the type ${d.name}`;
      out.push({ name: d.name, source, node: d, space: type, exported: true });
      if (d.definition.kind === "EnumType")
        out.push({
          name: target === "python" ? `_${toConstName(d.name)}` : toConstName(d.name),
          source,
          node: d,
          space: "value",
          exported: false,
        });
    } else if (d.kind === "PromptDeclaration" || d.kind === "ChainDeclaration") {
      const source = `the ${d.kind === "PromptDeclaration" ? "prompt" : "chain"} ${d.name}`;
      out.push({ name: d.name, source, node: d, space: "value", exported: true });
      const input = `${toPascalCase(d.name)}Input`;
      out.push({ name: input, source, node: d, space: type, exported: true });
      if (d.kind === "PromptDeclaration")
        out.push({
          name: target === "python" ? `${d.name.toUpperCase()}_META` : `${d.name}_meta`,
          source,
          node: d,
          space: "value",
          exported: true,
        });
    }
  }
  return out;
}

/** The names a module exports, which an index re-exporting several modules must hold once each. */
export function exportedNames(program: Program, target: Target): string[] {
  // Python's `import *` skips names that start with `_`.
  return emittedNames(program, target)
    .filter((e) => e.exported && (target === "typescript" || !e.name.startsWith("_")))
    .map((e) => e.name);
}

interface Binding {
  name: string;
  /** What the name names, for the message: "a prompt", "a field". */
  role: string;
  node: AstNode;
  /** A binding in the generated code; otherwise a property name, which TypeScript allows to be a reserved word. */
  bound: boolean;
  /** For a step: its chain and its position in it. */
  chain?: { declaration: ChainDeclaration; index: number };
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
        for (const [index, s] of d.steps.entries())
          out.push({
            name: s.name,
            role: "a step",
            node: s,
            bound: true,
            chain: { declaration: d, index },
          });
    }
  }
  return out;
}

/**
 * Refuses a name the generated code could not hold: a reserved word of the
 * target language where the code binds it, a name with `-` (the lexer accepts
 * one for model names, no target in an identifier), a Python name starting
 * with `__`, a name the generated code imports or calls, a step that a
 * reference would not reach or that redeclares a name of its chain, or two
 * declarations that generate the same name in the same namespace.
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
  for (const { name, role, node, bound, chain } of names(program, target)) {
    const callable = role === "a prompt" || role === "a chain";
    let problem: string | undefined;
    if (name.includes("-")) problem = `${language} identifiers cannot contain '-'`;
    else if (target === "python" && name.startsWith("__"))
      problem = "Python reserves names starting with '__'";
    else if (bound && (target === "python" ? PYTHON_RESERVED : TYPESCRIPT_RESERVED).has(name))
      problem = `it is a reserved word in ${language}`;
    else if (target === "typescript" && role === "a type" && TYPESCRIPT_TYPE_NAMES.has(name))
      problem = `TypeScript reserves it as a type name`;
    else if (
      (callable || role === "a type") &&
      (GENERATED_IMPORTS[target].has(name) ||
        (target === "typescript" && callable && TYPESCRIPT_VALUE_GLOBALS.has(name)))
    )
      problem = `the generated ${language} uses that name`;
    else if ((callable || role === "a step") && CHAIN_PARAMETERS.has(name))
      problem = "the generated chain's parameters use that name";
    else if (chain && callables.has(name))
      problem = "the file declares a prompt or chain of that name";
    else if (chain?.declaration.steps.slice(0, chain.index).some((s) => s.name === name))
      problem = "an earlier step of the chain has that name";
    // References resolve to the parameter first, so the step's result would be dropped.
    else if (chain?.declaration.parameters.some((p) => p.name === name))
      problem = "a parameter of the chain has that name";
    if (problem)
      throw new CompilerError(`'${name}' cannot name ${role}: ${problem}`, node.line, node.column);
  }
  const first = new Map<string, Emitted>();
  for (const e of emittedNames(program, target)) {
    const key = `${e.space}:${e.name}`;
    const other = first.get(key);
    if (other)
      throw new CompilerError(
        `'${e.name}' is generated twice: for ${other.source} and for ${e.source}`,
        e.node.line,
        e.node.column
      );
    first.set(key, e);
  }
}
