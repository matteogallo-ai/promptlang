import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { workflowViolations } from "../scripts/check-workflows";

const DIR = join(import.meta.dir, "..", ".github", "workflows");
const SHA = "11d5960a326750d5838078e36cf38b85af677262";

function wf(body: string, perms = "permissions:\n  contents: read\n"): string {
  return `name: t\non:\n  push:\n${perms}jobs:\n  j:\n    runs-on: ubuntu-latest\n${body}`;
}

// Bun.YAML is absent from Bun 1.2.20, the oldest Bun the test matrix runs. These
// tests check the repository's workflow files, not code users run, so the
// "bun latest" and "claims" jobs running them is enough.
describe.skipIf(typeof Bun.YAML === "undefined")("GitHub Actions workflows", () => {
  test("every workflow pins actions by SHA, reads by default and justifies each write", async () => {
    const files = (await readdir(DIR)).filter((f) => /\.ya?ml$/.test(f));
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
    expect(workflowViolations("bad.yml", text)).toEqual([
      "bad.yml: actions/checkout@v4 is not pinned to a full commit SHA",
      "bad.yml: actions/checkout@11d5960 is not pinned to a full commit SHA",
      `bad.yml: actions/checkout@${SHA} has no version comment (# vX.Y.Z)`,
    ]);
  });

  test("sees flow-style steps and permissions, not only block style", () => {
    expect(
      workflowViolations("flow.yml", wf("    steps: [{ uses: actions/checkout@v4 }]\n"))
    ).toEqual(["flow.yml: actions/checkout@v4 is not pinned to a full commit SHA"]);
    expect(
      workflowViolations("flow.yml", wf("    permissions: { id-token: write }\n    steps: []\n"))
    ).toEqual(["flow.yml: job j: id-token: write has no comment line right above it saying why"]);
  });

  test("ignores run scripts and comments, accepts quoted pins and digest-pinned images", () => {
    const text = wf(
      `    steps:\n      # write-all is never used here\n      - uses: "actions/checkout@${SHA}" # v4.4.0\n      - uses: docker://alpine@sha256:${"a".repeat(64)}\n      - run: |\n          mode: write\n          echo "uses: actions/checkout@v4"\n`
    );
    expect(workflowViolations("ok.yml", text)).toEqual([]);
  });

  test("a comment in one job does not justify the same write in another job", () => {
    const text = wf(
      "    permissions: { id-token: write }\n    steps: []\n  k:\n    runs-on: ubuntu-latest\n    permissions:\n      # Why.\n      id-token: write\n    steps: []\n"
    );
    expect(workflowViolations("jobs.yml", text)).toEqual([
      "jobs.yml: job j: id-token: write has no comment line right above it saying why",
    ]);
  });

  test("each write needs its own comment, and a job-level write-all is rejected", () => {
    const two = wf(
      "    permissions:\n      # Why.\n      id-token: write\n      security-events: write\n    steps: []\n"
    );
    expect(workflowViolations("two.yml", two)).toEqual([
      "two.yml: job j: security-events: write has no comment line right above it saying why",
    ]);
    expect(
      workflowViolations("all.yml", wf("    permissions: write-all\n    steps: []\n"))
    ).toEqual(["all.yml: job j: permissions write-all"]);
  });

  test("rejects a broad workflow token, an unexplained write and pull_request_target", () => {
    expect(workflowViolations("a.yml", wf("    steps: []\n", "permissions: write-all\n"))).toEqual([
      'a.yml: workflow-level permissions must be { contents: read } or {}, got "write-all"',
    ]);
    expect(
      workflowViolations("b.yml", wf("    permissions:\n      id-token: write\n    steps: []\n"))
    ).toEqual(["b.yml: job j: id-token: write has no comment line right above it saying why"]);
    const target = wf("    steps: []\n").replace("on:\n  push:\n", "on:\n  pull_request_target:\n");
    expect(workflowViolations("c.yml", target)).toEqual(["c.yml: uses pull_request_target"]);
    const list = wf("    steps: []\n").replace(
      "on:\n  push:\n",
      "on: [push, pull_request_target]\n"
    );
    expect(workflowViolations("d.yml", list)).toEqual(["d.yml: uses pull_request_target"]);
  });

  test("a GitHub Release ships the attestation bundle of an attest-build-provenance step", () => {
    const attest = (a = "attest-build-provenance") =>
      `      - uses: actions/${a}@${SHA} # v4.2.2\n`;
    const job = (script: string, needs = "j") =>
      `  r:\n    needs: ${needs}\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${script}\n`;
    const create = `gh release create "$T" a.tgz a.tgz.sigstore.json`;
    const noAttest = (f: string) =>
      `${f}: job r: makes a GitHub Release, but neither it nor a job it needs runs actions/attest-build-provenance`;
    const noBundle = (f: string) =>
      `${f}: job r: a gh release script does not attach the .sigstore.json attestation bundle`;

    expect(workflowViolations("ok.yml", wf(`    steps:\n${attest()}${job(create)}`))).toEqual([]);
    expect(
      workflowViolations("list.yml", wf(`    steps:\n${attest("attest")}${job(create, "[x, j]")}`))
    ).toEqual([]);
    const sameJob = `    steps: []\n  r:\n    runs-on: ubuntu-latest\n    steps:\n${attest()}      - run: ${create}\n`;
    expect(workflowViolations("same.yml", wf(sameJob))).toEqual([]);

    expect(workflowViolations("a.yml", wf(`    steps: []\n${job(create)}`))).toEqual([
      noAttest("a.yml"),
    ]);
    expect(
      workflowViolations("m.yml", wf(`    steps:\n${attest()}${job(create, "gone")}`))
    ).toEqual([noAttest("m.yml")]);
    expect(
      workflowViolations(
        "b.yml",
        wf(`    steps:\n${attest()}${job('gh  release create "$T" a.tgz')}`)
      )
    ).toEqual([noBundle("b.yml")]);
    // The bundle named in another step does not count for the step that uploads.
    const elsewhere = job(`gh release upload "$T" a.tgz\n      - run: echo a.tgz.sigstore.json`);
    expect(workflowViolations("c.yml", wf(`    steps:\n${attest()}${elsewhere}`))).toEqual([
      noBundle("c.yml"),
    ]);
    const continued = job('|\n          gh release \\\n            create "$T" a.tgz');
    expect(workflowViolations("d.yml", wf(`    steps:\n${attest()}${continued}`))).toEqual([
      noBundle("d.yml"),
    ]);
  });
});
