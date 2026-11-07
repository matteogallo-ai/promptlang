import { test } from "bun:test";

/**
 * Spawning tsc or `bun run` takes ~0.3 s on a warm machine but several seconds
 * on a cold CI runner, which is how these tests used to blow bun's 5 s default
 * and flake.
 */
export const SUBPROCESS_TIMEOUT_MS = 60_000;

/** A test that shells out to a subprocess and therefore needs a longer timeout. */
export function subprocessTest(name: string, fn: () => Promise<void>): void {
  test(name, fn, SUBPROCESS_TIMEOUT_MS);
}

/**
 * Runs a command and collects its output. The pipes are drained while waiting
 * for exit: awaiting `exited` first deadlocks once the output fills the pipe.
 */
export async function runProcess(
  cmd: string[],
  cwd = process.cwd()
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

/** Runs `tsc --project <tsconfig> --noEmit` with the repository's TypeScript. */
export function runTsc(tsconfigPath: string) {
  return runProcess([process.execPath, "x", "tsc", "--project", tsconfigPath, "--noEmit"]);
}
