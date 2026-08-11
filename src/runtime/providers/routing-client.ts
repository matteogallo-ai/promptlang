import type { PromptClient } from "../client";
import type { PromptRequest, PromptResponse } from "../types";
import { AuthenticationError, AllProvidersFailedError } from "../errors";

/** Options for configuring the RoutingClient. */
export interface RoutingClientOptions {
  /** Primary provider. Always tried first. */
  primary: PromptClient;
  /**
   * Ordered list of fallback providers. Tried in sequence when the primary (or a
   * preceding fallback) throws a non-fatal error.
   */
  fallbacks?: PromptClient[];
  /**
   * Called each time the client switches to a new fallback. Useful for logging
   * and observability.
   * @param error   - The error thrown by the provider that just failed.
   * @param fallbackIndex - Zero-based index of the fallback being tried next.
   */
  onFallback?: (error: Error, fallbackIndex: number) => void;
}

/**
 * A PromptClient that tries multiple providers in order. If the primary fails
 * with a non-fatal error, it automatically switches to the next fallback.
 * AuthenticationError is never retried via fallback — it is re-thrown immediately.
 *
 * Use case: "Try Claude, if it fails use GPT-4, if that fails use local Llama."
 */
export class RoutingClient implements PromptClient {
  private readonly primary: PromptClient;
  private readonly fallbacks: PromptClient[];
  private readonly onFallback?: (error: Error, fallbackIndex: number) => void;

  constructor(options: RoutingClientOptions) {
    this.primary = options.primary;
    this.fallbacks = options.fallbacks ?? [];
    this.onFallback = options.onFallback;
  }

  async complete(request: PromptRequest): Promise<PromptResponse> {
    const clients = [this.primary, ...this.fallbacks];
    const errors: Error[] = [];

    for (let i = 0; i < clients.length; i++) {
      try {
        return await clients[i]!.complete(request);
      } catch (err) {
        const error = err as Error;
        errors.push(error);

        // A wrong API key is never retryable via fallback.
        if (error instanceof AuthenticationError) throw error;

        // Notify about the switch before trying the next provider.
        if (i + 1 < clients.length) {
          this.onFallback?.(error, i);
        }
      }
    }

    throw new AllProvidersFailedError(errors);
  }
}
