import type {
  TypeDeclaration,
  PromptDeclaration,
  ChainDeclaration,
  TypeExpression,
  Program,
  Expression,
  CallArgument,
  NamedArgument,
  Parameter,
} from "../ast/nodes";
import { mapType, toPascalCase, toConstName } from "./type-mapper";
import { compileStringLiteral } from "./template-compiler";
import { CompilerError } from "./errors";

export type TypeRegistry = Map<string, TypeExpression>;

export interface CompiledMetadata {
  version?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export function buildTypeRegistry(program: Program): TypeRegistry {
  const registry: TypeRegistry = new Map();
  for (const decl of program.declarations) {
    if (decl.kind === "TypeDeclaration") {
      registry.set(decl.name, decl.definition);
    }
  }
  return registry;
}

// ---------------------------------------------------------------------------
// TypeDeclaration
// ---------------------------------------------------------------------------

export function generateTypeDeclaration(decl: TypeDeclaration): string {
  const { name, definition } = decl;
  const parts: string[] = [];

  switch (definition.kind) {
    case "EnumType": {
      const union = definition.values.map((v) => JSON.stringify(v)).join(" | ");
      parts.push(`export type ${name} = ${union};`);
      parts.push("");
      const vals = definition.values.map((v) => JSON.stringify(v)).join(", ");
      parts.push(`const ${toConstName(name)}: ${name}[] = [${vals}];`);
      break;
    }
    case "StructType": {
      parts.push(`export interface ${name} {`);
      for (const field of definition.fields) {
        const opt = field.optional ? "?" : "";
        parts.push(`  ${field.name}${opt}: ${mapType(field.type)};`);
      }
      parts.push("}");
      break;
    }
    case "PrimitiveType":
      parts.push(`export type ${name} = ${mapType(definition)};`);
      break;
    case "TypeReference":
      parts.push(`export type ${name} = ${definition.name};`);
      break;
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// PromptDeclaration
// ---------------------------------------------------------------------------

export function generatePromptDeclaration(
  decl: PromptDeclaration,
  meta: CompiledMetadata,
  registry: TypeRegistry
): string {
  const { name, parameters, returnType, sections } = decl;
  const pascalName = toPascalCase(name);
  const inputType = `${pascalName}Input`;
  const returnTsType = mapType(returnType);
  const paramNames = new Set(parameters.map((p) => p.name));

  const parts: string[] = [];

  // Meta const
  parts.push(generateMetaConst(name, meta));
  parts.push("");

  // Input interface
  parts.push(generateInputInterface(inputType, parameters));
  parts.push("");

  // Function signature
  parts.push(`export async function ${name}(`);
  parts.push(`  input: ${inputType},`);
  parts.push(`  client: PromptClient`);
  parts.push(`): Promise<${returnTsType}> {`);

  // Build messages array
  const messages = sections.filter((s) => s.kind === "MessageSection");
  parts.push(`  const request: PromptRequest = {`);
  if (meta.model !== undefined) {
    parts.push(`    model: ${name}_meta.model,`);
  } else {
    parts.push(`    model: "",`);
  }
  if (meta.temperature !== undefined) {
    parts.push(`    temperature: ${name}_meta.temperature,`);
  }
  if (meta.maxTokens !== undefined) {
    parts.push(`    max_tokens: ${name}_meta.max_tokens,`);
  }
  parts.push(`    messages: [`);
  for (const section of messages) {
    if (section.kind !== "MessageSection") continue;
    const content = compileStringLiteral(
      section.content.value,
      section.content.isTemplate,
      paramNames
    );
    parts.push(`      {`);
    parts.push(`        role: "${section.role}",`);
    parts.push(`        content: ${content},`);
    parts.push(`      },`);
  }
  parts.push(`    ],`);
  parts.push(`  };`);
  parts.push("");
  parts.push(`  const response = await client.complete(request);`);
  parts.push(`  const raw = response.content.trim();`);
  parts.push("");

  // Validation
  const resolved = resolveType(returnType, registry);
  parts.push(generateValidation(returnTsType, resolved, name));
  parts.push("}");

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// ChainDeclaration
// ---------------------------------------------------------------------------

export function generateChainDeclaration(
  decl: ChainDeclaration,
  _meta: CompiledMetadata,
  _registry: TypeRegistry
): string {
  const { name, parameters, returnType, steps, returnExpression } = decl;
  const pascalName = toPascalCase(name);
  const inputType = `${pascalName}Input`;
  const returnTsType = mapType(returnType);
  const paramNames = new Set(parameters.map((p) => p.name));

  const parts: string[] = [];

  // Input interface
  parts.push(generateInputInterface(inputType, parameters));
  parts.push("");

  // Function signature
  parts.push(`export async function ${name}(`);
  parts.push(`  input: ${inputType},`);
  parts.push(`  client: PromptClient`);
  parts.push(`): Promise<${returnTsType}> {`);

  // Steps
  const stepNames = new Set<string>();
  for (const step of steps) {
    const expr = compileExpression(step.expression, paramNames, stepNames);
    parts.push(`  const ${step.name} = ${expr};`);
    stepNames.add(step.name);
  }

  // Return
  const retExpr = compileExpression(returnExpression, paramNames, stepNames);
  parts.push(`  return ${retExpr};`);
  parts.push("}");

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateMetaConst(name: string, meta: CompiledMetadata): string {
  const lines: string[] = [];
  lines.push(`export const ${name}_meta = {`);
  lines.push(`  name: "${name}",`);
  if (meta.version !== undefined) lines.push(`  version: "${meta.version}",`);
  if (meta.model !== undefined) lines.push(`  model: "${meta.model}",`);
  if (meta.temperature !== undefined) lines.push(`  temperature: ${meta.temperature},`);
  if (meta.maxTokens !== undefined) lines.push(`  max_tokens: ${meta.maxTokens},`);
  lines.push(`} as const;`);
  return lines.join("\n");
}

function generateInputInterface(inputType: string, params: Parameter[]): string {
  if (params.length === 0) {
    return `export interface ${inputType} {}`;
  }
  const lines: string[] = [];
  lines.push(`export interface ${inputType} {`);
  for (const p of params) {
    lines.push(`  ${p.name}: ${mapType(p.type)};`);
  }
  lines.push("}");
  return lines.join("\n");
}

function resolveType(type: TypeExpression, registry: TypeRegistry): TypeExpression {
  if (type.kind === "TypeReference") {
    return registry.get(type.name) ?? type;
  }
  return type;
}

function generateValidation(
  returnTsType: string,
  resolved: TypeExpression,
  promptName: string
): string {
  const lines: string[] = [];

  switch (resolved.kind) {
    case "EnumType": {
      const valuesVar = toConstName(returnTsType);
      lines.push(
        `  if (!${valuesVar}.includes(raw as ${returnTsType})) {`
      );
      lines.push(`    throw new Error(`);
      lines.push(
        `      \`Invalid output for prompt '${promptName}': expected one of \${${valuesVar}.join(", ")}, got "\${raw}"\``
      );
      lines.push(`    );`);
      lines.push(`  }`);
      lines.push(`  return raw as ${returnTsType};`);
      break;
    }
    case "StructType": {
      lines.push(`  let parsed: unknown;`);
      lines.push(`  try {`);
      lines.push(`    parsed = JSON.parse(raw);`);
      lines.push(`  } catch {`);
      lines.push(
        `    throw new Error(\`Invalid JSON output for prompt '${promptName}': \${raw}\`);`
      );
      lines.push(`  }`);
      lines.push(`  return parsed as ${returnTsType};`);
      break;
    }
    case "PrimitiveType": {
      if (resolved.name === "boolean") {
        lines.push(`  const bool = raw.toLowerCase();`);
        lines.push(`  if (bool !== "true" && bool !== "false") {`);
        lines.push(
          `    throw new Error(\`Invalid boolean output for prompt '${promptName}': "\${raw}"\`);`
        );
        lines.push(`  }`);
        lines.push(`  return (bool === "true") as unknown as ${returnTsType};`);
      } else if (resolved.name === "number") {
        lines.push(`  const num = Number(raw);`);
        lines.push(`  if (isNaN(num)) {`);
        lines.push(
          `    throw new Error(\`Invalid number output for prompt '${promptName}': "\${raw}"\`);`
        );
        lines.push(`  }`);
        lines.push(`  return num as unknown as ${returnTsType};`);
      } else {
        lines.push(`  return raw as unknown as ${returnTsType};`);
      }
      break;
    }
    default: {
      lines.push(`  return raw as unknown as ${returnTsType};`);
      break;
    }
  }

  return lines.join("\n");
}

function compileExpression(
  expr: Expression,
  paramNames: Set<string>,
  stepNames: Set<string>
): string {
  switch (expr.kind) {
    case "Identifier": {
      if (paramNames.has(expr.name)) return `input.${expr.name}`;
      if (stepNames.has(expr.name)) return expr.name;
      throw new CompilerError(`Unknown identifier "${expr.name}" in chain expression`);
    }
    case "StringLiteral":
      return compileStringLiteral(expr.value, expr.isTemplate, paramNames);
    case "NumberLiteral":
      return String(expr.value);
    case "BooleanLiteral":
      return String(expr.value);
    case "MemberExpression": {
      const base = paramNames.has(expr.object)
        ? `input.${expr.object}`
        : stepNames.has(expr.object)
        ? expr.object
        : expr.object;
      return `${base}.${expr.property}`;
    }
    case "CallExpression": {
      const inputObj = compileCallArgs(expr.arguments, paramNames, stepNames);
      return `await ${expr.callee}(${inputObj}, client)`;
    }
  }
}

function compileCallArgs(
  args: CallArgument[],
  paramNames: Set<string>,
  stepNames: Set<string>
): string {
  if (args.length === 0) return "{}";

  const namedArgs = args.filter((a): a is NamedArgument => a.kind === "NamedArgument");

  if (namedArgs.length === args.length) {
    const entries = namedArgs.map(
      (a) => `${a.name}: ${compileExpression(a.value, paramNames, stepNames)}`
    );
    return `{ ${entries.join(", ")} }`;
  }

  // Positional arguments: compile each value in order
  const positional = args.filter((a) => a.kind !== "NamedArgument") as Expression[];
  const entries = positional.map((a) =>
    compileExpression(a, paramNames, stepNames)
  );
  return entries.join(", ");
}
