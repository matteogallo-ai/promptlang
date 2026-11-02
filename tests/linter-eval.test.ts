import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PromptClient } from "../src/runtime/client";
import { BudgetedClient } from "../src/testing/budget";
import { checksumMismatches } from "../scripts/checksums";
import {
  type EvalRecord,
  estimate,
  evaluate,
  type Labels,
  loadCorpus,
  rescore,
} from "../scripts/linter-eval";

const ROOT = join(import.meta.dir, "..");

describe("linter eval corpus (evals/linter)", () => {
  test("the corpus matches its SHA256SUMS: a labelled case cannot change unnoticed", async () => {
    expect(await checksumMismatches(join(ROOT, "evals/linter"))).toEqual([]);
  });

  test("120 cases, split by base task, one designed defect at most, 45 defects and 15 clean per split", async () => {
    const { labels, contexts } = await loadCorpus();
    expect(labels.cases).toHaveLength(120);
    const splitOfBase = new Map<string, string>();
    for (const c of labels.cases) {
      expect(splitOfBase.get(c.base) ?? c.split).toBe(c.split);
      splitOfBase.set(c.base, c.split);
      expect(c.defects.length).toBeLessThanOrEqual(1);
      for (const d of c.defects) expect(labels.categories).toContain(d);
      const prompts = contexts
        .get(c.id)!
        .ast.declarations.filter((d) => d.kind === "PromptDeclaration");
      expect(prompts).toHaveLength(1);
    }
    for (const split of ["dev", "test"]) {
      const cases = labels.cases.filter((c) => c.split === split);
      expect(cases.filter((c) => c.defects.length === 1)).toHaveLength(45);
      expect(cases.filter((c) => c.defects.length === 0)).toHaveLength(15);
    }
  });
});

describe("linter eval run", () => {
  test("records every call's latency and usage, scores each repeat, and stays within the cap", async () => {
    const corpus = await loadCorpus();
    // Each case is found by its whole system section, as the linter's user message delimits it.
    const caseOf = (message: string) =>
      corpus.labels.cases.find((c) => {
        const decl = corpus.contexts.get(c.id)!.ast.declarations[0] as {
          sections: Array<{ kind: string; role?: string; content: { value: string } }>;
        };
        const system = decl.sections.find((x) => x.role === "system")!.content.value;
        return message.includes(
          `<untrusted_prompt section="system">\n${system}\n</untrusted_prompt>`
        );
      })!;
    // A fake linter answer that reports the designed defect, except MISSING_FORMAT_SPEC.
    let calls = 0;
    const fake: PromptClient = {
      async complete(req) {
        calls++;
        const issues = caseOf(req.messages[1]!.content)
          .defects.filter((d) => d !== "MISSING_FORMAT_SPEC")
          .map((category) => ({
            category,
            prompt_name: "p",
            location: "system",
            excerpt: "",
            message: "m",
            suggestion: "s",
            confidence: "high",
          }));
        return {
          content: JSON.stringify({ issues }),
          usage: { input_tokens: 1000, output_tokens: 100 },
        };
      },
    };
    const capped = new BudgetedClient(fake, estimate(corpus, 2));
    const record = await evaluate(
      capped,
      corpus,
      new Date("2026-11-02T00:00:00Z"),
      "2026-10-21",
      2
    );
    expect(calls).toBe(240);
    expect(record.calls).toHaveLength(240);
    expect(record.latency_ms.n).toBe(240);
    expect(record.corpus).toEqual({ version: "1.0.0", sha256: corpus.sha256, cases: 120 });
    const test1 = record.metrics[0]!.test;
    expect(test1.failed).toEqual([]);
    expect(test1.overall.precision).toMatchObject({ value: 1 });
    // 7 MISSING_FORMAT_SPEC cases in the test split are missed: recall 38/45.
    expect(test1.overall.recall).toMatchObject({ k: 38, n: 45 });
    expect(test1.per_category.MISSING_FORMAT_SPEC!.recall).toMatchObject({ k: 0, n: 7 });
    expect(record.metrics[1]).toEqual({ ...record.metrics[0]!, repeat: 2 });
    expect(record.cost_usd).toBeCloseTo((240 * (1000 * 0.1 + 100 * 0.5)) / 1e6, 10);
  });
});

describe("committed eval records", () => {
  const LIVE = join(ROOT, "runs/live");

  test("the metrics of every committed eval record re-derive from its raw results", async () => {
    const labels = (await Bun.file(join(ROOT, "evals/linter/labels.json")).json()) as Labels;
    for (const f of (await readdir(LIVE)).filter((f) => f.startsWith("linter-eval-"))) {
      const record = (await Bun.file(join(LIVE, f)).json()) as EvalRecord;
      expect(rescore(record, labels)).toEqual(record.metrics);
    }
  });
});
