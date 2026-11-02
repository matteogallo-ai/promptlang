import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pullRequestCheckNames } from "../scripts/check-workflows";

const ROOT = join(import.meta.dir, "..");
const WORKFLOWS = join(ROOT, ".github", "workflows");

interface Ruleset {
  rules: { type: string; parameters?: { required_status_checks?: { context: string }[] } }[];
}

// Bun.YAML is absent from Bun 1.2.20; see tests/workflows.test.ts.
describe.skipIf(typeof Bun.YAML === "undefined")("main ruleset", () => {
  test("every required check in docs/security/ruleset-main.json is a check that pull requests run", async () => {
    const names = new Set<string>();
    for (const f of (await readdir(WORKFLOWS)).filter((f) => /\.ya?ml$/.test(f)))
      for (const n of pullRequestCheckNames(await Bun.file(join(WORKFLOWS, f)).text()))
        names.add(n);
    const ruleset = (await Bun.file(
      join(ROOT, "docs/security/ruleset-main.json")
    ).json()) as Ruleset;
    const required = ruleset.rules
      .flatMap((r) => r.parameters?.required_status_checks ?? [])
      .map((c) => c.context);
    expect(required.length).toBeGreaterThan(0);
    expect(required.filter((c) => !names.has(c))).toEqual([]);
    for (const c of ["osv-scanner", "semver-check", "package (node 20)", "analyze (actions)"])
      expect(required).toContain(c);
  });

  test("check names expand the matrix, use the job key when unnamed, and skip non-PR workflows", () => {
    const pr = `on:\n  pull_request:\njobs:\n  a:\n    runs-on: x\n  t:\n    name: test (bun \${{ matrix.bun }})\n    strategy:\n      matrix:\n        bun: ["1", latest]\n  z:\n    strategy:\n      matrix:\n        language: [ts, actions]\n`;
    expect(pullRequestCheckNames(pr)).toEqual([
      "a",
      "test (bun 1)",
      "test (bun latest)",
      "z (ts)",
      "z (actions)",
    ]);
    expect(pullRequestCheckNames("on: [push]\njobs:\n  a:\n    runs-on: x\n")).toEqual([]);
  });
});
