import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildCorpus } from "../scripts/linter-eval-corpus";
import {
  buildReview,
  definitions,
  type KeyEntry,
  parseCsv,
  scoreReview,
  shownText,
  toCsv,
} from "../scripts/linter-eval-review";

const DIR = join(import.meta.dir, "../evals/linter/human-review");

describe("human review sample of the corpus labels", () => {
  const { rows, key } = buildReview();

  test("30 cases (6 clean, 4 per category), each with its designed claim and a decoy", () => {
    const { labels } = buildCorpus();
    const byId = new Map(labels.cases.map((c) => [c.id, c]));
    const cases = [...new Set(key.map((k) => k.case))];
    expect(cases).toHaveLength(30);
    expect(cases.filter((c) => byId.get(c)!.defects.length === 0)).toHaveLength(6);
    for (const cat of labels.categories)
      expect(cases.filter((c) => byId.get(c)!.defects[0] === cat)).toHaveLength(4);
    for (const c of cases) {
      const claims = key.filter((k) => k.case === c);
      expect(claims.map((k) => k.kind).sort()).toEqual(["decoy", "designed"]);
      const designed = claims.find((k) => k.kind === "designed")!;
      const decoy = claims.find((k) => k.kind === "decoy")!;
      expect(designed.category).toBe(byId.get(c)!.defects[0] ?? null);
      expect(decoy.category).not.toBe(designed.category);
      expect(decoy.category).not.toBeNull();
    }
  });

  test("nothing the annotator sees names the case or its label", () => {
    for (const r of rows) {
      expect(r.cited_passage).not.toContain("Designed defect");
      expect(r.cited_passage).not.toMatch(/b\d\d-/);
      expect(Object.keys(r)).toEqual([
        "item_id",
        "claim",
        "cited_passage",
        "extracts",
        "human_verdict",
        "comment",
      ]);
    }
    expect(shownText("// Linter eval case b01-clean. Designed defect: none.\n@version")).toBe(
      "@version"
    );
  });

  test("the claims quote the linter's own six definitions", () => {
    const defs = definitions();
    expect([...defs.keys()]).toEqual(buildCorpus().labels.categories);
    for (const r of rows) expect(r.extracts!.split("\n")).toHaveLength(6);
  });

  test("the committed sheet and key are exactly what build writes, while unannotated", async () => {
    const committed = parseCsv(await Bun.file(join(DIR, "review.csv")).text());
    const blank: Array<Record<string, string>> = committed.map((r) => ({
      ...r,
      human_verdict: "",
      comment: "",
    }));
    expect(blank).toEqual(rows);
    expect(await Bun.file(join(DIR, "key.json")).json()).toEqual(key);
  });

  test("CSV fields with commas, quotes and newlines survive a round trip", () => {
    const r = [
      {
        item_id: "r01",
        claim: 'a "b", c',
        cited_passage: "x\ny",
        extracts: "",
        human_verdict: "",
        comment: "",
      },
    ];
    expect(parseCsv(toCsv(r))).toEqual(r);
    expect(parseCsv(toCsv(r).replaceAll("\n", "\r\n"))[0]!.claim).toBe('a "b", c');
  });
});

describe("scoring the review", () => {
  const key: KeyEntry[] = [
    {
      item_id: "r01",
      case: "a",
      kind: "designed",
      category: "TOKEN_INEFFICIENCY",
      expected: "supported",
    },
    {
      item_id: "r02",
      case: "a",
      kind: "decoy",
      category: "VAGUE_INSTRUCTIONS",
      expected: "unsupported",
    },
    { item_id: "r03", case: "b", kind: "designed", category: null, expected: "supported" },
    {
      item_id: "r04",
      case: "b",
      kind: "decoy",
      category: "UNDEFINED_TERMS",
      expected: "unsupported",
    },
  ];
  const row = (item_id: string, human_verdict: string, comment = "") => ({
    item_id,
    human_verdict,
    comment,
  });

  test("full agreement: every rate at 1 and kappa 1", () => {
    const s = scoreReview(
      [
        row("r01", "supported"),
        row("r02", "unsupported"),
        row("r03", "supported"),
        row("r04", "unsupported"),
      ],
      key
    );
    expect(s.designed_confirmed).toMatchObject({ k: 2, n: 2, value: 1 });
    expect(s.decoys_rejected).toMatchObject({ k: 2, n: 2, value: 1 });
    expect(s.kappa).toBe(1);
    expect(s.disagreements).toEqual([]);
  });

  test("a rejected label and an undesigned defect are listed with the comment; unanswered rows are left out", () => {
    const s = scoreReview(
      [
        row("r01", "unsupported", "only one sentence"),
        row("r02", "unsupported"),
        row("r03", ""),
        row("r04", "supported", "tier-2"),
      ],
      key
    );
    expect(s.annotated).toBe(3);
    expect(s.designed_confirmed).toMatchObject({ k: 0, n: 1 });
    expect(s.decoys_rejected).toMatchObject({ k: 1, n: 2 });
    expect(s.disagreements.map((d) => [d.item_id, d.comment])).toEqual([
      ["r01", "only one sentence"],
      ["r04", "tier-2"],
    ]);
  });

  test("an answer for an item missing from the key is an error", () => {
    expect(() => scoreReview([row("r99", "supported")], key)).toThrow("not in the key");
  });
});
