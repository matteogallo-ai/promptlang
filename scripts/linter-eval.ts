#!/usr/bin/env bun
/**
 * Measures the AI linter against the labelled corpus in evals/linter/: each case
 * is linted REPEATS times, so the run-to-run noise is measured with the metrics.
 *
 *   bun run scripts/linter-eval.ts          # check the corpus, print the estimate, call nothing
 *   bun run scripts/linter-eval.ts --yes    # run once (needs ANTHROPIC_API_KEY)
 *
 * The estimate (every call at its full max_tokens, input ≈ characters ÷ 3) must
 * be at or under BUDGET_USD, or nothing is called; the run itself goes through
 * BudgetedClient, which sends no call whose estimated worst case would pass the
 * estimate. The record is written under runs/live/ and its SHA-256 appended to
 * runs/live/SHA256SUMS.
 */
import { appendFile } from "node:fs/promises";
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
import { BudgetedClient } from "../src/testing/budget";
import { checksumMismatches, sha256 } from "./checksums";
import { pricePerMTok } from "../src/testing/cost";
import {
  type CaseResult,
  categoryOf,
  percentile,
  type Score,
  scoreCases,
} from "./linter-eval-metrics";

/** The most one run may be estimated at; the approval asked for is the estimate itself. */
export const BUDGET_USD = 1;
export const REPEATS = 2;
const CONCURRENCY = 3;
const ROOT = resolve(import.meta.dir, "..");
const CORPUS = resolve(ROOT, "evals/linter");

export interface Labels {
  version: string;
  categories: string[];
  cases: Array<{
    id: string;
    file: string;
    split: "dev" | "test";
    base: string;
    defects: string[];
  }>;
}

export interface Corpus {
  labels: Labels;
  /** SHA-256 of evals/linter/SHA256SUMS: names the exact corpus a record was measured on. */
  sha256: string;
  contexts: Map<string, AnalysisContext>;
}

export async function loadCorpus(dir: string = CORPUS): Promise<Corpus> {
  const bad = await checksumMismatches(dir);
  if (bad.length > 0) throw new Error(`the corpus differs from its SHA256SUMS: ${bad.join("; ")}`);
  const labels = (await Bun.file(resolve(dir, "labels.json")).json()) as Labels;
  const contexts = new Map<string, AnalysisContext>();
  for (const c of labels.cases)
    contexts.set(c.id, {
      file: `evals/linter/${c.file}`,
      ast: parse(tokenize(await Bun.file(resolve(dir, c.file)).text())),
    });
  return { labels, sha256: sha256(await Bun.file(resolve(dir, "SHA256SUMS")).text()), contexts };
}

export interface EvalRecord {
  date: string;
  model: string;
  anthropic_version: string;
  corpus: { version: string; sha256: string; cases: number };
  repeats: number;
  estimate_usd: number;
  /** Usage the API reported, priced. */
  cost_usd: number;
  /** What the budget charged: cost_usd plus failed calls at their worst case, which may have been billed. */
  charged_usd: number;
  /** False when the run was interrupted: the cases not run are absent from `results`. */
  complete: boolean;
  price_usd_per_mtok: { input: number; output: number };
  latency_ms: { n: number; p50: number | null; p95: number | null };
  calls: Array<{
    case: string;
    repeat: number;
    latency_ms: number;
    input_tokens: number;
    output_tokens: number;
    /** The error's class when the call failed. */
    error?: string;
  }>;
  /** The categories reported per case and repeat; null when the call failed. */
  results: Array<{ repeat: number; case: string; predicted: string[] | null }>;
  metrics: Array<{ repeat: number; dev: Score; test: Score }>;
  note: string;
}

const FAILURE_RULES = new Set(["ai:request-failure", "ai:parse-failure"]);

/** Recomputes the metrics of a record from its raw results; tests compare them with `metrics`. */
export function rescore(
  record: Pick<EvalRecord, "results" | "repeats">,
  labels: Labels
): EvalRecord["metrics"] {
  const byId = new Map(labels.cases.map((c) => [c.id, c]));
  const out: EvalRecord["metrics"] = [];
  for (let repeat = 1; repeat <= record.repeats; repeat++) {
    const split = (s: "dev" | "test") =>
      record.results
        .filter((r) => r.repeat === repeat && byId.get(r.case)?.split === s)
        .map(
          (r): CaseResult => ({
            id: r.case,
            defects: byId.get(r.case)!.defects,
            predicted: r.predicted,
          })
        );
    out.push({
      repeat,
      dev: scoreCases(split("dev"), labels.categories),
      test: scoreCases(split("test"), labels.categories),
    });
  }
  return out;
}

export function estimate(corpus: Corpus, repeats: number = REPEATS): number {
  return estimateLinterCost([...corpus.contexts.values()], AI_LINTER_MODEL).estimatedUsd * repeats;
}

/**
 * Lints every case `repeats` times through `client`, timing and metering each
 * call, failed ones included. When `stop` is aborted no new call starts, the
 * calls in flight finish, and the record says it is incomplete.
 */
