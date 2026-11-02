import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { workflowViolations } from "../scripts/check-workflows";

const DIR = join(import.meta.dir, "..", ".github", "workflows");
const SHA = "11d5960a326750d5838078e36cf38b85af677262";

function wf(body: string, perms = "permissions:\n  contents: read\n"): string {
  return `name: t\non:\n  push:\n${perms}jobs:\n  j:\n    runs-on: ubuntu-latest\n${body}`;
}

describe("GitHub Actions workflows", () => {
  test("every workflow pins actions by SHA, reads by default and justifies each write", async () => {
    const files = (await readdir(DIR)).filter((f) => f.endsWith(".yml"));
    expect(files.length).toBeGreaterThan(0);
    const violations: string[] = [];
    for (const f of files)
      violations.push(...workflowViolations(f, await Bun.file(join(DIR, f)).text()));
    expect(violations).toEqual([]);
  });

  test("accepts a pinned action, a local reusable workflow and a commented write", () => {
    const text = wf(
      `    permissions:\n      # Uploads SARIF.\n      security-events: write\n    steps:\n      - uses: actions/checkout@${SHA} # v4.4.0\n  k:\n    uses: ./.github/workflows/ci.yml\n`
    );
    expect(workflowViolations("ok.yml", text)).toEqual([]);
  });

  test("rejects a tag, a short SHA and a SHA without its version comment", () => {
    const text = wf(
      `    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/checkout@11d5960\n      - uses: actions/checkout@${SHA}\n`
    );
    expect(workflowViolations("bad.yml", text)).toHaveLength(3);
  });

  test("rejects a broad workflow token, an unexplained write and pull_request_target", () => {
    expect(workflowViolations("a.yml", wf("    steps: []\n", "permissions: write-all\n"))).toEqual([
      "a.yml:4: write-all permission",
      'a.yml: workflow-level permissions must be { contents: read }, got "write-all"',
    ]);
    expect(
      workflowViolations("b.yml", wf("    permissions:\n      id-token: write\n    steps: []\n"))
    ).toEqual(["b.yml:10: write permission without a comment saying why"]);
    const target = wf("    steps: []\n").replace("on:\n  push:\n", "on:\n  pull_request_target:\n");
    expect(workflowViolations("c.yml", target)).toEqual(["c.yml: uses pull_request_target"]);
  });
});
