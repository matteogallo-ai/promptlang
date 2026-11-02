import { afterEach, beforeEach, spyOn } from "bun:test";

/**
 * The current test's `fetch` spy. An ES live binding: importers see the spy
 * that `useFetchSpy`'s `beforeEach` installed for the running test.
 */
// biome-ignore lint/suspicious/noExplicitAny: Bun types fetch with a static preconnect member, so typed mock implementations do not satisfy it; this spy only feeds canned Responses.
export let fetchSpy: any;

/**
 * Replaces `globalThis.fetch` for every test in the calling file. An unmocked
 * call rejects, so a test can never reach a real provider by accident.
 */
export function useFetchSpy(): void {
  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("fetch called without a mock — call fetchSpy.mockResolvedValueOnce in the test")
    );
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });
}
