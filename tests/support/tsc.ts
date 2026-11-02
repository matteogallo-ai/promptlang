import { test } from "bun:test";

/**
 * Spawning tsc takes ~0.3 s on a warm machine but several seconds on a cold CI
 * runner, which is how these tests used to blow bun's 5 s default and flake.
 */
const TSC_TIMEOUT_MS = 60_000;

/** A test that shells out to tsc and therefore needs a longer timeout. */
export function tscTest(name: string, fn: () => Promise<void>): void {
  test(name, fn, TSC_TIMEOUT_MS);
}

/** Runs `tsc --project <tsconfig> --noEmit` with the repository's TypeScript. */
export async function runTsc(
  tsconfigPath: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "x", "tsc", "--project", tsconfigPath, "--noEmit"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}
