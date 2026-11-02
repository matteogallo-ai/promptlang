import { describe, expect, test } from "bun:test";
import { scanText } from "./check-stale-narrative";

function kinds(text: string): string[] {
  return scanText("f.md", text).map((f) => f.kind);
}

describe("check-stale-narrative: scanText", () => {
  test("flags the known stale entry-point note", () => {
    const findings = scanText(
      "src/index.ts",
      " * This is the entry point. Implementation coming in v0.2.\n"
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      file: "src/index.ts",
      line: 1,
      kind: "implementation-coming",
    });
  });

  test("flags future-version references", () => {
    expect(kinds("Streaming (deferred to v0.8+)")).toEqual(["future-version"]);
    expect(kinds("Remote registry planned for post-v1.0.")).toEqual(["future-version"]);
    expect(kinds("Once promptlang is published to npm (v1.0), this flag")).toEqual([
      "future-version",
    ]);
    expect(kinds("An npm package will be published in a 1.x point release.")).toEqual([
      "future-version",
    ]);
    expect(kinds("Rule suppression via comments (v0.8+)")).toEqual(["future-version"]);
  });

  test("flags sprint references", () => {
    expect(kinds("Implementations land in S3")).toEqual(["sprint"]);
    expect(kinds("see S4.2 for details")).toEqual(["sprint"]);
    expect(kinds("milestones with two-week sprints")).toEqual(["sprint"]);
  });

  test("flags TODO/FIXME without an issue link, accepts linked ones", () => {
    expect(kinds("// TODO: handle CRLF")).toEqual(["todo-without-issue"]);
    expect(kinds("// FIXME later")).toEqual(["todo-without-issue"]);
    expect(kinds("// TODO(#42): handle CRLF")).toEqual([]);
  });

  test("does not flag past or present statements", () => {
    expect(kinds("Added in v0.9: the import syntax.")).toEqual([]);
    expect(kinds("Since 1.0.0 the API is stable.")).toEqual([]);
    expect(kinds("SHA-256 hashes, S3 buckets and TODOS are fine")).toEqual([]);
    expect(kinds("")).toEqual([]);
  });

  test("reports 1-based line numbers and a trimmed excerpt", () => {
    const findings = scanText("a.md", "ok\n  coming in v2  \n");
    expect(findings[0]).toMatchObject({ line: 2, excerpt: "coming in v2" });
  });
});
