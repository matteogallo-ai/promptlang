import type { PromptClient } from "../client";
import type { PromptRequest, PromptResponse } from "../types";
import {
  AllProvidersFailedError,
  AuthenticationError,
  IncompleteResponseError,
  InvalidRequestError,
  PromptClientError,
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
 * Whether the next provider may get the request after this error: only when
 * this provider could not serve it (outage, rate limit, timeout, network, a
 * 404 for a model or endpoint it lacks, malformed body). A timeout may still be
 * billed by the first provider; availability is what a fallback is for. These
 * stop the routing: a wrong key; an incomplete answer (see
 * IncompleteResponseError); a 400, where the request itself is wrong and
 * another provider would get the user's data for nothing; and any error that
 * is not a PromptClientError, which is a bug, not an outage.
 */
function fallsBack(error: unknown): error is PromptClientError {
  return (
    error instanceof PromptClientError &&
    !(error instanceof AuthenticationError) &&
    !(error instanceof IncompleteResponseError) &&
    !(error instanceof InvalidRequestError)
  );
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
      const mapped = "modelMap" in entry ? entry.modelMap[request.model] : request.model;
      if (mapped === undefined) {
        // Skipped, not sent: this provider has no name for the requested model.
        errors.push(
          new InvalidRequestError(`no model mapped for '${request.model}' on ${label(i)}`)
        );
      } else {
        try {
          return await entry.client.complete({ ...request, model: mapped });
        } catch (err) {
          if (!fallsBack(err)) throw err;
          errors.push(err);
        }
      }
      if (i + 1 < this.entries.length) this.onFallback?.(errors.at(-1)!, i);
    }

    throw new AllProvidersFailedError(errors);
  }
}
