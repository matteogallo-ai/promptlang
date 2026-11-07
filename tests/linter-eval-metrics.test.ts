import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { EvalRecord } from "../scripts/linter-eval";
import {
  againstReportEverything,
  type CaseResult,
  categoryOf,
  hypergeometricUpperTail,
  mcnemarExact,
  percentile,
  scoreCases,
  wilson,
} from "../scripts/linter-eval-metrics";

const CATS = ["VAGUE_INSTRUCTIONS", "MISSING_FORMAT_SPEC"];

describe("linter eval metrics", () => {
  test("Wilson 95% interval matches the published values and stays inside [0, 1]", () => {
    // Reference: 8/10 → [0.4902, 0.9433], 0/10 → [0, 0.2775] (Wilson 1927, z = 1.96).
    const a = wilson(8, 10)!;
    expect(a[0]).toBeCloseTo(0.4902, 4);
    expect(a[1]).toBeCloseTo(0.9433, 4);
    const b = wilson(0, 10)!;
    expect(b[0]).toBe(0);
    expect(b[1]).toBeCloseTo(0.2775, 4);
    expect(wilson(0, 0)).toBeNull();
  });

  test("an issue's rule maps back to its category; unknown rules stay as they are", () => {
    expect(categoryOf("ai:missing-format-spec")).toBe("MISSING_FORMAT_SPEC");
    expect(categoryOf("ai:made-up")).toBe("MADE_UP");
  });

  test("precision and recall per category and overall, each with k, n and its interval", () => {
    const cases: CaseResult[] = [
      { id: "a", defects: ["VAGUE_INSTRUCTIONS"], predicted: ["VAGUE_INSTRUCTIONS"] },
      { id: "b", defects: ["VAGUE_INSTRUCTIONS"], predicted: [] },
      {
        id: "c",
        defects: ["MISSING_FORMAT_SPEC"],
        predicted: ["MISSING_FORMAT_SPEC", "VAGUE_INSTRUCTIONS"],
      },
      { id: "d", defects: [], predicted: ["MADE_UP"] },
      { id: "e", defects: [], predicted: [] },
      { id: "f", defects: ["VAGUE_INSTRUCTIONS"], predicted: null },
    ];
    const s = scoreCases(cases, CATS);
    expect(s.cases).toBe(6);
    expect(s.failed).toEqual(["f"]);
    // TP: a, c; FP: c's vague, d's unknown category; FN: b.
    expect(s.overall.precision).toMatchObject({ k: 2, n: 4, value: 0.5 });
    expect(s.overall.recall).toMatchObject({ k: 2, n: 3 });
    expect(s.overall.recall.value).toBeCloseTo(2 / 3, 12);
    expect(s.overall.recall.ci95).toEqual(wilson(2, 3));
    expect(s.per_category.VAGUE_INSTRUCTIONS).toMatchObject({
      precision: { k: 1, n: 2 },
      recall: { k: 1, n: 2 },
    });
    expect(s.per_category.MISSING_FORMAT_SPEC).toMatchObject({
      precision: { k: 1, n: 1, value: 1 },
      recall: { k: 1, n: 1 },
    });
    // Clean cases d and e: one raised an issue.
    expect(s.clean_false_alarm).toMatchObject({ k: 1, n: 2, value: 0.5 });
  });

  test("a rate over no cases has no value and no interval", () => {
    const s = scoreCases([{ id: "a", defects: [], predicted: [] }], CATS);
    expect(s.overall.precision).toEqual({ k: 0, n: 0, value: null, ci95: null });
  });

  test("percentiles use the nearest-rank method", () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("linter against report-everything, on the same pairs", () => {
  test("exact tails on hand-checkable cases", () => {
    // 5 draws from 10 items of which 5 are positive: all 5 positive with probability 1/C(10,5).
    expect(hypergeometricUpperTail(10, 5, 5, 5)).toBeCloseTo(1 / 252, 12);
    expect(hypergeometricUpperTail(10, 5, 5, 0)).toBeCloseTo(1, 12);
    // McNemar exact, two-sided: 5 discordant pairs all one way → 2 / 2^5.
    expect(mcnemarExact(5, 0)).toBeCloseTo(0.0625, 12);
    expect(mcnemarExact(3, 3)).toBe(1);
  });

  test("pairs, specificity, discordant counts and both p-values", () => {
    const cases: CaseResult[] = [
      { id: "a", defects: ["VAGUE_INSTRUCTIONS"], predicted: ["VAGUE_INSTRUCTIONS"] },
      { id: "b", defects: [], predicted: [] },
      { id: "c", defects: ["MISSING_FORMAT_SPEC"], predicted: [] },
      { id: "d", defects: [], predicted: null },
    ];
    const r = againstReportEverything(cases, CATS);
    expect(r).toMatchObject({ pairs: 6, positives: 2, flagged: 1, tp: 1 });
    expect(r.specificity).toMatchObject({ k: 4, n: 4 });
    expect(r.mcnemar).toMatchObject({ linter_only_correct: 4, baseline_only_correct: 1 });
    expect(r.expected_tp_at_random).toBeCloseTo(1 / 3, 12);
  });

  // The figures docs/ai-linter.md publishes, recomputed from the committed live run.
  test("committed run, test split: 44/217 against 27.1 expected at random; McNemar 142 to 1", async () => {
    const record: EvalRecord = await Bun.file(
      join(import.meta.dir, "../runs/live/linter-eval-2026-11-03T08-39-28-817Z.json")
    ).json();
    const labels = await Bun.file(join(import.meta.dir, "../evals/linter/labels.json")).json();
    type Labelled = { id: string; split: string; defects: string[] };
    const byId = new Map<string, Labelled>(labels.cases.map((c: Labelled) => [c.id, c]));
    const run = (repeat: number) =>
      againstReportEverything(
        record.results
          .filter((r) => r.repeat === repeat && byId.get(r.case)?.split === "test")
          .map((r) => ({ id: r.case, defects: byId.get(r.case)!.defects, predicted: r.predicted })),
        labels.categories
      );
    const [first, second] = [run(1), run(2)];
    expect(first).toMatchObject({ pairs: 360, positives: 45, flagged: 217, tp: 44 });
    expect(first.expected_tp_at_random).toBeCloseTo(27.125, 3);
    expect(first.p_random).toBeLessThan(1e-9);
    expect(first.p_random).toBeGreaterThan(1e-10);
    expect(first.specificity).toMatchObject({ k: 142, n: 315 });
    expect(first.mcnemar).toMatchObject({ linter_only_correct: 142, baseline_only_correct: 1 });
    expect(first.mcnemar.p).toBeLessThan(1e-39);
    expect(second).toMatchObject({ pairs: 360, positives: 45, flagged: 229, tp: 45 });
    expect(second.specificity).toMatchObject({ k: 131, n: 315 });
  });
});
