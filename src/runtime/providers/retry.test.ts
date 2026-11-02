import { describe, expect, test } from "bun:test";
import { RateLimitError } from "../errors";
import { parseRetryAfter } from "./response";
import { MAX_RETRY_AFTER_SECONDS, withRetry } from "./retry";

function failingTwiceThen<T>(error: () => Error, value: T): () => Promise<T> {
  let n = 0;
  return async () => {
    if (n++ < 2) throw error();
    return value;
  };
}

describe("withRetry and Retry-After", () => {
  test("waits the provider's Retry-After instead of the exponential backoff", async () => {
    const start = performance.now();
    const fn = failingTwiceThen(() => new RateLimitError("slow down", "p", 0.15), "ok");
    // A 1 ms backoff would finish at once; Retry-After asks for 150 ms per wait.
    expect(await withRetry(fn, 3, 1)).toBe("ok");
    expect(performance.now() - start).toBeGreaterThanOrEqual(290);
  });

  test("a short Retry-After also replaces a long backoff", async () => {
    const start = performance.now();
    const fn = failingTwiceThen(() => new RateLimitError("slow down", "p", 0.01), "ok");
    expect(await withRetry(fn, 3, 5_000)).toBe("ok");
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  test("a Retry-After beyond the cap is not waited for: the error is thrown at once", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new RateLimitError("come back later", "p", MAX_RETRY_AFTER_SECONDS + 1);
    };
    await expect(withRetry(fn, 3, 1)).rejects.toThrow("come back later");
    expect(calls).toBe(1);
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  test("reads delta-seconds", () => {
    expect(parseRetryAfter("7", now)).toBe(7);
    expect(parseRetryAfter("0", now)).toBe(0);
  });
  test("reads an HTTP-date as seconds from now, never negative", () => {
    expect(parseRetryAfter("Mon, 02 Nov 2026 12:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("Mon, 02 Nov 2026 11:00:00 GMT", now)).toBe(0);
  });
  test("ignores a missing or unreadable header", () => {
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter("-3", now)).toBeUndefined();
  });
});
