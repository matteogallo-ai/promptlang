#!/usr/bin/env bun
/**
 * Human check of the AI linter's findings: a precision a person measured, where
 * the scored precision counts every category nobody designed into a case as a
 * false positive and so is only a lower bound.
 *
 *   bun run scripts/linter-findings-review.ts build    # writes evals/linter/findings-review/
 *   bun run scripts/linter-findings-review.ts score    # precision once review.csv is annotated
 *
 * The population is every category the linter reported on the test split in
 * repeat 1 of RECORD, the run behind the published 44/217. `build` draws SAMPLE
 * of them, stratified by reported category with proportional allocation
 * (largest remainder), seeded, and writes one claim per finding ("this prompt
 * has defect X") in shuffled order to review.csv, with the columns of verity's
 * scripts/annotate.py. The annotator sees the claim, the prompt without its
 * label comment and the six definitions: no case id, no designed defect, no
 * sign of how the finding was scored. Which case and category each item is, and
 * how the construction scored it, goes to key.json.
 *
 * Everything `score` computes is fixed here before any answer exists; PROTOCOL.md
 * in the same folder states it in words.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { EvalRecord, Labels } from "./linter-eval";
import { type Rate, wilson } from "./linter-eval-metrics";
import { definitions, parseCsv, rng, shownText, shuffle, toCsv } from "./linter-eval-review";

const ROOT = resolve(import.meta.dir, "..");
const DIR = resolve(ROOT, "evals/linter/findings-review");
export const RECORD = "runs/live/linter-eval-2026-11-03T08-39-28-817Z.json";
export const REPEAT = 1;
export const SAMPLE = 40;
export const SEED = 20261104;

export interface Finding {
  case: string;
  category: string;
  /** Whether the construction scored it right: the category was designed into the case. */
  scored_correct: boolean;
}

export interface KeyEntry extends Finding {
  item_id: string;
}

/** Every category the linter reported on the test split in REPEAT, in record order. */
export function population(record: Pick<EvalRecord, "results">, labels: Labels): Finding[] {
  const byId = new Map(labels.cases.map((c) => [c.id, c]));
  return record.results.flatMap((r) => {
    const c = byId.get(r.case);
    if (r.repeat !== REPEAT || c?.split !== "test" || !r.predicted) return [];
    return r.predicted.map((category) => ({
      case: r.case,
      category,
      scored_correct: c.defects.includes(category),
    }));
  });
}

/** Proportional allocation of `total` over the strata, rounded by largest remainder. */
export function allocate(sizes: Map<string, number>, total: number): Map<string, number> {
  const all = [...sizes.values()].reduce((a, b) => a + b, 0);
  if (total > all) throw new Error(`cannot draw ${total} of ${all} findings`);
  const quota = [...sizes].map(([k, n]) => ({ k, exact: (total * n) / all }));
  const out = new Map(quota.map((q) => [q.k, Math.floor(q.exact)]));
  let left = total - [...out.values()].reduce((a, b) => a + b, 0);
  // Ties broken by category name, so the allocation never depends on input order.
  const byRemainder = [...quota].sort(
    (a, b) =>
      b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.k.localeCompare(b.k)
  );
  for (const q of byRemainder) {
    if (left === 0) break;
    out.set(q.k, out.get(q.k)! + 1);
    left--;
  }
  return out;
}

export async function loadInputs(): Promise<{
  record: EvalRecord;
  labels: Labels;
  files: Map<string, string>;
}> {
  const record = (await Bun.file(resolve(ROOT, RECORD)).json()) as EvalRecord;
  const labels = (await Bun.file(resolve(ROOT, "evals/linter/labels.json")).json()) as Labels;
  const files = new Map<string, string>();
  for (const c of labels.cases)
    files.set(c.id, await Bun.file(resolve(ROOT, "evals/linter", c.file)).text());
  return { record, labels, files };
}

export function buildFindingsReview(
  inputs: { record: Pick<EvalRecord, "results">; labels: Labels; files: Map<string, string> },
  seed: number = SEED
): { rows: Array<Record<string, string>>; key: KeyEntry[] } {
  const defs = definitions();
  const rand = rng(seed);
  const pop = population(inputs.record, inputs.labels);
  const sizes = new Map(inputs.labels.categories.map((cat) => [cat, 0]));
  for (const f of pop) sizes.set(f.category, sizes.get(f.category)! + 1);
  const quota = allocate(sizes, SAMPLE);
  const drawn = inputs.labels.categories.flatMap((cat) =>
    shuffle(
      pop.filter((f) => f.category === cat),
      rand
    ).slice(0, quota.get(cat))
  );
  const rows: Array<Record<string, string>> = [];
  const key: KeyEntry[] = [];
  shuffle(drawn, rand).forEach((f, i) => {
    const item_id = `f${String(i + 1).padStart(2, "0")}`;
    rows.push({
      item_id,
      claim: `This prompt has the defect ${f.category}: ${defs.get(f.category)}.`,
      cited_passage: shownText(inputs.files.get(f.case)!),
      extracts: [...defs].map(([k, v]) => `${k}: ${v}`).join("\n"),
      human_verdict: "",
      comment: "",
    });
    key.push({ item_id, ...f });
  });
  return { rows, key };
}

