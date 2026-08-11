import type {
  ChainDeclaration,
  Program,
  Expression,
  CallArgument,
  NamedArgument,
  Parameter,
} from "../ast/nodes";
import { mapType, toPascalCase } from "./type-mapper";
import { CompilerError } from "./errors";

// Maps callee name (prompt or chain) → ordered parameter list.
export type CallableRegistry = Map<string, readonly Parameter[]>;

export function buildCallableRegistry(program: Program): CallableRegistry {
  const registry: CallableRegistry = new Map();
  for (const decl of program.declarations) {
    if (decl.kind === "PromptDeclaration" || decl.kind === "ChainDeclaration") {
      registry.set(decl.name, decl.parameters);
    }
  }
  return registry;
}

export function generateChain(
  decl: ChainDeclaration,
  callableRegistry: CallableRegistry
): string {
  const { name, parameters, returnType, steps, returnExpression } = decl;
  const pascalName = toPascalCase(name);
  const inputType = `${pascalName}Input`;
  const returnTsType = mapType(returnType);
  const paramNames = new Set(parameters.map((p) => p.name));
  const allStepNames = new Set(steps.map((s) => s.name));

  const parts: string[] = [];

  // Input interface
  if (parameters.length === 0) {
    parts.push(`export interface ${inputType} {}`);
  } else {
    parts.push(`export interface ${inputType} {`);
    for (const p of parameters) {
      parts.push(`  ${p.name}: ${mapType(p.type)};`);
    }
    parts.push("}");
  }
  parts.push("");

  // Async function
  parts.push(`export async function ${name}(`);
  parts.push(`  input: ${inputType},`);
  parts.push(`  client: PromptClient`);
  parts.push(`): Promise<${returnTsType}> {`);

  const stepNames = new Set<string>();
  for (const step of steps) {
    const expr = compileExpr(
      step.expression,
      paramNames,
      stepNames,
      allStepNames,
      name,
      step.name,
      callableRegistry
    );
    parts.push(`  const ${step.name} = ${expr};`);
    stepNames.add(step.name);
  }

  const retExpr = compileExpr(
    returnExpression,
    paramNames,
    stepNames,
    allStepNames,
    name,
    "return",
    callableRegistry
  );
  parts.push(`  return ${retExpr};`);
  parts.push("}");

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Expression compilation
// ---------------------------------------------------------------------------

function compileExpr(
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
      return resolveIdent(expr.name, paramNames, stepNames, allStepNames, chainName, context);

    case "StringLiteral":
      return JSON.stringify(expr.value);

    case "NumberLiteral":
      return String(expr.value);

    case "BooleanLiteral":
      return String(expr.value);

    case "MemberExpression": {
      const base = resolveIdent(expr.object, paramNames, stepNames, allStepNames, chainName, context);
      return `${base}.${expr.property}`;
    }

    case "CallExpression": {
      const argsObj = compileCallArgs(
        expr.callee,
        expr.arguments,
        paramNames,
        stepNames,
        allStepNames,
        chainName,
        context,
        callableRegistry
      );
      return `await ${expr.callee}(${argsObj}, client)`;
    }
  }
}

function resolveIdent(
  name: string,
  paramNames: Set<string>,
  stepNames: Set<string>,
  allStepNames: Set<string>,
  chainName: string,
  context: string
): string {
  if (paramNames.has(name)) return `input.${name}`;
  if (stepNames.has(name)) return name;
  if (allStepNames.has(name)) {
    throw new CompilerError(
      `Chain '${chainName}': step '${context}' references '${name}' which is defined later. Steps must be linear.`
    );
  }
  throw new CompilerError(
    `Chain '${chainName}': step '${context}' references undefined '${name}'`
  );
}

function compileCallArgs(
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
      const val = compileExpr(a.value, paramNames, stepNames, allStepNames, chainName, context, callableRegistry);
      return `${a.name}: ${val}`;
    });
    return `{ ${entries.join(", ")} }`;
  }

  // Positional: map by position to callee's parameter names
  const calleeParams = callableRegistry.get(callee);
  if (!calleeParams) {
    throw new CompilerError(
      `Chain '${chainName}': step '${context}' calls unknown function '${callee}'`
    );
  }

  const positional = args.filter((a): a is Expression => a.kind !== "NamedArgument") as Expression[];
  if (positional.length > calleeParams.length) {
    throw new CompilerError(
      `Chain '${chainName}': step '${context}' calls '${callee}' with ${positional.length} args but it only accepts ${calleeParams.length}`
    );
  }

  const entries = positional.map((arg, i) => {
    const paramName = calleeParams[i]!.name;
    const val = compileExpr(arg, paramNames, stepNames, allStepNames, chainName, context, callableRegistry);
    return `${paramName}: ${val}`;
  });
  return `{ ${entries.join(", ")} }`;
}
