import type { Parameters } from "fast-check";

/**
 * A fixed seed makes every CI run explore the same inputs, so a red property
 * test is reproducible from the log alone; fast-check prints the seed and the
 * shrunk counterexample on failure. `numRuns` stays per test so the whole
 * suite remains a few seconds.
 */
export function propertyParams<T>(numRuns: number): Parameters<T> {
  return { seed: 20261102, numRuns };
}
