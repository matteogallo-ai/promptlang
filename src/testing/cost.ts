import type {
  CallExpression,
  Expression,
  Program,
  PromptDeclaration,
  TestDeclaration,
} from "../ast/nodes";
import { buildTypeRegistry, structParamNames, type TypeRegistry } from "../compiler/code-generator";
import { extractTemplateVars } from "../compiler/template-compiler";

type RateCard = readonly [input: number, output: number];

/**
 * Standard Claude API prices in USD per million tokens (input, output), from
 * Anthropic's model documentation as read on 2026-11-03. A model missing here
 * has no estimate, and `promptlang test --live` refuses to run it. `long` is the
 * card a model bills, input and output, for a prompt longer than `above` tokens.
 */
const PRICES_USD_PER_MTOK: Readonly<
  Record<string, { base: RateCard; long?: { above: number; card: RateCard } }>
> = {
  "claude-fable-5-1": { base: [10, 50] },
  "claude-opus-5-5": { base: [4, 20] },
  "claude-opus-5": { base: [5, 25] },
  "claude-opus-4-8": { base: [5, 25] },
  "claude-sonnet-5-5": { base: [2, 10] },
  "claude-sonnet-5": { base: [2, 10] },
  "claude-haiku-5-5": { base: [0.1, 0.5], long: { above: 100_000, card: [0.5, 2.5] } },
  "claude-haiku-4-5": { base: [1, 5] },
};

/**
 * USD per million (input, output) tokens for a prompt of `inputTokens` to
 * `model`, or undefined when the model is not recorded.
 */
export function pricePerMTok(model: string, inputTokens = 0): RateCard | undefined {
  const price = PRICES_USD_PER_MTOK[model];
  if (!price) return undefined;
  return price.long && inputTokens > price.long.above ? price.long.card : price.base;
}

/** USD of one call to `model`, on the rate card its prompt length selects. */
export function callUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = pricePerMTok(model, inputTokens);
  if (!price) throw new UnpricedModelError(`no price is recorded for model ${model}`);
  return (inputTokens * price[0] + outputTokens * price[1]) / 1e6;
}

/** AnthropicClient's max_tokens when the file sets no @max_tokens. */
const DEFAULT_MAX_TOKENS = 1024;
/**
 * Characters per token, deliberately low: English averages ~4, and recent
 * Claude tokenizers count ~30% more tokens for the same text.
 */
export const CHARS_PER_TOKEN = 3;

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
 * Prices one request per entry of `perCall`: its `chars` of text (÷ 3) and its
 * whole `maxTokens` of output, on the rate card its own prompt length selects.
 * The input of each card is rounded up once, not per call, so a cap set to the
 * estimate holds every call it counted (see `worstCaseUsd`).
 */
export function priceEstimate(
  model: string,
  perCall: ReadonlyArray<{ chars: number; maxTokens: number }>
): CostEstimate {
  if (!pricePerMTok(model)) {
    throw new UnpricedModelError(
      `no price is recorded for model ${model} (priced: ${Object.keys(PRICES_USD_PER_MTOK).join(", ")})`
    );
  }
  const inputCharsByCard = new Map<RateCard, number>();
  let outputUsd = 0;
  for (const { chars, maxTokens } of perCall) {
    const card = pricePerMTok(model, chars / CHARS_PER_TOKEN)!;
    inputCharsByCard.set(card, (inputCharsByCard.get(card) ?? 0) + chars);
    outputUsd += (maxTokens * card[1]) / 1_000_000;
  }
  let inputUsd = 0;
  for (const [card, chars] of inputCharsByCard)
    inputUsd += (Math.ceil(chars / CHARS_PER_TOKEN) * card[0]) / 1_000_000;
  return {
    model,
    calls: perCall.length,
    inputTokens: Math.ceil(perCall.reduce((n, c) => n + c.chars, 0) / CHARS_PER_TOKEN),
    maxOutputTokens: perCall.reduce((n, c) => n + c.maxTokens, 0),
    estimatedUsd: inputUsd + outputUsd,
  };
}

/**
 * Characters an earlier step's output is assumed to take per token when a later
 * step inserts it. English runs at about 4; the cap measures that text in
 * characters (÷ 3), so the estimate must not count it shorter than the cap will.
 */
const CARRIED_CHARS_PER_TOKEN = 6;

