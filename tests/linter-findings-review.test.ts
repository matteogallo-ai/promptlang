import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseCsv, toCsv } from "../scripts/linter-eval-review";
import {
  allocate,
  buildFindingsReview,
  type KeyEntry,
  loadInputs,
  population,
  SAMPLE,
  SEED,
  scoreFindings,
} from "../scripts/linter-findings-review";

const DIR = join(import.meta.dir, "../evals/linter/findings-review");
const inputs = await loadInputs();
const sizes = new Map(inputs.labels.categories.map((c) => [c, 0]));
for (const f of population(inputs.record, inputs.labels))
  sizes.set(f.category, sizes.get(f.category)! + 1);
// The published lower bound the reading compares with: 44 of 217 scored right.
const LOWER = 44 / 217;

describe("human review of the linter's findings", () => {
  test("the population is the published test-split precision: 44 of 217 findings scored right", () => {
    const pop = population(inputs.record, inputs.labels);
    expect(pop).toHaveLength(217);
    expect(pop.filter((f) => f.scored_correct)).toHaveLength(44);
    expect(inputs.record.metrics[0]!.test.overall.precision).toMatchObject({ k: 44, n: 217 });
  });

  test("40 findings, allocated in proportion to each category's share, rounded by largest remainder", () => {
    expect(Object.fromEntries(allocate(sizes, SAMPLE))).toEqual({
      VAGUE_INSTRUCTIONS: 9,
      MISSING_FORMAT_SPEC: 4,
      CONFLICTING_INSTRUCTIONS: 7,
      UNDEFINED_TERMS: 8,
      POTENTIAL_HALLUCINATION_RISK: 9,
      TOKEN_INEFFICIENCY: 3,
    });
    const { key } = buildFindingsReview(inputs);
    expect(key).toHaveLength(SAMPLE);
    for (const [cat, n] of allocate(sizes, SAMPLE))
      expect(key.filter((k) => k.category === cat)).toHaveLength(n);
    expect(new Set(key.map((k) => `${k.case} ${k.category}`)).size).toBe(SAMPLE);
    // PROTOCOL.md tells the annotator a prompt can come back: 40 findings on 31 prompts.
    expect(new Set(key.map((k) => k.case)).size).toBe(31);
  });

  test("allocation ties are broken by name and a sample larger than the population is refused", () => {
    expect(
      Object.fromEntries(
        allocate(
          new Map([
            ["B", 1],
            ["A", 1],
          ]),
          1
        )
      )
    ).toEqual({ B: 0, A: 1 });
    expect(() => allocate(new Map([["A", 2]]), 3)).toThrow("cannot draw 3 of 2");
  });

  // The pre-registration is the commit that first added the sample; git history is
  // what proves it came before the answers. These tests make a redraw visible: a
  // new seed or rule changes the pinned digests, so it cannot pass unnoticed in a diff.
  test("the sample is the one pre-registered: seed 20261104 and its SHA-256 digests", async () => {
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    const { rows, key } = buildFindingsReview(inputs);
    expect(SEED).toBe(20261104);
    expect(sha(`${JSON.stringify(key, null, 2)}\n`)).toBe(
      "54a7a53a5d5253edaa8ebe2dd6285e87f2f97ab553b3931c834aee941d0db5a3"
    );
    expect(sha(toCsv(rows))).toBe(
      "34769ec4cba5b61da3c97fe756aa49c9a00f559257850920632b2e913e023e11"
    );
  });

  test("the committed sheet and key are exactly what build writes, while unannotated", async () => {
    const { rows, key } = buildFindingsReview(inputs);
    const committed = parseCsv(await Bun.file(join(DIR, "review.csv")).text());
    const blank: Array<Record<string, string>> = committed.map((r) => ({
      ...r,
      human_verdict: "",
      comment: "",
    }));
    expect(blank).toEqual(rows);
    expect(await Bun.file(join(DIR, "key.json")).json()).toEqual(key);
  });

  test("the annotator sees no case id, no designed defect and no scoring, in annotate.py's columns", () => {
    const { rows, key } = buildFindingsReview(inputs);
    const ids = inputs.labels.cases.map((c) => c.id);
    for (const r of rows) {
      expect(Object.keys(r)).toEqual([
        "item_id",
        "claim",
        "cited_passage",
        "extracts",
        "human_verdict",
        "comment",
      ]);
      const shown = `${r.item_id} ${r.claim} ${r.cited_passage} ${r.extracts}`;
      expect(shown).not.toContain("Designed defect");
      expect(shown).not.toMatch(/b\d\d-/);
      for (const id of ids) expect(shown).not.toContain(id);
      expect(shown).not.toMatch(/scored|expected|correct/i);
    }
    // Items are shuffled across categories, so the order gives nothing away.
    expect(new Set(key.slice(0, 9).map((k) => k.category)).size).toBeGreaterThan(1);
  });

  // README.md, docs/SYSTEM_CARD.md and docs/CLAIMS.md publish this result; score.json
  // is what `score` printed on the committed answers, and stays so.
  test("the committed answers score 12/40 (30%, 95% CI 18.1–45.4%), not above the 44/217 bound", async () => {
    const answered = parseCsv(await Bun.file(join(DIR, "review.csv")).text());
    const committedKey = (await Bun.file(join(DIR, "key.json")).json()) as KeyEntry[];
    const s = scoreFindings(answered, committedKey, sizes, LOWER);
    expect(await Bun.file(join(DIR, "score.json")).json()).toEqual(JSON.parse(JSON.stringify(s)));
    expect(s).toMatchObject({ complete: true, above_scored_lower_bound: false });
    expect(s.precision).toMatchObject({ k: 12, n: 40 });
    const [low, high] = s.precision.ci95 ?? [Number.NaN, Number.NaN];
    expect(low).toBeCloseTo(0.181, 3);
    expect(high).toBeCloseTo(0.454, 3);
    expect(s.scored_wrong_but_supported).toMatchObject({ k: 4, n: 32 });
    expect(s.scored_right_but_unsupported).toMatchObject({ k: 0, n: 8 });
  });

  const { key } = buildFindingsReview(inputs);
  const answer = (verdict: (k: KeyEntry) => string) =>
    key.map((k) => ({ item_id: k.item_id, human_verdict: verdict(k), comment: "" }));

  test("an annotator who agrees with the construction scores the construction's precision", () => {
    const s = scoreFindings(
      answer((k) => (k.scored_correct ? "supported" : "unsupported")),
      key,
      sizes,
      LOWER
    );
    expect(s.annotated).toBe(40);
    expect(s.precision).toMatchObject({ k: 8, n: 40 });
    expect(s.scored_precision).toMatchObject({ k: 8, n: 40 });
    expect(s.scored_wrong_but_supported).toMatchObject({ k: 0, n: 32 });
    expect(s.scored_right_but_unsupported).toMatchObject({ k: 0, n: 8 });
  });

  test("findings scored wrong but supported raise the precision; the weighted estimate follows the strata", () => {
    const s = scoreFindings(
      answer(() => "supported"),
      key,
      sizes,
      LOWER
    );
    expect(s.precision).toMatchObject({ k: 40, n: 40, value: 1 });
    expect(s.precision_weighted).toBeCloseTo(1, 10);
    expect(s.scored_wrong_but_supported).toMatchObject({ k: 32, n: 32 });
    const onlyToken = scoreFindings(
      answer((k) => (k.category === "TOKEN_INEFFICIENCY" ? "supported" : "unsupported")),
      key,
      sizes,
      LOWER
    );
    expect(onlyToken.precision).toMatchObject({ k: 3, n: 40 });
    expect(onlyToken.precision_weighted).toBeCloseTo(16 / 217, 10);
  });

  test("a duplicated or missing row is an error, not a silent change of n", () => {
    const all = answer(() => "supported");
    expect(() => scoreFindings([...all, all[0]!], key, sizes, LOWER)).toThrow(
      "item f01 appears twice"
    );
    expect(() => scoreFindings(all.slice(1), key, sizes, LOWER)).toThrow(
      "item f01 is missing from the sheet"
    );
  });

  test("a category with no finding in the population does not block the weighted estimate", () => {
    const withEmpty = new Map([...sizes, ["NOT_REPORTED", 0]]);
    const s = scoreFindings(
      answer(() => "supported"),
      key,
      withEmpty,
      LOWER
    );
    expect(s.precision_weighted).toBeCloseTo(1, 10);
  });

  // The reading is fixed before any answer: above the lower bound only when the
  // whole interval is, and no reading at all on a partial sheet.
  test("the pre-registered reading: complete sheet, interval above the scored 44/217", () => {
    const agree = scoreFindings(
      answer((k) => (k.scored_correct ? "supported" : "unsupported")),
      key,
      sizes,
      LOWER
    );
    expect(agree).toMatchObject({ complete: true, above_scored_lower_bound: false });
    const all = scoreFindings(
      answer(() => "supported"),
      key,
      sizes,
      LOWER
    );
    expect(all.above_scored_lower_bound).toBe(true);
    const partial = scoreFindings(
      answer((k) => (k.item_id === "f01" ? "supported" : "")),
      key,
      sizes,
      LOWER
    );
    expect(partial).toMatchObject({ complete: false, above_scored_lower_bound: null });
  });

  test("unanswered items are left out and counted; a wrong verdict or item is an error", () => {
    const partial = answer((k) => (k.item_id === "f01" ? "supported" : ""));
    const s = scoreFindings(partial, key, sizes, LOWER);
    expect(s).toMatchObject({ annotated: 1, total: 40 });
    expect(s.precision_weighted).toBeNull();
    expect(() =>
      scoreFindings([{ item_id: "f99", human_verdict: "supported" }], key, sizes, LOWER)
    ).toThrow("not in the key");
    expect(() =>
      scoreFindings([{ item_id: "f01", human_verdict: "yes" }], key, sizes, LOWER)
    ).toThrow("neither supported nor unsupported");
  });
});
