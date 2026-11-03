import type {
  CallExpression,
  Expression,
  Literal,
  Program,
  TestDeclaration,
  TypeExpression,
} from "../ast/nodes";
import { compile } from "../compiler/compiler";
import { MockClient, type PromptClient } from "../runtime/client";
import {
  AuthenticationError,
  IncompleteResponseError,
  InvalidRequestError,
  NotFoundError,
  PromptClientError,
} from "../runtime/errors";
import type { PromptRequest, PromptResponse } from "../runtime/types";
import { importCompiled } from "./load-compiled";
import { BudgetExceededError } from "./budget";
import { schemaErrors } from "./schema";

/**
 * Why a call got no answer. `configuration`: the provider refused what was sent
 * (key, model, parameters), the answer was cut at `@max_tokens`, refused, stopped
 * early or empty, or the call would have passed the approved budget, so retrying
 * changes nothing until the file, the key or the approval changes. `provider`:
 * timeout, network, rate limit, server or a malformed body, which a later retry
 * can clear.
 */
export interface ProviderFailure {
  kind: "configuration" | "provider";
  message: string;
}

function classify(error: PromptClientError): ProviderFailure {
  const configuration =
    error instanceof BudgetExceededError ||
    error instanceof AuthenticationError ||
    error instanceof InvalidRequestError ||
    error instanceof IncompleteResponseError ||
    error instanceof NotFoundError;
  return {
    kind: configuration ? "configuration" : "provider",
    message: `${error.name}: ${error.message}`,
  };
}

