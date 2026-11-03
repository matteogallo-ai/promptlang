#!/usr/bin/env bun
/**
 * One live run of the AI linter on docs/examples plus an adversarial fixture,
 * recorded under runs/live/ (date, model, prompt versions, tokens, cost, outcome),
 * as docs/ENGINEERING_STANDARDS.md requires for LLM features.
 *
 *   bun run scripts/ai-linter-live-run.ts          # print the estimate, call nothing
 *   bun run scripts/ai-linter-live-run.ts --yes    # run once (needs ANTHROPIC_API_KEY)
 *
 * The estimate (every call at its full max_tokens, input ≈ characters ÷ 3, no
 * retries: the client is built with maxRetries 0) must be at or under
 * BUDGET_USD, the spend approved for this run, or nothing is called.
 */
import { resolve } from "node:path";
import { AI_LINTER_MODEL, AiLinter } from "../src/analyzer/ai/ai-linter";
import { estimateLinterCost } from "../src/analyzer/ai/estimate";
import type { AnalysisContext } from "../src/analyzer/analyzer";
import { tokenize } from "../src/lexer/lexer";
import { parse } from "../src/parser/parser";
import type { PromptClient } from "../src/runtime/client";
import {
  AnthropicClient,
  DEFAULT_ANTHROPIC_VERSION,
} from "../src/runtime/providers/anthropic-client";
import { callUsd, pricePerMTok } from "../src/testing/cost";

export const BUDGET_USD = 0.05;
const MODEL = AI_LINTER_MODEL;
/** Passed to the client explicitly so the record states the version actually sent. */
const ANTHROPIC_VERSION = DEFAULT_ANTHROPIC_VERSION;
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

export interface RunRecord {
  date: string;
  model: string;
  anthropic_version: string;
  files: Array<{ file: string; version: string | null }>;
  estimate_usd: number;
  calls: Array<{ input_tokens: number; output_tokens: number }>;
  usage: { input_tokens: number; output_tokens: number };
  cost_usd: number;
  price_usd_per_mtok: { input: number; output: number };
  issues: Array<{ file: string; rule: string; severity: string; message: string }>;
  /** "ok", or "provider-errors" when at least one call failed (see ai:request-failure issues). */
  outcome: "ok" | "provider-errors";
  note: string;
}

/** Runs the linter once through `client`, recording the usage of every call. */
export async function run(
  client: PromptClient,
  contexts: AnalysisContext[],
  now: Date,
  anthropicVersion: string
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
    anthropic_version: anthropicVersion,
    files: contexts.map((c) => {
      const v = c.ast.metadata.find((m) => m.kind === "VersionMetadata");
      return { file: c.file, version: v?.kind === "VersionMetadata" ? v.value : null };
    }),
    estimate_usd: estimateLinterCost(contexts, MODEL).estimatedUsd,
    calls,
    usage,
    // Priced call by call: a long-context rate applies to one call's prompt, not to the total.
    cost_usd: calls.reduce((s, c) => s + callUsd(MODEL, c.input_tokens, c.output_tokens), 0),
    price_usd_per_mtok: { input: inPrice, output: outPrice },
    issues: issues.map((i) => ({
      file: i.file,
      rule: i.rule,
      severity: i.severity,
      message: i.message,
    })),
    outcome: issues.some((i) => i.rule === "ai:request-failure") ? "provider-errors" : "ok",
    note:
      "One run on five prompts: what the linter returned once, not a measure of its precision or recall. " +
      "cost_usd counts the usage the API reported; a failed call reports none.",
  };
}

if (import.meta.main) {
  const contexts = await loadContexts();
  const e = estimateLinterCost(contexts, MODEL);
  console.log(
    `${e.calls} call(s) to ${MODEL}, ~${e.inputTokens} input tokens, estimate $${e.estimatedUsd.toFixed(4)} at full max_tokens, no retries (budget $${BUDGET_USD})`
  );
  if (e.estimatedUsd > BUDGET_USD) {
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
  const now = new Date();
  const client = new AnthropicClient({ apiKey, maxRetries: 0, apiVersion: ANTHROPIC_VERSION });
  const record = await run(client, contexts, now, ANTHROPIC_VERSION);
  // Failed runs are committed too: the name carries the time, so a second run never overwrites the first.
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const out = resolve(ROOT, `runs/live/ai-linter-${stamp}.json`);
  await Bun.write(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    `Spent $${record.cost_usd.toFixed(5)} (${record.usage.input_tokens} in / ${record.usage.output_tokens} out). Wrote ${out}`
  );
}
