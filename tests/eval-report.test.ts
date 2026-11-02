import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  errorRate,
  latestRecord,
  renderSlo,
  SLO,
  staleDocs,
  withBlock,
} from "../scripts/eval-report";
import type { EvalRecord } from "../scripts/linter-eval";

const record = (over: Partial<EvalRecord>): EvalRecord =>
  ({
    date: "2026-11-02T00:00:00.000Z",
    model: "claude-haiku-5-5",
    results: [],
    calls: [],
    cost_usd: 0,
    latency_ms: { n: 0, p50: null, p95: null },
    ...over,
  }) as EvalRecord;

describe("measured blocks of docs/SLO.md and docs/SYSTEM_CARD.md", () => {
  test("both docs match what the latest committed eval record renders", async () => {
    expect(await staleDocs()).toEqual([]);
  });

  test("the latest record is the newest by name, null when there is none", async () => {
    const dir = await mkdtemp(join(tmpdir(), "promptlang-report-"));
    try {
      expect(await latestRecord(dir)).toBeNull();
      await Bun.write(join(dir, "linter-eval-2026-01-01.json"), '{"n":1}');
      await Bun.write(join(dir, "linter-eval-2026-02-01.json"), '{"n":2}');
      await Bun.write(join(dir, "ai-linter-2026-03-01.json"), '{"n":3}');
      expect(await latestRecord(dir)).toMatchObject({ name: "linter-eval-2026-02-01.json" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a breached objective is marked not met", () => {
    const r = record({
      results: [
        { repeat: 1, case: "a", predicted: null },
        { repeat: 1, case: "b", predicted: [] },
      ],
      calls: [{ case: "b", repeat: 1, latency_ms: 30_000, input_tokens: 1, output_tokens: 1 }],
      cost_usd: 0.0005,
      latency_ms: { n: 1, p50: 30_000, p95: 30_000 },
    });
    expect(errorRate(r)).toMatchObject({ k: 1, n: 2, value: 0.5 });
    const text = renderSlo({ name: "linter-eval-x.json", record: r });
    expect(text).toContain(`| p95 latency per call | ≤ ${SLO.p95LatencyMs / 1000} s | 30.0 s`);
    expect(text.match(/\*\*not met\*\*/g)).toHaveLength(2);
    expect(text).toContain("$0.00050 | met |");
  });

  test("a doc without markers is an error, not silently skipped", () => {
    expect(() => withBlock("no markers here", "x")).toThrow("markers");
    expect(withBlock("a\n<!-- measured:start -->\nold\n<!-- measured:end -->\nb", "new")).toBe(
      "a\n<!-- measured:start -->\nnew\n<!-- measured:end -->\nb"
    );
  });
});