export interface TestResult {
  file: string;
  test: string;
  line: number;
  passed: boolean;
  /** One line per failed assertion, or why the test could not run. */
  failures: string[];
  /** Set when the call failed (timeout, network, auth…): the test has no verdict. */
  providerError?: ProviderFailure;
  output?: unknown;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * `mock`: each test replays its `mock:` response through the generated code.
 * `live`: each test calls `client` (a real provider; the caller handles cost).
 */
export type RunMode = { kind: "mock" } | { kind: "live"; client: PromptClient };

type Callable = (input: Record<string, unknown>, client: PromptClient) => Promise<unknown>;

/**
 * Runs every `test` block of a program against the TypeScript the compiler
 * generates for it, so tests exercise the real request building and output
 * parsing. `compile()` also rejects tests on unknown prompts (CompilerError).
 */
export async function runTests(
  program: Program,
  file: string,
  mode: RunMode
): Promise<TestResult[]> {
  const tests = program.declarations.filter(
    (d): d is TestDeclaration => d.kind === "TestDeclaration"
  );
  if (tests.length === 0) return [];
  const module = await importCompiled<Record<string, Callable>>(compile(program, file));
  const results: TestResult[] = [];
  for (const t of tests) results.push(await runOne(t, program, file, module, mode));
  return results;
}

function literalValue(e: Literal | Expression): unknown {
  switch (e.kind) {
    case "StringLiteral":
    case "NumberLiteral":
    case "BooleanLiteral":
      return e.value;
    // A bare identifier is an enum member (`expect: bug`, `kind: urgent`).
    case "Identifier":
      return e.name;
    default:
      throw new TestInputError(`test inputs must be literals; '${e.kind}' is not supported`);
  }
}

class TestInputError extends Error {}

function inputOf(call: CallExpression, program: Program): Record<string, unknown> {
  const decl = program.declarations.find(
    (d) =>
      (d.kind === "PromptDeclaration" || d.kind === "ChainDeclaration") && d.name === call.callee
  );
  const params =
    decl?.kind === "PromptDeclaration" || decl?.kind === "ChainDeclaration" ? decl.parameters : [];
  const input: Record<string, unknown> = {};
  call.arguments.forEach((arg, i) => {
    if (arg.kind === "NamedArgument") input[arg.name] = literalValue(arg.value);
    else input[params[i]!.name] = literalValue(arg);
  });
  return input;
}

function returnTypeOf(program: Program, name: string): TypeExpression | undefined {
  for (const d of program.declarations) {
    if ((d.kind === "PromptDeclaration" || d.kind === "ChainDeclaration") && d.name === name)
      return d.returnType;
  }
  return undefined;
}

/** Records token usage while delegating, so live runs report what they spent. */
function metered(client: PromptClient, usage: TestResult["usage"]): PromptClient {
  return {
    async complete(request: PromptRequest): Promise<PromptResponse> {
      const add = (u: PromptResponse["usage"]) => {
        usage.input_tokens += u?.input_tokens ?? 0;
        usage.output_tokens += u?.output_tokens ?? 0;
      };
      try {
        const response = await client.complete(request);
        add(response.usage);
        return response;
      } catch (error) {
        // A cut or refused answer was billed: count it, then let the caller see the error.
        if (error instanceof IncompleteResponseError) add(error.usage);
        throw error;
      }
    },
  };
}

async function runOne(
  t: TestDeclaration,
  program: Program,
  file: string,
  module: Record<string, Callable>,
  mode: RunMode
): Promise<TestResult> {
  const usage = { input_tokens: 0, output_tokens: 0 };
  const result = (failures: string[], output?: unknown): TestResult => ({
    file,
    test: t.description,
    line: t.line,
    passed: failures.length === 0,
    failures,
    ...(output === undefined ? {} : { output }),
    usage,
  });

  // checkTestReferences (run by compile) guarantees a call to a declared callable.
  const call = t.input as CallExpression;
  let base: PromptClient;
  if (mode.kind === "live") base = mode.client;
  else if (t.mock) {
    const mock = t.mock.value;
    // Every model call of the test (one per step for a chain) gets the same response.
    base = new MockClient(() => ({ content: mock }));
  } else {
    return result([
      'no mock: response to replay; add `mock: "..."` to the test, or run with --live',
    ]);
  }

  let input: Record<string, unknown>;
  try {
    input = inputOf(call, program);
  } catch (error) {
    if (error instanceof TestInputError) return result([error.message]);
    throw error;
  }

  let output: unknown;
  try {
    output = await module[call.callee]!(input, metered(base, usage));
  } catch (error) {
    // An infrastructure failure is not a verdict on the prompt; report it apart.
    if (error instanceof PromptClientError) {
      return { ...result([]), passed: false, providerError: classify(error) };
    }
    // Whatever else the prompt raises (an enum value outside the type, malformed
    // JSON) is the test's verdict, recorded with its message, not a runner crash.
    return result([
      `${call.callee} threw: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  const failures: string[] = [];
  for (const e of t.expectations) {
    const field = e.path[1];
    const label = e.path.join(".");
    let actual: unknown = output;
    if (field !== undefined) {
      if (typeof output !== "object" || output === null) {
        failures.push(`${label}: output is not a struct, got ${JSON.stringify(output)}`);
        continue;
      }
      actual = (output as Record<string, unknown>)[field];
    }
    const expected = literalValue(e.value);
    if (e.op === "equals") {
      if (actual !== expected)
        failures.push(
          `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
        );
    } else if (typeof actual !== "string") {
      failures.push(`${label} ${e.op}: expected a string, got ${JSON.stringify(actual)}`);
    } else if (e.op === "contains" && !actual.includes(String(expected))) {
      failures.push(
        `${label} contains: ${JSON.stringify(actual)} does not contain ${JSON.stringify(expected)}`
      );
    } else if (e.op === "matches" && !new RegExp(String(expected)).test(actual)) {
      failures.push(
        `${label} matches: ${JSON.stringify(actual)} does not match /${String(expected)}/`
      );
    }
  }
  if (t.expectsSchema) {
    const type = returnTypeOf(program, call.callee);
    const types = new Map<string, TypeExpression>();
    for (const d of program.declarations)
      if (d.kind === "TypeDeclaration") types.set(d.name, d.definition);
    if (type) failures.push(...schemaErrors(output, type, types).map((m) => `expect schema: ${m}`));
  }
  return result(failures, output);
}
