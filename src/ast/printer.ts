import type {
  AstNode,
  Program,
  Metadata,
  Declaration,
  TypeDeclaration,
  PromptDeclaration,
  ChainDeclaration,
  TestDeclaration,
  EvalDeclaration,
  TypeExpression,
  Field,
  PromptSection,
  Expression,
  CallArgument,
  Literal,
} from "./nodes";

// Box-drawing characters for tree rendering.
const TEE = "├── ";
const ELBOW = "└── ";
const VERTICAL = "│   ";
const BLANK = "    ";

function connector(items: unknown[], i: number): string {
  return i < items.length - 1 ? TEE : ELBOW;
}

function continuation(items: unknown[], i: number): string {
  return i < items.length - 1 ? VERTICAL : BLANK;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable tree representation of a Program AST node.
 * Primarily used for debugging and the `promptlang parse` CLI command.
 */
export function printAst(node: AstNode): string {
  const lines: string[] = [];
  printProgram(node as Program, lines);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Node renderers
// ---------------------------------------------------------------------------

function printProgram(node: Program, out: string[]): void {
  out.push("Program");
  const all: Array<Metadata | Declaration> = [
    ...node.metadata,
    ...node.declarations,
  ];
  all.forEach((child, i) => {
    const conn = connector(all, i);
    const cont = continuation(all, i);
    printMetaOrDecl(child, conn, cont, out);
  });
}

function printMetaOrDecl(
  node: Metadata | Declaration,
  conn: string,
  cont: string,
  out: string[]
): void {
  switch (node.kind) {
    case "VersionMetadata":
      out.push(`${conn}VersionMetadata "${node.value}"`);
      break;
    case "ModelMetadata":
      out.push(`${conn}ModelMetadata "${node.value}"`);
      break;
    case "TemperatureMetadata":
      out.push(`${conn}TemperatureMetadata ${node.value}`);
      break;
    case "MaxTokensMetadata":
      out.push(`${conn}MaxTokensMetadata ${node.value}`);
      break;
    case "BreakingChangesMetadata":
      out.push(`${conn}BreakingChangesMetadata "${node.value}"`);
      break;
    case "MigrationFromMetadata":
      out.push(`${conn}MigrationFromMetadata "${node.from}" -> "${node.to}"`);
      break;
    case "DescriptionMetadata":
      out.push(`${conn}DescriptionMetadata "${node.value}"`);
      break;
    case "TypeDeclaration":
      printTypeDeclaration(node, conn, cont, out);
      break;
    case "PromptDeclaration":
      printPromptDeclaration(node, conn, cont, out);
      break;
    case "ChainDeclaration":
      printChainDeclaration(node, conn, cont, out);
      break;
    case "TestDeclaration":
      printTestDeclaration(node, conn, cont, out);
      break;
    case "EvalDeclaration":
      printEvalDeclaration(node, conn, cont, out);
      break;
  }
}

function printTypeDeclaration(
  node: TypeDeclaration,
  conn: string,
  cont: string,
  out: string[]
): void {
  out.push(`${conn}TypeDeclaration "${node.name}"`);
  out.push(`${cont}${ELBOW}${typeLabel(node.definition)}`);
  if (node.definition.kind === "StructType") {
    printFields(node.definition.fields, `${cont}${BLANK}`, out);
  }
}

function printFields(fields: Field[], prefix: string, out: string[]): void {
  fields.forEach((f, i) => {
    const opt = f.optional ? "?" : "";
    out.push(`${prefix}${connector(fields, i)}Field "${f.name}${opt}" : ${typeLabel(f.type)}`);
  });
}

function printPromptDeclaration(
  node: PromptDeclaration,
  conn: string,
  cont: string,
  out: string[]
): void {
  out.push(`${conn}PromptDeclaration "${node.name}"`);
  const children = [
    ...node.parameters.map((p) => `Parameter "${p.name}" : ${typeLabel(p.type)}`),
    `ReturnType : ${typeLabel(node.returnType)}`,
    ...node.sections.map((s) => sectionLabel(s)),
  ];
  children.forEach((label, i) => {
    out.push(`${cont}${connector(children, i)}${label}`);
  });
}

function printChainDeclaration(
  node: ChainDeclaration,
  conn: string,
  cont: string,
  out: string[]
): void {
  out.push(`${conn}ChainDeclaration "${node.name}"`);
  const children = [
    ...node.parameters.map((p) => `Parameter "${p.name}" : ${typeLabel(p.type)}`),
    `ReturnType : ${typeLabel(node.returnType)}`,
    ...node.steps.map((s) => `ChainStep "${s.name}" = ${exprLabel(s.expression)}`),
    `return ${exprLabel(node.returnExpression)}`,
  ];
  children.forEach((label, i) => {
    out.push(`${cont}${connector(children, i)}${label}`);
  });
}

function printTestDeclaration(
  node: TestDeclaration,
  conn: string,
  cont: string,
  out: string[]
): void {
  out.push(`${conn}TestDeclaration "${node.description}"`);
  const children = [
    `input: ${exprLabel(node.input)}`,
    ...node.expectations.map((e) => `${e.path.join(".")}: ${literalLabel(e.value)}`),
  ];
  children.forEach((label, i) => {
    out.push(`${cont}${connector(children, i)}${label}`);
  });
}

function printEvalDeclaration(
  node: EvalDeclaration,
  conn: string,
  cont: string,
  out: string[]
): void {
  out.push(`${conn}EvalDeclaration "${node.description}"`);
  const children = [
    `dataset: "${node.dataset}"`,
    `prompt: ${node.promptName}`,
    `metric: ${node.metric}`,
    `threshold: ${node.threshold}`,
  ];
  children.forEach((label, i) => {
    out.push(`${cont}${connector(children, i)}${label}`);
  });
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

function typeLabel(t: TypeExpression): string {
  switch (t.kind) {
    case "PrimitiveType":
      return `PrimitiveType(${t.name})`;
    case "EnumType":
      return `EnumType[${t.values.join(", ")}]`;
    case "StructType":
      return `StructType(${t.fields.length} fields)`;
    case "TypeReference":
      return `TypeReference(${t.name})`;
  }
}

function sectionLabel(s: PromptSection): string {
  if (s.kind === "MessageSection") {
    const preview = s.content.value.slice(0, 40).replace(/\n/g, "\\n");
    const suffix = s.content.value.length > 40 ? "..." : "";
    return `MessageSection ${s.role}: "${preview}${suffix}"`;
  }
  return `OutputSection : ${typeLabel(s.type)}`;
}

function exprLabel(e: Expression): string {
  switch (e.kind) {
    case "CallExpression":
      return `${e.callee}(${e.arguments.map(argLabel).join(", ")})`;
    case "MemberExpression":
      return `${e.object}.${e.property}`;
    case "Identifier":
      return e.name;
    case "StringLiteral": {
      const preview = e.value.slice(0, 20);
      return `"${preview}${e.value.length > 20 ? "..." : ""}"`;
    }
    case "NumberLiteral":
      return String(e.value);
    case "BooleanLiteral":
      return String(e.value);
  }
}

function argLabel(a: CallArgument): string {
  if (a.kind === "NamedArgument") {
    return `${a.name}: ${exprLabel(a.value)}`;
  }
  return exprLabel(a);
}

function literalLabel(l: Literal): string {
  switch (l.kind) {
    case "StringLiteral":
      return `"${l.value}"`;
    case "NumberLiteral":
      return String(l.value);
    case "BooleanLiteral":
      return String(l.value);
    case "Identifier":
      return l.name;
  }
}