/**
 * A chain can insert a value its test did not give (an absent optional argument,
 * a missing member: "undefined") or a struct output whole ("[object Object]"):
 * no placeholder in a chain step is counted shorter than that.
 */
const ABSENT_OR_OBJECT_CHARS = "[object Object]".length;

/** The text a literal argument is inserted as: numbers and booleans as String() writes them. */
function literalText(a: CallExpression["arguments"][number]): string | null {
  const v = a.kind === "NamedArgument" ? a.value : a;
  switch (v.kind) {
    case "StringLiteral":
      return v.value;
    case "NumberLiteral":
    case "BooleanLiteral":
      return String(v.value);
    case "Identifier":
      return v.name;
    default:
      return null;
  }
}

/**
 * Characters of one prompt's messages once the arguments are inserted, every
 * `{{name}}` counted each time it appears. A direct call inserts its own
 * arguments by name. A chain step can insert a chain argument, a literal of the
 * step or an earlier step's output, so each placeholder counts as the longest of
 * those. It has to be an upper bound: the cap refuses a call longer than estimated.
 * A struct parameter is inserted as JSON: a literal counts as its JSON text, and
 * text of unknown content as the most JSON can make of it, 6 characters each
 * (`\u001f`) and 2 quotes.
 */
function renderedChars(
  call: CallExpression,
  prompt: PromptDeclaration,
  step: { literals: number[]; earlierSteps: number; maxTokens: number } | null,
  registry: TypeRegistry
): number {
  const json = structParamNames(prompt.parameters, registry);
  const byName = new Map<string, number>();
  call.arguments.forEach((a, i) => {
    const value = literalText(a);
    if (value === null) return;
    const name = a.kind === "NamedArgument" ? a.name : prompt.parameters[i]?.name;
    if (name) byName.set(name, json.has(name) ? JSON.stringify(value).length : value.length);
  });
  const longest = Math.max(
    step ? ABSENT_OR_OBJECT_CHARS : 0,
    ...call.arguments.map((a) => literalText(a)?.length ?? 0),
    ...(step?.literals ?? []),
    step && step.earlierSteps > 0 ? step.maxTokens * CARRIED_CHARS_PER_TOKEN : 0
  );
  let n = 0;
  for (const s of prompt.sections) {
    if (s.kind !== "MessageSection") continue;
    n += s.content.value.length;
    for (const name of extractTemplateVars(s.content.value))
      n += (step ? undefined : byName.get(name)) ?? (json.has(name) ? 6 * longest + 2 : longest);
  }
  return n;
}

/** The calls in `e`, arguments before the call that receives them, as the generated code runs them. */
function callsIn(e: Expression | CallExpression["arguments"][number]): CallExpression[] {
  const v = e.kind === "NamedArgument" ? e.value : e;
  if (v.kind !== "CallExpression") return [];
  return [...v.arguments.flatMap(callsIn), v];
}

/**
 * The prompts one call reaches, in call order, each with the literal arguments
 * of the calls on its way: itself, or every call in a chain's steps and return
 * expression, nested ones included.
 */
function promptsReached(
  program: Program,
  callee: string
): Array<{ prompt: PromptDeclaration; literals: number[] }> {
  for (const d of program.declarations) {
    if (d.kind === "PromptDeclaration" && d.name === callee) return [{ prompt: d, literals: [] }];
    if (d.kind === "ChainDeclaration" && d.name === callee) {
      const calls = [...d.steps.map((s) => s.expression), d.returnExpression].flatMap(callsIn);
      return calls.flatMap((call) => {
        const literals = call.arguments.flatMap((a) => {
          const t = literalText(a);
          return t === null ? [] : [t.length];
        });
        return promptsReached(program, call.callee).map((r) => ({
          prompt: r.prompt,
          literals: [...r.literals, ...literals],
        }));
      });
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

  const registry = buildTypeRegistry(program);
  const perCall: Array<{ chars: number; maxTokens: number }> = [];
  for (const t of tests) {
    const call = t.input as CallExpression;
    const reached = promptsReached(program, call.callee);
    const direct = reached.length === 1 && reached[0]!.prompt.name === call.callee;
    for (const [i, r] of reached.entries()) {
      const step = direct
        ? null
        : { literals: r.literals, earlierSteps: i, maxTokens: perCallOutput };
      perCall.push({
        chars: renderedChars(call, r.prompt, step, registry),
        maxTokens: perCallOutput,
      });
    }
  }
  return priceEstimate(model, perCall);
}
