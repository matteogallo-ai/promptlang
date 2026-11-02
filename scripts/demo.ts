#!/usr/bin/env bun
/**
 * `bun run demo`: the SemVer-for-prompts scenario, played with the real CLI in a
 * temporary Git repository built from docs/examples/demo/. Each step states the
 * exit code it expects; any other exit code stops the demo with status 1, so
 * running the demo is also a test of it (tests/demo.test.ts).
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DEMO = join(ROOT, "docs/examples/demo");
const CLI = join(ROOT, "src/cli/cli.ts");

function run(cwd: string, cmd: string[]): { code: number; out: string } {
  const p = Bun.spawnSync(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: p.exitCode, out: (p.stdout.toString() + p.stderr.toString()).trimEnd() };
}

function git(cwd: string, ...args: string[]): void {
  const r = run(cwd, ["git", ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed:\n${r.out}`);
}

let step = 0;
function promptlang(cwd: string, title: string, args: string[], expected: number): void {
  step++;
  console.log(`\n── Step ${step}: ${title}\n$ promptlang ${args.join(" ")}`);
  const r = run(cwd, [process.execPath, CLI, ...args]);
  console.log(r.out.replace(/^/gm, "  "));
  if (r.code !== expected) {
    console.error(`\nDemo failed: expected exit ${expected}, got ${r.code}.`);
    process.exit(1);
  }
  console.log(`  → exit ${r.code}, as expected`);
}

const repo = await mkdtemp(join(tmpdir(), "promptlang-demo-"));
try {
  const lib = join(repo, "prompts/sentiment.prompt");
  const v1 = await Bun.file(join(DEMO, "prompts/sentiment.v1.prompt")).text();
  const v2 = await Bun.file(join(DEMO, "prompts/sentiment.v2.prompt")).text();
  await cp(join(DEMO, "promptlang.yaml"), join(repo, "promptlang.yaml"));
  await cp(join(DEMO, "prompts/report.prompt"), join(repo, "prompts/report.prompt"));
  await Bun.write(lib, v1);
  git(repo, "init", "-q", "-b", "main");
  for (const [key, value] of [
    ["user.email", "demo@example.com"],
    ["user.name", "demo"],
    ["commit.gpgsign", "false"],
  ]) {
    git(repo, "config", key!, value!);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "sentiment 1.0.0");
  git(repo, "tag", "v1.0.0");
  console.log(`Demo repository: ${repo} (sentiment.prompt 1.0.0 committed and tagged v1.0.0)`);

  promptlang(repo, 'v1.0.0: report.prompt\'s requires "^1.0.0" is satisfied', ["install"], 0);

  await Bun.write(lib, v2.replace('@version "2.0.0"', '@version "1.1.0"'));
  promptlang(repo, "an incompatible change released as 1.1.0 is caught", ["semver-check"], 1);

  await Bun.write(lib, v2);
  promptlang(repo, "the same change released as 2.0.0 passes", ["semver-check"], 0);

  promptlang(repo, "the consumer pinned to ^1.0.0 now fails cleanly", ["install"], 1);

  promptlang(
    repo,
    "the tests of every prompt pass (mock responses, no network)",
    ["test", "prompts"],
    0
  );

  console.log("\nDemo complete: every step exited as expected.");
} finally {
  await rm(repo, { recursive: true, force: true });
}
