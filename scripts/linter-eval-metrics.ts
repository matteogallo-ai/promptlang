/**
 * Scoring of the AI linter against the labelled corpus in evals/linter/. Pure
 * functions: the live run (scripts/linter-eval.ts) records what the model
 * returned, and these recompute every number from that record, so the
 * committed metrics can be re-derived and checked by tests.
 */

const Z95 = 1.959964;

/** Wilson score interval for k successes in n trials; null when n is 0. */
export function wilson(k: number, n: number, z: number = Z95): [number, number] | null {
  if (n === 0) return null;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** A proportion with its numerator, denominator and 95% interval. */
export interface Rate {
  k: number;
  n: number;
  value: number | null;
  ci95: [number, number] | null;
}

function rate(k: number, n: number): Rate {
  return { k, n, value: n === 0 ? null : k / n, ci95: wilson(k, n) };
}

/** "ai:missing-format-spec" → "MISSING_FORMAT_SPEC", the label vocabulary. */
export function categoryOf(rule: string): string {
  return rule.replace(/^ai:/, "").replace(/-/g, "_").toUpperCase();
}

/**
 * One case of one run. `predicted`: the categories the linter reported, or
 * null when the call failed (request or parse failure), which leaves the case
 * without a verdict instead of counting as "no issue found".
 */
export interface CaseResult {
  id: string;
  defects: string[];
  predicted: string[] | null;
}

export interface Score {
  cases: number;
  failed: string[];
  /**
   * Over (case, category) pairs. A reported category not among the labelled
   * ones counts as a false positive: the corpus has no such defect.
   */
  overall: { precision: Rate; recall: Rate };
  per_category: Record<string, { precision: Rate; recall: Rate }>;
  /** Clean cases (no designed defect) on which the linter reported anything. */
  clean_false_alarm: Rate;
}

export function scoreCases(cases: CaseResult[], categories: string[]): Score {
  const per = new Map(categories.map((c) => [c, { tp: 0, fp: 0, fn: 0 }]));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let clean = 0;
  let cleanAlarms = 0;
  const failed: string[] = [];
  for (const c of cases) {
    if (c.predicted === null) {
      failed.push(c.id);
      continue;
    }
    const predicted = new Set(c.predicted);
    const truth = new Set(c.defects);
    if (truth.size === 0) {
      clean++;
      if (predicted.size > 0) cleanAlarms++;
    }
    for (const p of predicted) {
      const hit = truth.has(p);
      if (hit) tp++;
      else fp++;
      const counts = per.get(p);
      if (counts) {
        if (hit) counts.tp++;
        else counts.fp++;
      }
    }
    for (const t of truth)
      if (!predicted.has(t)) {
        fn++;
        const counts = per.get(t);
        if (counts) counts.fn++;
      }
  }
  return {
    cases: cases.length,
    failed,
    overall: { precision: rate(tp, tp + fp), recall: rate(tp, tp + fn) },
    per_category: Object.fromEntries(
      [...per].map(([cat, x]) => [
        cat,
        { precision: rate(x.tp, x.tp + x.fp), recall: rate(x.tp, x.tp + x.fn) },
      ])
    ),
    clean_false_alarm: rate(cleanAlarms, clean),
  };
}

/** Nearest-rank percentile; null for no values. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/** P(X ≥ k) for X hypergeometric: `draws` items taken from `population`, of which `successes` are positive. */
export function hypergeometricUpperTail(
  population: number,
  successes: number,
  draws: number,
  k: number
): number {
  const total = logChoose(population, draws);
  let p = 0;
  for (let i = Math.max(k, 0); i <= Math.min(successes, draws); i++)
    p += Math.exp(logChoose(successes, i) + logChoose(population - successes, draws - i) - total);
  return Math.min(1, p);
}

/** Exact two-sided McNemar test: the smaller discordant count against Binomial(b + c, 1/2). */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  let tail = 0;
  for (let i = 0; i <= Math.min(b, c); i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

/**
 * The linter against "report every category", decided on the same (case, category)
 * pairs, so the comparison is paired rather than two intervals set side by side.
 * `p_random`: the chance that `flagged` pairs drawn at random hold at least `tp`
 * defects. McNemar counts the pairs only one of the two decides correctly: an
 * unflagged clean pair for the linter, a missed defect for the baseline. Pairs of
 * one case are not independent, so both p-values overstate the evidence; their
 * order of magnitude is what they show. Failed cases are left out, as in scoreCases.
 */
export function againstReportEverything(cases: CaseResult[], categories: string[]) {
  let positives = 0;
  let tp = 0;
  let flagged = 0;
  let pairs = 0;
  for (const c of cases) {
    if (c.predicted === null) continue;
    const truth = new Set(c.defects);
    const predicted = new Set(c.predicted.filter((p) => categories.includes(p)));
    pairs += categories.length;
    positives += truth.size;
    flagged += predicted.size;
    for (const p of predicted) if (truth.has(p)) tp++;
  }
  const negatives = pairs - positives;
  const trueNegatives = negatives - (flagged - tp);
  const missed = positives - tp;
  return {
    pairs,
    positives,
    flagged,
    tp,
    expected_tp_at_random: (flagged * positives) / pairs,
    p_random: hypergeometricUpperTail(pairs, positives, flagged, tp),
    specificity: rate(trueNegatives, negatives),
    mcnemar: {
      linter_only_correct: trueNegatives,
      baseline_only_correct: missed,
      p: mcnemarExact(trueNegatives, missed),
    },
  };
}
