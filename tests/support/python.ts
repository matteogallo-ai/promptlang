import { describe, test } from "bun:test";

/**
 * Generated Python imports `typing.NotRequired`, which Python 3.11 added; under an
 * older `python3` it fails with an ImportError that says nothing about the
 * prerequisite. Tests that run Python are skipped with this reason instead. CI
 * checks the version before `bun test`, so a skip there cannot go unnoticed, and
 * `check:claims` refuses a claim whose test was skipped.
 */
const MIN_MINOR = 11;

/** Why Python tests cannot run here, or null when `python3` is 3.11 or later. */
export function pythonSkipReason(
  run: () => { exitCode: number; stdout: string } = () => {
    const r = Bun.spawnSync(["python3", "-c", "import sys; print(*sys.version_info[:2])"]);
    return { exitCode: r.exitCode, stdout: r.stdout.toString() };
  }
): string | null {
  let result: { exitCode: number; stdout: string };
  try {
    result = run();
  } catch (error) {
    // Bun throws when the executable is not on PATH; that is the reason itself.
    return `python3 not found on PATH (${(error as Error).message}); Python 3.11+ is required`;
  }
  if (result.exitCode !== 0) return `python3 exited ${result.exitCode}; Python 3.11+ is required`;
  const [major, minor] = result.stdout.trim().split(" ").map(Number);
  if (major === 3 && minor !== undefined && minor >= MIN_MINOR) return null;
  return `python3 is ${major}.${minor}; Python 3.11+ is required`;
}

const reason = pythonSkipReason();
if (reason !== null) console.warn(`Skipping the tests that run Python: ${reason}.`);

/** A test that runs Python; skipped, with the reason printed once, when it cannot. */
export const pythonTest = test.skipIf(reason !== null);

/** A describe block whose tests run Python. */
export const describePython = describe.skipIf(reason !== null);

/** For a top-level beforeAll that would otherwise run Python and throw. */
export const pythonAvailable = reason === null;