export async function evaluate(
  client: BudgetedClient,
  corpus: Corpus,
  now: Date,
  anthropicVersion: string,
  repeats: number = REPEATS,
  stop?: AbortSignal
): Promise<EvalRecord> {
  const price = pricePerMTok(AI_LINTER_MODEL);
  if (!price) throw new Error(`no price recorded for ${AI_LINTER_MODEL}`);
  const calls: EvalRecord["calls"] = [];
  const results: EvalRecord["results"] = [];
  const jobs = corpus.labels.cases.flatMap((c) =>
    Array.from({ length: repeats }, (_, i) => ({ id: c.id, repeat: i + 1 }))
  );
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !stop?.aborted) {
      const { id, repeat } = jobs[next++]!;
      const metered: PromptClient = {
        async complete(req) {
          const t0 = performance.now();
          const timed = { case: id, repeat };
          try {
            const res = await client.complete(req);
            calls.push({
              ...timed,
              latency_ms: Math.round(performance.now() - t0),
              input_tokens: res.usage?.input_tokens ?? 0,
              output_tokens: res.usage?.output_tokens ?? 0,
            });
            return res;
          } catch (error) {
            // Recorded, then rethrown: AiLinter turns it into an ai:request-failure issue.
            calls.push({
              ...timed,
              latency_ms: Math.round(performance.now() - t0),
              input_tokens: 0,
              output_tokens: 0,
              error: error instanceof Error ? error.name : typeof error,
            });
            throw error;
          }
        },
      };
      const issues = await new AiLinter({ client: metered, model: AI_LINTER_MODEL }).analyze([
        corpus.contexts.get(id)!,
      ]);
      const failed = issues.some((i) => FAILURE_RULES.has(i.rule));
      results.push({
        repeat,
        case: id,
        predicted: failed ? null : [...new Set(issues.map((i) => categoryOf(i.rule)))].sort(),
      });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const order = new Map(jobs.map((j, i) => [`${j.repeat}/${j.id}`, i]));
  const key = (x: { repeat: number; case: string }) => order.get(`${x.repeat}/${x.case}`)!;
  results.sort((a, b) => key(a) - key(b));
  calls.sort((a, b) => key(a) - key(b));
  // Latency objectives are about answers: a refused or failed call is counted as an error instead.
  const latencies = calls.filter((c) => !c.error).map((c) => c.latency_ms);
  const record = { results, repeats };
  return {
    date: now.toISOString(),
    model: AI_LINTER_MODEL,
    anthropic_version: anthropicVersion,
    corpus: {
      version: corpus.labels.version,
      sha256: corpus.sha256,
      cases: corpus.labels.cases.length,
    },
    repeats,
    estimate_usd: estimate(corpus, repeats),
    cost_usd:
      calls.reduce((s, c) => s + c.input_tokens * price[0] + c.output_tokens * price[1], 0) / 1e6,
    charged_usd: client.spentUsd,
    complete: results.length === jobs.length,
    price_usd_per_mtok: { input: price[0], output: price[1] },
    latency_ms: {
      n: latencies.length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
    calls,
    results,
    metrics: rescore(record, corpus.labels),
    note:
      "Labels are the defects each case was built with (evals/linter/README.md); a reported category that was not designed in counts as a false positive. " +
      "Latency is measured around each provider call, from this machine. cost_usd counts the usage the API reported.",
  };
}

if (import.meta.main) {
  const corpus = await loadCorpus();
  const usd = estimate(corpus);
  console.log(
    `${corpus.labels.cases.length} cases × ${REPEATS} repeats = ${corpus.labels.cases.length * REPEATS} call(s) to ${AI_LINTER_MODEL}, estimate $${usd.toFixed(4)} at full max_tokens, no retries (ceiling $${BUDGET_USD})`
  );
  if (usd > BUDGET_USD) {
    console.error("Estimate exceeds the ceiling; nothing was called.");
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
  const inner = new AnthropicClient({
    apiKey,
    maxRetries: 0,
    apiVersion: DEFAULT_ANTHROPIC_VERSION,
  });
  // Ctrl-C stops new calls; the calls in flight finish and the record is still written,
  // since money was spent. A second Ctrl-C exits at once.
  const stop = new AbortController();
  process.once("SIGINT", () => {
    console.error("Interrupted: finishing the calls in flight, then writing the record.");
    stop.abort();
  });
  const record = await evaluate(
    new BudgetedClient(inner, usd),
    corpus,
    now,
    DEFAULT_ANTHROPIC_VERSION,
    REPEATS,
    stop.signal
  );
  const name = `linter-eval-${now.toISOString().replace(/[:.]/g, "-")}.json`;
  const text = `${JSON.stringify(record, null, 2)}\n`;
  await Bun.write(resolve(ROOT, "runs/live", name), text);
  await appendFile(resolve(ROOT, "runs/live/SHA256SUMS"), `${sha256(text)}  ${name}\n`);
  const t = record.metrics.map(
    (m) =>
      `repeat ${m.repeat}: test precision ${m.test.overall.precision.value?.toFixed(3)} recall ${m.test.overall.recall.value?.toFixed(3)}`
  );
  console.log(`Spent $${record.cost_usd.toFixed(5)}. ${t.join("; ")}. Wrote runs/live/${name}`);
}
