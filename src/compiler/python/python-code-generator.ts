import type {
  TypeDeclaration,
  PromptDeclaration,
  ChainDeclaration,
  Program,
  Expression,
  CallArgument,
  NamedArgument,
} from "../../ast/nodes";
import { mapPythonType, toPythonPascalCase, toPythonConstName } from "./python-type-mapper";
import { compilePythonStringLiteral } from "./python-template-compiler";
import { CompilerError } from "../errors";
import { sourceLabel } from "../source-label";
import { optionalParamNames, structParamNames, type TypeRegistry } from "../code-generator";
import { outputSpec } from "../output-schema";
import type { CallableRegistry } from "../chain-compiler";

export function buildCallableRegistryForPython(program: Program): CallableRegistry {
  const registry: CallableRegistry = new Map();
  for (const decl of program.declarations) {
    if (decl.kind === "PromptDeclaration" || decl.kind === "ChainDeclaration") {
      registry.set(decl.name, decl.parameters);
    }
  }
  return registry;
}

export interface CompiledPythonMetadata {
  version?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// TypeDeclaration
// ---------------------------------------------------------------------------

export function generatePythonTypeDeclaration(decl: TypeDeclaration): string {
  const { name, definition } = decl;
  const parts: string[] = [];

  switch (definition.kind) {
    case "EnumType": {
      const vals = definition.values.map((v) => JSON.stringify(v)).join(", ");
      parts.push(`${name} = Literal[${vals}]`);
      parts.push("");
      const constName = toPythonConstName(name);
      parts.push(`${constName}: list[${name}] = [${vals}]`);
      break;
    }
    case "StructType": {
      parts.push(`class ${name}(TypedDict):`);
      if (definition.fields.length === 0) {
        parts.push("    pass");
      } else {
        for (const field of definition.fields) {
          const pyType = mapPythonType(field.type);
          if (field.optional) {
            parts.push(`    ${field.name}: NotRequired[${pyType}]`);
          } else {
            parts.push(`    ${field.name}: ${pyType}`);
          }
        }
      }
      break;
    }
    case "PrimitiveType":
      parts.push(`${name} = ${mapPythonType(definition)}`);
      break;
    case "TypeReference":
      parts.push(`${name} = ${definition.name}`);
      break;
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// PromptDeclaration
// ---------------------------------------------------------------------------

export function generatePythonPromptDeclaration(
  decl: PromptDeclaration,
  meta: CompiledPythonMetadata,
  registry: TypeRegistry,
  sourceFile: string
): string {
  const { name, parameters, returnType, sections } = decl;
  const pascalName = toPythonPascalCase(name);
  const inputTypeName = `${pascalName}Input`;
  const returnPyType = mapPythonType(returnType);
  const paramNames = new Set(parameters.map((p) => p.name));
  const metaConstName = `${name.toUpperCase()}_META`;
  // Private, so `import *` skips it, under a prefix the compiler refuses in user
  // names; the name keeps its case, since `a` and `A` are two prompts.
  const outputConstName = `_promptlang_output_${name}`;

  const parts: string[] = [];

  // The declared output type, as parse_output checks it.
  const spec = JSON.stringify(outputSpec(returnType, registry));
  parts.push(`${outputConstName} = _promptlang_json.loads(${JSON.stringify(spec)})`);
  parts.push("");

  // Meta constant
  parts.push(`${metaConstName} = {`);
  parts.push(`    "name": "${name}",`);
  if (meta.version !== undefined) parts.push(`    "version": "${meta.version}",`);
  if (meta.model !== undefined) parts.push(`    "model": "${meta.model}",`);
  if (meta.temperature !== undefined) parts.push(`    "temperature": ${meta.temperature},`);
  if (meta.maxTokens !== undefined) parts.push(`    "max_tokens": ${meta.maxTokens},`);
  parts.push(`}`);
  parts.push("");

  // Input TypedDict
  parts.push(`class ${inputTypeName}(TypedDict):`);
  if (parameters.length === 0) {
    parts.push("    pass");
  } else {
    for (const p of parameters) {
      const pyType = mapPythonType(p.type);
      parts.push(`    ${p.name}: ${p.optional ? `NotRequired[${pyType}]` : pyType}`);
    }
  }
  parts.push("");

  // Async function
  parts.push(`async def ${name}(`);
  parts.push(`    input: ${inputTypeName},`);
  parts.push(`    client: PromptClient,`);
  parts.push(`) -> ${returnPyType}:`);
  parts.push(`    """Generated from ${sourceLabel(sourceFile)} by PromptLang."""`);

  const messages = sections.filter((s) => s.kind === "MessageSection");
  parts.push(`    request: PromptRequest = {`);
  if (meta.model !== undefined) {
    parts.push(`        "model": ${metaConstName}["model"],`);
  } else {
    parts.push(`        "model": "",`);
  }
  if (meta.temperature !== undefined) {
    parts.push(`        "temperature": ${metaConstName}["temperature"],`);
  }
  if (meta.maxTokens !== undefined) {
    parts.push(`        "max_tokens": ${metaConstName}["max_tokens"],`);
  }
  parts.push(`        "messages": [`);
  for (const section of messages) {
    if (section.kind !== "MessageSection") continue;
    const content = compilePythonStringLiteral(
      section.content.value,
      section.content.isTemplate,
      paramNames,
      optionalParamNames(parameters),
      structParamNames(parameters, registry)
    );
    parts.push(`            {`);
    parts.push(`                "role": "${section.role}",`);
    parts.push(`                "content": ${content},`);
    parts.push(`            },`);
  }
  parts.push(`        ],`);
  parts.push(`    }`);
  parts.push("");
  parts.push(`    response = await client.complete(request)`);
  parts.push(`    raw = response["content"].strip()`);
  parts.push("");

  parts.push(`    return _promptlang_parse_output("${name}", raw, ${outputConstName})`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// ChainDeclaration
// ---------------------------------------------------------------------------

export function generatePythonChain(
  decl: ChainDeclaration,
  callableRegistry: CallableRegistry,
  sourceFile: string
): string {
  const { name, parameters, returnType, steps, returnExpression } = decl;
  const pascalName = toPythonPascalCase(name);
  const inputTypeName = `${pascalName}Input`;
  const returnPyType = mapPythonType(returnType);
  const paramNames = new Set(parameters.map((p) => p.name));
  const allStepNames = new Set(steps.map((s) => s.name));

  const parts: string[] = [];

  // Input TypedDict
  parts.push(`class ${inputTypeName}(TypedDict):`);
  if (parameters.length === 0) {
    parts.push("    pass");
  } else {
    for (const p of parameters) {
      const pyType = mapPythonType(p.type);
      parts.push(`    ${p.name}: ${p.optional ? `NotRequired[${pyType}]` : pyType}`);
    }
  }
  parts.push("");

  // Async chain function
  parts.push(`async def ${name}(`);
  parts.push(`    input: ${inputTypeName},`);
  parts.push(`    client: PromptClient,`);
  parts.push(`) -> ${returnPyType}:`);
  parts.push(`    """Generated from ${sourceLabel(sourceFile)} by PromptLang."""`);

  const stepNames = new Set<string>();
  for (const step of steps) {
    const expr = compilePythonExpr(
      step.expression,
      paramNames,
      stepNames,
      allStepNames,
      name,
      step.name,
      callableRegistry
    );
    parts.push(`    ${step.name} = ${expr}`);
    stepNames.add(step.name);
  }

  const retExpr = compilePythonExpr(
    returnExpression,
    paramNames,
    stepNames,
    allStepNames,
    name,
    "return",
    callableRegistry
  );
  parts.push(`    return ${retExpr}`);

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compilePythonExpr(
  expr: Expression,
  paramNames: Set<string>,
  stepNames: Set<string>,
  allStepNames: Set<string>,
  chainName: string,
  context: string,
  callableRegistry: CallableRegistry
): string {
  switch (expr.kind) {
    case "Identifier":
      return resolvePythonIdent(expr.name, paramNames, stepNames, allStepNames, chainName, context);

    case "StringLiteral":
      return JSON.stringify(expr.value);

    case "NumberLiteral":
      return String(expr.value);

    case "BooleanLiteral":
      return expr.value ? "True" : "False";

    case "MemberExpression": {
      const base = resolvePythonIdent(
        expr.object,
        paramNames,
        stepNames,
        allStepNames,
        chainName,
        context
      );
      return `${base}["${expr.property}"]`;
    }

    case "CallExpression": {
      const argsDict = compilePythonCallArgs(
        expr.callee,
        expr.arguments,
        paramNames,
        stepNames,
        allStepNames,
        chainName,
        context,
        callableRegistry
      );
      return `await ${expr.callee}(${argsDict}, client)`;
    }
  }
}

function resolvePythonIdent(
  name: string,
  paramNames: Set<string>,
  stepNames: Set<string>,
  allStepNames: Set<string>,
  chainName: string,
  context: string
): string {
  if (paramNames.has(name)) return `input["${name}"]`;
  if (stepNames.has(name)) return name;
  if (allStepNames.has(name)) {
    throw new CompilerError(
      `Chain '${chainName}': step '${context}' references '${name}' which is defined later.`
    );
  }
  throw new CompilerError(`Chain '${chainName}': step '${context}' references undefined '${name}'`);
}

function compilePythonCallArgs(
  callee: string,
  args: CallArgument[],
  paramNames: Set<string>,
  stepNames: Set<string>,
  allStepNames: Set<string>,
  chainName: string,
  context: string,
  callableRegistry: CallableRegistry
): string {
  if (args.length === 0) return "{}";

  const allNamed = args.every((a) => a.kind === "NamedArgument");

  if (allNamed) {
    const entries = (args as NamedArgument[]).map((a) => {
      const val = compilePythonExpr(
        a.value,
        paramNames,
        stepNames,
        allStepNames,
        chainName,
        context,
        callableRegistry
      );
      return `"${a.name}": ${val}`;
    });
    return `{${entries.join(", ")}}`;
  }

  const calleeParams = callableRegistry.get(callee);
  if (!calleeParams) {
    throw new CompilerError(
      `Chain '${chainName}': step '${context}' calls unknown function '${callee}'`
    );
  }

  const positional = args.filter(
    (a): a is Expression => a.kind !== "NamedArgument"
  ) as Expression[];
  const entries = positional.map((arg, i) => {
    const paramName = calleeParams[i]!.name;
    const val = compilePythonExpr(
      arg,
      paramNames,
      stepNames,
      allStepNames,
      chainName,
      context,
      callableRegistry
    );
    return `"${paramName}": ${val}`;
  });
  return `{${entries.join(", ")}}`;
}
