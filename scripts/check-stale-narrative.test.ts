import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepository, scanText } from "./check-stale-narrative";

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
    // The sentence that sat in packages/yaml-parser/README.md.
    expect(kinds("Will be removed in v2.0 — prefer `YamlParseError`.")).toEqual(["future-version"]);
    expect(kinds("This option will be deprecated.")).toEqual(["future-version"]);
    // The comment that sat in docs/examples/summarize-and-translate.prompt.
    expect(
      kinds("// Note: comparison operators (> n, <= n) and regex matchers require the v0.6")
    ).toEqual(["future-version"]);
    expect(kinds("needs v2 of the engine")).toEqual(["future-version"]);
  });

  test("flags future tense without a version number", () => {
    expect(kinds("This will support SemVer soon.")).toEqual(["future-tense"]);
    expect(kinds("We will add streaming.")).toEqual(["future-tense"]);
    expect(kinds("Planned for the next release.")).toEqual(["future-tense"]);
    expect(kinds("Streaming is coming soon")).toEqual(["future-tense"]);
    expect(kinds("Calls to imported prompts do not parse yet.")).toEqual(["future-tense"]);
    expect(kinds("It is not supported yet")).toEqual(["future-tense"]);
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
    expect(kinds("// TODO (#12): handle CRLF")).toEqual(["todo-without-issue"]);
    expect(kinds("// TODO #12 handle CRLF")).toEqual(["todo-without-issue"]);
  });

  test("does not flag past or present statements", () => {
    expect(kinds("Added in v0.9: the import syntax.")).toEqual([]);
    expect(kinds("Since 1.0.0 the API is stable.")).toEqual([]);
    expect(kinds("SHA-256 hashes, S3 buckets and TODOS are fine")).toEqual([]);
    expect(kinds("The result will be cached by the caller.")).toEqual([]);
    expect(kinds("Generated functions make network calls when run.")).toEqual([]);
    expect(kinds("The generated code requires Python 3.11 or later.")).toEqual([]);
    expect(kinds("")).toEqual([]);
  });

  test("reports 1-based line numbers and a trimmed excerpt", () => {
    const findings = scanText("a.md", "ok\n  coming in v2  \n");
    expect(findings[0]).toMatchObject({ line: 2, excerpt: "coming in v2" });
  });
});

describe("check-stale-narrative: scanRepository", () => {
  test("scans .prompt files wherever they are, not only under docs/", async () => {
    const root = await mkdtemp(join(tmpdir(), "stale-narrative-"));
    try {
      await mkdir(join(root, "packages"));
      await mkdir(join(root, "examples", "deep"), { recursive: true });
      await mkdir(join(root, "node_modules", "dep"), { recursive: true });
      await Bun.write(join(root, "README.md"), "ok\n");
      await Bun.write(join(root, "examples", "deep", "a.prompt"), "// coming in v2\n");
      await Bun.write(join(root, "node_modules", "dep", "b.prompt"), "// coming in v2\n");
      const findings = await scanRepository(root);
      expect(findings.map((f) => f.file)).toEqual(["examples/deep/a.prompt"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("scans each package's README, which npm publishes with it", async () => {
    const root = await mkdtemp(join(tmpdir(), "stale-narrative-"));
    try {
      await mkdir(join(root, "packages", "lib", "src"), { recursive: true });
      await Bun.write(join(root, "README.md"), "ok\n");
      await Bun.write(join(root, "packages", "lib", "README.md"), "Coming in v2.\n");
      const findings = await scanRepository(root);
      expect(findings.map((f) => f.file)).toEqual(["packages/lib/README.md"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
