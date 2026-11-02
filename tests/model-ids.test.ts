import { describe, expect, test } from "bun:test";

/**
 * Anthropic model IDs use hyphens only: `claude-opus-4-7`, never
 * `claude-opus-4.7`. A dotted ID is rejected by the API, and generated code
 * copies `@model` verbatim into every request.
 */
const ANTHROPIC_ID = /^claude-(?:fable|mythos|opus|sonnet|haiku)-\d+(?:-\d+)?(?:-\d{8})?$/;

/**
 * IDs listed as "Active" on https://platform.claude.com/docs/en/about-claude/model-deprecations
 * when this list was last checked (2026-11-02). The examples may only use these;
 * update the list (and the date) when the page changes.
 */
const ACTIVE_ON_2026_11_02 = new Set([
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-haiku-5-5",
  "claude-haiku-4-5",
]);

/** Tracked files that ship to readers: docs, examples and non-test source. */
function shippedFiles(): string[] {
  const out = Bun.spawnSync([
    "git",
    "ls-files",
    "README.md",
    "*.md",
    "docs",
    "src",
    "packages/*/src",
  ]);
  return new TextDecoder()
    .decode(out.stdout)
    .split("\n")
    .filter((f) => f !== "" && !f.endsWith(".test.ts") && f !== "CHANGELOG.md");
}

describe("model IDs in shipped files", () => {
  test("every claude-* model ID mentioned has the official hyphenated format", async () => {
    const bad: string[] = [];
    for (const file of shippedFiles()) {
      const text = await Bun.file(file).text();
      for (const match of text.matchAll(/\bclaude-(?:fable|mythos|opus|sonnet|haiku)[\w.-]*/g)) {
        const id = match[0].replace(/[.-]+$/, "");
        if (!ANTHROPIC_ID.test(id)) bad.push(`${file}: ${id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("every @model in docs/examples is an active Anthropic model", async () => {
    const models: string[] = [];
    for (const file of shippedFiles().filter((f) => f.startsWith("docs/examples/"))) {
      const text = await Bun.file(file).text();
      for (const m of text.matchAll(/^@model\s+(\S+)/gm)) models.push(`${file}: ${m[1]}`);
    }
    expect(models.length).toBeGreaterThan(0);
    expect(models.filter((m) => !ACTIVE_ON_2026_11_02.has(m.split(": ")[1]!))).toEqual([]);
  });

  test("the format rule rejects dotted and malformed IDs", () => {
    expect(ANTHROPIC_ID.test("claude-opus-4-7")).toBe(true);
    expect(ANTHROPIC_ID.test("claude-haiku-4-5-20251001")).toBe(true);
    expect(ANTHROPIC_ID.test("claude-opus-4.7")).toBe(false);
    expect(ANTHROPIC_ID.test("claude-opus")).toBe(false);
    expect(ANTHROPIC_ID.test("claude-4-opus")).toBe(false);
  });
});
