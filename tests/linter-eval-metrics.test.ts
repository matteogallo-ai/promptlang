import { describe, expect, test } from "bun:test";
import {
  type CaseResult,
  categoryOf,
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
