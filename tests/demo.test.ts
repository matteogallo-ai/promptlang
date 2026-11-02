import { expect } from "bun:test";
import { resolve } from "node:path";
import { runProcess, subprocessTest } from "./support/subprocess";

// The demo asserts every step's exit code itself; this keeps it working in CI.
subprocessTest("bun run demo plays the whole SemVer scenario", async () => {
  const r = await runProcess([process.execPath, resolve(import.meta.dir, "../scripts/demo.ts")]);
  expect(r.stderr).toBe("");
  expect(r.exitCode).toBe(0);
  for (const step of [
    "Step 1: v1.0.0",
    "Step 2: an incompatible change released as 1.1.0 is caught",
    "major bump required: a major change needs at least 2.0.0, got 1.1.0",
    "Step 3: the same change released as 2.0.0 passes",
    'requires "^1.0.0", got 2.0.0',
    "3 passed, 0 failed",
    "Demo complete: every step exited as expected.",
  ]) {
    expect(r.stdout).toContain(step);
  }
});
