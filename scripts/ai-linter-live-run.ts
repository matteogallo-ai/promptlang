#!/usr/bin/env bun
/**
 * One live run of the AI linter on docs/examples plus an adversarial fixture,
 * recorded as docs/ai-linter-run/live-run.json (model, tokens, cost, issues).
 *
 *   bun run scripts/ai-linter-live-run.ts          # print the estimate, call nothing
 *   bun run scripts/ai-linter-live-run.ts --yes    # run once (needs ANTHROPIC_API_KEY)
 *
 * The worst-case estimate (every call uses its full max_tokens) must be at or
 * under BUDGET_USD, the spend approved for this run, or nothing is called.
 */
import { resolve } from "node:path";
import { AiLinter } from "../src/analyzer/ai/ai-linter";
import {
  AI_LINTER_SYSTEM_PROMPT,
  buildAnalysisUserMessage,
} from "../src/analyzer/ai/prompts/analysis-prompt";
import type { AnalysisContext } from "../src/analyzer/analyzer";
import { tokenize } from "../src/lexer/lexer";
import { parse } from "../src/parser/parser";
import type { PromptClient } from "../src/runtime/client";
import { AnthropicClient } from "../src/runtime/providers/anthropic-client";
import { pricePerMTok } from "../src/testing/cost";

export const BUDGET_USD = 0.05;
const MODEL = "claude-haiku-4-5";
/** AiLinter sends max_tokens 1024 per prompt. */
const MAX_OUTPUT_TOKENS = 1024;
const ROOT = resolve(import.meta.dir, "..");
const FILES = [
  "docs/examples/classify-ticket.prompt",
  "docs/examples/extract-invoice.prompt",
  "docs/examples/summarize-and-translate.prompt",
  "docs/ai-linter-run/adversarial.prompt",
];

export async function loadContexts(): Promise<AnalysisContext[]> {
  return Promise.all(
    FILES.map(async (file) => ({
      file,
      ast: parse(tokenize(await Bun.file(resolve(ROOT, file)).text())),
    }))
  );
}

function price(): readonly [number, number] {
  const p = pricePerMTok(MODEL);
  if (!p) throw new Error(`no price recorded for ${MODEL}`);
  return p;
}

/** Worst case: characters ÷ 3 input tokens, full max_tokens output, per prompt. */
export function estimate(contexts: AnalysisContext[]): {
  calls: number;
  inputTokens: number;
  maxUsd: number;
} {
  let calls = 0;
  let chars = 0;
  for (const ctx of contexts) {
    for (const d of ctx.ast.declarations) {
      if (d.kind !== "PromptDeclaration") continue;
      calls++;
      chars += AI_LINTER_SYSTEM_PROMPT.length + buildAnalysisUserMessage(d).length;
    }
  }
  const inputTokens = Math.ceil(chars / 3);
  const [inPrice, outPrice] = price();
  return {
    calls,
    inputTokens,
    maxUsd: (inputTokens * inPrice + calls * MAX_OUTPUT_TOKENS * outPrice) / 1e6,
  };
}

export interface RunRecord {
  date: string;
  model: string;
  anthropic_version: string;
  files: string[];
  estimate_max_usd: number;
  calls: Array<{ input_tokens: number; output_tokens: number }>;
  usage: { input_tokens: number; output_tokens: number };
  cost_usd: number;
  price_usd_per_mtok: { input: number; output: number };
  issues: Array<{ file: string; rule: string; severity: string; message: string }>;
  note: string;
}

/** Runs the linter once through `client`, recording the usage of every call. */
export async function run(
  client: PromptClient,
  contexts: AnalysisContext[],
  now: Date
): Promise<RunRecord> {
  const calls: RunRecord["calls"] = [];
  const metered: PromptClient = {
    async complete(req) {
      const res = await client.complete(req);
      calls.push({
        input_tokens: res.usage?.input_tokens ?? 0,
        output_tokens: res.usage?.output_tokens ?? 0,
      });
      return res;
    },
  };
  const issues = await new AiLinter({ client: metered, model: MODEL }).analyze(contexts);
  const usage = calls.reduce(
    (u, c) => ({
      input_tokens: u.input_tokens + c.input_tokens,
      output_tokens: u.output_tokens + c.output_tokens,
    }),
    { input_tokens: 0, output_tokens: 0 }
  );
  const [inPrice, outPrice] = price();
  return {
    date: now.toISOString(),
    model: MODEL,
    anthropic_version: "2023-06-01",
    files: FILES,
    estimate_max_usd: estimate(contexts).maxUsd,
    calls,
    usage,
    cost_usd: (usage.input_tokens * inPrice + usage.output_tokens * outPrice) / 1e6,
    price_usd_per_mtok: { input: inPrice, output: outPrice },
    issues: issues.map((i) => ({
      file: i.file,
      rule: i.rule,
      severity: i.severity,
      message: i.message,
    })),
    note: "One run on five prompts. It shows what the linter returned once; it is not a measure of its precision or recall.",
  };
}

if (import.meta.main) {
  const contexts = await loadContexts();
  const e = estimate(contexts);
  console.log(
    `${e.calls} call(s) to ${MODEL}, ~${e.inputTokens} input tokens, worst case $${e.maxUsd.toFixed(4)} (budget $${BUDGET_USD})`
  );
  if (e.maxUsd > BUDGET_USD) {
    console.error("Estimate exceeds the approved budget; nothing was called.");
    process.exit(2);
  }
  if (!process.argv.includes("--yes")) {
    console.log("Estimate only. Re-run with --yes to make the calls.");
    process.exit(0);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set; nothing was called.");
    process.exit(2);
  }
  const record = await run(new AnthropicClient({ apiKey }), contexts, new Date());
  const out = resolve(ROOT, "docs/ai-linter-run/live-run.json");
  await Bun.write(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    `Spent $${record.cost_usd.toFixed(5)} (${record.usage.input_tokens} in / ${record.usage.output_tokens} out). Wrote ${out}`
  );
}
