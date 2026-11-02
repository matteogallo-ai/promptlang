import type { CallExpression, Program, PromptDeclaration, TestDeclaration } from "../ast/nodes";

/**
 * Standard Claude API prices in USD per million tokens (input, output), from
 * Anthropic's model documentation as read on 2026-11-02. A model missing here
 * has no estimate, and `promptlang test --live` refuses to run it.
 */
const PRICES_USD_PER_MTOK: Readonly<Record<string, readonly [number, number]>> = {
  "claude-fable-5-1": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  // The 100K-tokens-or-fewer rate card; test prompts are far below that.
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-haiku-4-5": [1, 5],
};

/** USD per million (input, output) tokens for `model`, or undefined when not recorded. */
export function pricePerMTok(model: string): readonly [number, number] | undefined {
  return PRICES_USD_PER_MTOK[model];
}

/** AnthropicClient's max_tokens when the file sets no @max_tokens. */
const DEFAULT_MAX_TOKENS = 1024;
/**
 * Characters per token, deliberately low: English averages ~4, and recent
 * Claude tokenizers count ~30% more tokens for the same text.
 */
const CHARS_PER_TOKEN = 3;

export interface CostEstimate {
  model: string;
  calls: number;
  inputTokens: number;
  /** Every call is assumed to use its whole max_tokens (the output side of the estimate). */
  maxOutputTokens: number;
  estimatedUsd: number;
}

export class UnpricedModelError extends Error {}

/**
 * Prices `calls` requests to `model`: `inputChars` of text (÷ 3) plus
 * `extraInputTokens` already counted in tokens, and `maxOutputTokens` in all.
 */
export function priceEstimate(
  model: string,
  calls: number,
  inputChars: number,
  extraInputTokens: number,
  maxOutputTokens: number
): CostEstimate {
  const price = pricePerMTok(model);
  if (!price) {
    throw new UnpricedModelError(
      `no price is recorded for model ${model} (priced: ${Object.keys(PRICES_USD_PER_MTOK).join(", ")})`
    );
  }
  const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN) + extraInputTokens;
  const estimatedUsd = (inputTokens * price[0] + maxOutputTokens * price[1]) / 1_000_000;
  return { model, calls, inputTokens, maxOutputTokens, estimatedUsd };
}

function argChars(call: CallExpression): number {
  let n = 0;
  for (const a of call.arguments) {
    const v = a.kind === "NamedArgument" ? a.value : a;
    if (v.kind === "StringLiteral") n += v.value.length;
  }
  return n;
}

/** The prompts one call reaches: itself, or each prompt step of a chain. */
function promptsReached(program: Program, callee: string): PromptDeclaration[] {
  for (const d of program.declarations) {
    if (d.kind === "PromptDeclaration" && d.name === callee) return [d];
    if (d.kind === "ChainDeclaration" && d.name === callee) {
      return d.steps.flatMap((s) =>
        s.expression.kind === "CallExpression" ? promptsReached(program, s.expression.callee) : []
      );
    }
  }
  return [];
}

/**
 * Cost of running `program`'s tests once against its @model, with every call
 * at its full max_tokens and no retries. Input is approximated (characters ÷ 3),
 * so the figure is an estimate, not a guarantee.
 */
export function estimateLiveCost(program: Program): CostEstimate | null {
  const tests = program.declarations.filter(
    (d): d is TestDeclaration => d.kind === "TestDeclaration"
  );
  if (tests.length === 0) return null;
  const model = program.metadata.find((m) => m.kind === "ModelMetadata")?.value;
  if (typeof model !== "string")
    throw new UnpricedModelError("the file has tests but no @model to price them on");
  const maxTokens = program.metadata.find((m) => m.kind === "MaxTokensMetadata")?.value;
  const perCallOutput = typeof maxTokens === "number" ? maxTokens : DEFAULT_MAX_TOKENS;

  let calls = 0;
  let inputChars = 0;
  // For chains, every earlier step's whole output is charged once to each later step's input;
  // a step that interpolates an earlier output twice is still counted once.
  let carriedTokens = 0;
  for (const t of tests) {
    const call = t.input as CallExpression;
    const reached = promptsReached(program, call.callee);
    for (const [i, p] of reached.entries()) {
      calls++;
      carriedTokens += i * perCallOutput;
      inputChars += argChars(call);
      for (const s of p.sections)
        if (s.kind === "MessageSection") inputChars += s.content.value.length;
    }
  }
  return priceEstimate(model, calls, inputChars, carriedTokens, calls * perCallOutput);
}
