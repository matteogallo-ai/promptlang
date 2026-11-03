import {
  AuthenticationError,
  IncompleteResponseError,
  InvalidRequestError,
  InvalidResponseError,
  NotFoundError,
  RateLimitError,
} from "../errors";

/**
 * Longest Retry-After the client waits out. A provider asking for more is
 * signalling an outage or quota, and a caller blocked for minutes is worse
 * than an error it can handle.
 */
export const MAX_RETRY_AFTER_SECONDS = 60;

function isNonRetryable(err: Error): boolean {
  return (
    err instanceof AuthenticationError ||
    err instanceof InvalidRequestError ||
    err instanceof InvalidResponseError ||
    err instanceof IncompleteResponseError ||
    err instanceof NotFoundError
  );
}

/**
 * Retries `fn` up to `maxRetries` additional times on failure, sleeping
 * `baseDelay * 2^attempt` ms between attempts, or the provider's Retry-After
 * when a RateLimitError carries one (thrown at once beyond
 * MAX_RETRY_AFTER_SECONDS). Non-retryable errors (AuthenticationError,
 * InvalidRequestError, InvalidResponseError, IncompleteResponseError,
 * NotFoundError) are re-thrown
 * immediately without consuming retry budget.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelay: number
): Promise<T> {
  let lastError: Error = new Error("withRetry: no attempts made");
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (isNonRetryable(lastError)) throw lastError;
      const retryAfter = lastError instanceof RateLimitError ? lastError.retryAfter : undefined;
      if (retryAfter !== undefined && retryAfter > MAX_RETRY_AFTER_SECONDS) throw lastError;
      const delay = retryAfter !== undefined ? retryAfter * 1000 : baseDelay * 2 ** attempt;
      if (attempt < maxRetries && delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
