import type { PromptClient } from "../client";
import type { PromptRequest, PromptResponse } from "../types";
import {
  AllProvidersFailedError,
  AuthenticationError,
  IncompleteResponseError,
  InvalidRequestError,
} from "../errors";

/**
 * A provider with its own model names. Generated code sends one model (the
 * file's `@model`); `modelMap` translates it for this provider, so a Claude ID
 * never reaches OpenAI. A requested model missing from the map skips this
 * provider instead of sending it a name it cannot serve.
 */
export interface RoutedClient {
  client: PromptClient;
  /** Requested model → model sent to this provider. */
  modelMap: Readonly<Record<string, string>>;
}

/** Options for configuring the RoutingClient. */
export interface RoutingClientOptions {
  /** Primary provider. Always tried first. */
  primary: PromptClient | RoutedClient;
  /**
   * Ordered list of fallback providers. Tried in sequence when the primary (or a
   * preceding fallback) throws a non-fatal error.
   */
  fallbacks?: Array<PromptClient | RoutedClient>;
  /**
   * Called each time the client switches to a new fallback. Useful for logging
   * and observability.
   * @param error   - The error thrown by the provider that just failed.
   * @param fallbackIndex - Zero-based index of the fallback being tried next.
   */
  onFallback?: (error: Error, fallbackIndex: number) => void;
}

function routed(entry: PromptClient | RoutedClient): RoutedClient | { client: PromptClient } {
  return "client" in entry && "modelMap" in entry ? entry : { client: entry as PromptClient };
}

function label(i: number): string {
  return i === 0 ? "the primary" : `fallback ${i - 1}`;
}

/**
 * A PromptClient that tries multiple providers in order. If the primary fails
 * with a non-fatal error, it automatically switches to the next fallback.
 * AuthenticationError is never retried via fallback — it is re-thrown immediately.
 *
 * Use case: "Try Claude, if it fails use GPT-5, if that fails use local Llama."
 */
export class RoutingClient implements PromptClient {
  private readonly entries: Array<RoutedClient | { client: PromptClient }>;
  private readonly onFallback?: (error: Error, fallbackIndex: number) => void;

  constructor(options: RoutingClientOptions) {
    this.entries = [options.primary, ...(options.fallbacks ?? [])].map(routed);
    this.onFallback = options.onFallback;
  }

  async complete(request: PromptRequest): Promise<PromptResponse> {
    const errors: Error[] = [];

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i]!;
      try {
        let model = request.model;
        if ("modelMap" in entry) {
          const mapped = entry.modelMap[request.model];
          if (mapped === undefined) {
            throw new InvalidRequestError(`no model mapped for '${request.model}' on ${label(i)}`);
          }
          model = mapped;
        }
        return await entry.client.complete({ ...request, model });
      } catch (err) {
        const error = err as Error;
        errors.push(error);

        // A wrong API key is never retryable via fallback, and an incomplete answer
        // is not sent elsewhere (see IncompleteResponseError).
        if (error instanceof AuthenticationError || error instanceof IncompleteResponseError)
          throw error;

        // Notify about the switch before trying the next provider.
        if (i + 1 < this.entries.length) {
          this.onFallback?.(error, i);
        }
      }
    }

    throw new AllProvidersFailedError(errors);
  }
}