const rate = (k: number, n: number): Rate => ({
  k,
  n,
  value: n === 0 ? null : k / n,
  ci95: wilson(k, n),
});

export interface FindingsScore {
  annotated: number;
  total: number;
  /** Findings the annotator marked supported, with a Wilson 95% interval: the headline. */
  precision: Rate;
  /** Each stratum weighted by its share of the population; equals `precision` up to rounding of the allocation. */
  precision_weighted: number | null;
  per_category: Record<string, Rate>;
  /** The construction's verdict on the same items, for comparison with the published lower bound. */
  scored_precision: Rate;
  /** Findings scored wrong by construction that the annotator marked supported. */
  scored_wrong_but_supported: Rate;
  /** Findings scored right by construction that the annotator marked unsupported. */
  scored_right_but_unsupported: Rate;
  /** Every item answered: the only case in which `precision` is read as a measure. */
  complete: boolean;
  /**
   * The pre-registered reading: true when the whole interval lies above the
   * population's scored precision (the published lower bound), false when it
   * does not, null on a partial sheet.
   */
  above_scored_lower_bound: boolean | null;
}

export function scoreFindings(
  rows: Array<Record<string, string>>,
  key: KeyEntry[],
  populationSizes: Map<string, number>,
  scoredLowerBound: number
): FindingsScore {
  const byId = new Map(key.map((k) => [k.item_id, k]));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!byId.has(r.item_id!)) throw new Error(`item ${r.item_id} is not in the key`);
    // A repeated or deleted row would change n without anyone deciding it.
    if (seen.has(r.item_id!)) throw new Error(`item ${r.item_id} appears twice in the sheet`);
    seen.add(r.item_id!);
    if (r.human_verdict && r.human_verdict !== "supported" && r.human_verdict !== "unsupported")
      throw new Error(
        `item ${r.item_id}: verdict "${r.human_verdict}" is neither supported nor unsupported`
      );
  }
  for (const k of key)
    if (!seen.has(k.item_id)) throw new Error(`item ${k.item_id} is missing from the sheet`);
  const answered = rows.filter((r) => r.human_verdict);
  const pairs = answered.map((r) => ({
    k: byId.get(r.item_id!)!,
    yes: r.human_verdict === "supported",
  }));
  const count = (xs: typeof pairs) => rate(xs.filter((p) => p.yes).length, xs.length);
  const per_category: Record<string, Rate> = {};
  for (const cat of populationSizes.keys())
    per_category[cat] = count(pairs.filter((p) => p.k.category === cat));
  const all = [...populationSizes.values()].reduce((a, b) => a + b, 0);
  let weighted: number | null = 0;
  for (const [cat, n] of populationSizes) {
    if (n === 0) continue;
    const v = per_category[cat]!.value;
    if (v === null) {
      weighted = null;
      break;
    }
    weighted += (n / all) * v;
  }
  const wrong = pairs.filter((p) => !p.k.scored_correct);
  const right = pairs.filter((p) => p.k.scored_correct);
  const precision = count(pairs);
  const complete = pairs.length === key.length;
  return {
    annotated: pairs.length,
    total: key.length,
    precision,
    precision_weighted: pairs.length === 0 ? null : weighted,
    per_category,
    scored_precision: rate(right.length, pairs.length),
    scored_wrong_but_supported: count(wrong),
    scored_right_but_unsupported: rate(right.filter((p) => !p.yes).length, right.length),
    complete,
    above_scored_lower_bound: complete ? precision.ci95![0] > scoredLowerBound : null,
  };
}

if (import.meta.main) {
  const command = process.argv[2];
  const inputs = await loadInputs();
  if (command === "build") {
    const { rows, key } = buildFindingsReview(inputs);
    await mkdir(DIR, { recursive: true });
    await Bun.write(resolve(DIR, "review.csv"), toCsv(rows));
    await Bun.write(resolve(DIR, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
    console.error(
      `wrote ${rows.length} findings to evals/linter/findings-review/review.csv and the key`
    );
  } else if (command === "score") {
    const rows = parseCsv(await Bun.file(resolve(DIR, "review.csv")).text());
    const key = (await Bun.file(resolve(DIR, "key.json")).json()) as KeyEntry[];
    const sizes = new Map(inputs.labels.categories.map((cat) => [cat, 0]));
    const pop = population(inputs.record, inputs.labels);
    for (const f of pop) sizes.set(f.category, sizes.get(f.category)! + 1);
    const lowerBound = pop.filter((f) => f.scored_correct).length / pop.length;
    console.log(JSON.stringify(scoreFindings(rows, key, sizes, lowerBound), null, 2));
  } else {
    console.error("usage: linter-findings-review.ts build | score");
    process.exit(2);
  }
}
