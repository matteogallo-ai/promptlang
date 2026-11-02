import type { CallExpression, Parameter, Program, TestDeclaration } from "../ast/nodes";
import { CompilerError } from "./errors";

/**
 * Rejects `test` blocks whose `input` does not call a prompt or chain declared in
 * the same file with arguments matching its parameters. Without this, a typo in a
 * test would only surface when `promptlang test` runs, or never, since the
 * compilers emit no code for tests.
 */
export function checkTestReferences(program: Program): void {
  const callables = new Map<string, Parameter[]>();
  for (const d of program.declarations) {
    if (d.kind === "PromptDeclaration" || d.kind === "ChainDeclaration") {
      callables.set(d.name, d.parameters);
    }
  }
  for (const d of program.declarations) {
    if (d.kind === "TestDeclaration") checkTest(d, callables);
  }
}

function fail(test: TestDeclaration, message: string, at: { line: number; column: number }): never {
  throw new CompilerError(`test "${test.description}": ${message}`, at.line, at.column);
}

function checkTest(test: TestDeclaration, callables: Map<string, Parameter[]>): void {
  if (test.input.kind !== "CallExpression") {
    fail(test, 'input must call a prompt or chain, e.g. input: my_prompt(text: "...")', test.input);
  }
  const call: CallExpression = test.input;
  const params = callables.get(call.callee);
  if (!params) {
    const known = [...callables.keys()].join(", ") || "none";
    fail(
      test,
      `input calls '${call.callee}', which is not a prompt or chain in this file (declared: ${known})`,
      call
    );
  }

  const given = new Set<string>();
  const positional = call.arguments.filter((a) => a.kind !== "NamedArgument");
  if (positional.length > params.length) {
    fail(
      test,
      `'${call.callee}' takes ${params.length} parameter(s), got ${positional.length}`,
      call
    );
  }
  for (const p of params.slice(0, positional.length)) given.add(p.name);
  for (const arg of call.arguments) {
    if (arg.kind !== "NamedArgument") continue;
    if (!params.some((p) => p.name === arg.name)) {
      fail(test, `'${call.callee}' has no parameter '${arg.name}'`, arg);
    }
    if (given.has(arg.name)) fail(test, `parameter '${arg.name}' is given twice`, arg);
    given.add(arg.name);
  }
  for (const p of params) {
    if (!p.optional && !given.has(p.name)) {
      fail(test, `missing required parameter '${p.name}' of '${call.callee}'`, call);
    }
  }
}
