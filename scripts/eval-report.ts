#!/usr/bin/env bun
/**
 * Renders the measured parts of docs/SLO.md and docs/SYSTEM_CARD.md from the
 * latest committed linter eval record (runs/live/linter-eval-*.json), so no
 * number in those docs is typed by hand.
 *
 *   bun run scripts/eval-report.ts           # print both blocks
 *   bun run scripts/eval-report.ts --write   # rewrite them between their markers
 *
 * tests/eval-report.test.ts fails when a doc and the record disagree.
 */
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { EvalRecord } from "./linter-eval";
import { type Rate, wilson } from "./linter-eval-metrics";

const ROOT = resolve(import.meta.dir, "..");
const LIVE = resolve(ROOT, "runs/live");

/** The objectives for one AI linter call; docs/SLO.md explains each. */
export const SLO = { p95LatencyMs: 20_000, errorRate: 0.02, meanCostUsd: 0.001 } as const;

export async function latestRecord(
  dir: string = LIVE
): Promise<{ name: string; record: EvalRecord } | null> {
  const names = (await readdir(dir).catch(() => [] as string[]))
    .filter((f) => /^linter-eval-.*\.json$/.test(f))
    .sort();
  const name = names.at(-1);
  if (!name) return null;
  return { name, record: (await Bun.file(resolve(dir, name)).json()) as EvalRecord };
}

/** Names the record; an interrupted run is shown as such, never as a full measurement. */
function source(name: string, record: EvalRecord): string {
  const partial = record.complete === false ? " **Interrupted run: partial results.**" : "";
  return `From \`runs/live/${name}\`${partial}`;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const ci = (r: Rate) => (r.ci95 ? `[${pct(r.ci95[0])}, ${pct(r.ci95[1])}]` : "n/a");
const cell = (r: Rate) => `${pct(r.value)} (${r.k}/${r.n}, 95% CI ${ci(r)})`;

/** Calls without a verdict (request or parse failure) over all calls, with its interval. */
export function errorRate(record: EvalRecord): Rate {
  const k = record.results.filter((r) => r.predicted === null).length;
  const n = record.results.length;
  return { k, n, value: n === 0 ? null : k / n, ci95: wilson(k, n) };
}

export function renderSlo(latest: { name: string; record: EvalRecord } | null): string {
  if (!latest) return "Not measured: no linter eval record is committed under `runs/live/`.";
  const { name, record } = latest;
  const err = errorRate(record);
  const meanCost = record.calls.length === 0 ? null : record.cost_usd / record.calls.length;
  const met = (ok: boolean | null) => (ok === null ? "n/a" : ok ? "met" : "**not met**");
  const p95 = record.latency_ms.p95;
  return [
    `${source(name, record)} (${record.model}, ${record.date.slice(0, 10)}, ${record.results.length} calls).`,
    "",
    "| Objective | Target | Measured | |",
    "| --------- | ------ | -------- | - |",
    `| p95 latency per call | ≤ ${SLO.p95LatencyMs / 1000} s | ${p95 === null ? "n/a" : `${(p95 / 1000).toFixed(1)} s`} (p50 ${record.latency_ms.p50 === null ? "n/a" : `${(record.latency_ms.p50 / 1000).toFixed(1)} s`}, n=${record.latency_ms.n}) | ${met(p95 === null ? null : p95 <= SLO.p95LatencyMs)} |`,
    `| Calls without a verdict | ≤ ${pct(SLO.errorRate)} | ${cell(err)} | ${met(err.value === null ? null : err.value <= SLO.errorRate)} |`,
    `| Mean cost per call | ≤ $${SLO.meanCostUsd} | ${meanCost === null ? "n/a" : `$${meanCost.toFixed(5)}`} | ${met(meanCost === null ? null : meanCost <= SLO.meanCostUsd)} |`,
  ].join("\n");
}

export function renderPerformance(latest: { name: string; record: EvalRecord } | null): string {
  if (!latest)
    return "Not measured: no linter eval record is committed under `runs/live/`. The corpus and the scoring are tested; their numbers on a fake client are not a quality measure.";
  const { name, record } = latest;
  const first = record.metrics[0];
  if (!first) return `${source(name, record)}: no repeat was scored.`;
  const lines = [
    `${source(name, record)}: ${record.model}, corpus ${record.corpus.version} (${record.corpus.cases} cases), ${record.repeats} repeat${record.repeats === 1 ? "" : "s"}. Scores on the test split; the dev split is in the record.`,
    "",
    "| Repeat | Precision | Recall | Clean cases with a false alarm | No verdict |",
    "| ------ | --------- | ------ | ------------------------------ | ---------- |",
  ];
  for (const m of record.metrics)
    lines.push(
      `| ${m.repeat} | ${cell(m.test.overall.precision)} | ${cell(m.test.overall.recall)} | ${cell(m.test.clean_false_alarm)} | ${m.test.failed.length} |`
    );
  lines.push(
    "",
    "| Category (repeat 1) | Precision | Recall |",
    "| ------------------- | --------- | ------ |"
  );
  for (const [cat, s] of Object.entries(first.test.per_category))
    lines.push(`| ${cat} | ${cell(s.precision)} | ${cell(s.recall)} |`);
  return lines.join("\n");
}

const BLOCKS = [
  { doc: "docs/SLO.md", render: renderSlo },
  { doc: "docs/SYSTEM_CARD.md", render: renderPerformance },
] as const;

/** Replaces the text between `<!-- measured:start -->` and `<!-- measured:end -->`. */
export function withBlock(text: string, block: string): string {
  const re = /(<!-- measured:start -->\n)[\s\S]*?(\n<!-- measured:end -->)/;
  if (!re.test(text)) throw new Error("no <!-- measured:start --> … <!-- measured:end --> markers");
  return text.replace(re, (_, a: string, b: string) => `${a}${block}${b}`);
}

/** The docs whose measured block differs from what the latest record renders. */
export async function staleDocs(): Promise<string[]> {
  const latest = await latestRecord();
  const stale: string[] = [];
  for (const { doc, render } of BLOCKS) {
    const text = await Bun.file(resolve(ROOT, doc)).text();
    if (withBlock(text, render(latest)) !== text) stale.push(doc);
  }
  return stale;
}

if (import.meta.main) {
  const latest = await latestRecord();
  for (const { doc, render } of BLOCKS) {
    const block = render(latest);
    if (process.argv.includes("--write")) {
      const path = resolve(ROOT, doc);
      await Bun.write(path, withBlock(await Bun.file(path).text(), block));
      console.error(`wrote ${doc}`);
    } else console.log(`${doc}\n${block}\n`);
  }
}
