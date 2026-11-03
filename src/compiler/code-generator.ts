import type {
  TypeDeclaration,
  PromptDeclaration,
  TypeExpression,
  Program,
  Parameter,
} from "../ast/nodes";
import { mapType, toPascalCase } from "./type-mapper";
import { outputSpec } from "./output-schema";
import { compileStringLiteral } from "./template-compiler";

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
  // What parseOutput checks the answer against: the declared output type, as data.
  parts.push(
    `const ${name}_output: OutputSpec = ${JSON.stringify(outputSpec(returnType, registry))};`
  );
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
      paramNames,
      optionalParamNames(parameters)
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

  parts.push(
    `  return parseOutput(${JSON.stringify(name)}, raw, ${name}_output) as ${returnTsType};`
  );
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

export function optionalParamNames(params: readonly Parameter[]): Set<string> {
  return new Set(params.filter((p) => p.optional).map((p) => p.name));
}

/** `export interface XInput { ... }` for a prompt's or chain's parameters. */
export function generateInputInterface(inputType: string, params: readonly Parameter[]): string {
  if (params.length === 0) {
    return `export interface ${inputType} {}`;
  }
  const lines: string[] = [];
  lines.push(`export interface ${inputType} {`);
  for (const p of params) {
    lines.push(`  ${p.name}${p.optional ? "?" : ""}: ${mapType(p.type)};`);
  }
  lines.push("}");
  return lines.join("\n");
}
