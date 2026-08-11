import { AuthenticationError, InvalidRequestError, NotFoundError } from "../errors";

function isNonRetryable(err: Error): boolean {
  return (
    err instanceof AuthenticationError ||
    err instanceof InvalidRequestError ||
    err instanceof NotFoundError
  );
}

/**
 * Retries `fn` up to `maxRetries` additional times on failure, sleeping
 * `baseDelay * 2^attempt` ms between attempts. Non-retryable errors
 * (AuthenticationError, InvalidRequestError, NotFoundError) are re-thrown
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
      if (attempt < maxRetries && baseDelay > 0) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, baseDelay * 2 ** attempt)
        );
      }
    }
  }
  throw lastError;
}
