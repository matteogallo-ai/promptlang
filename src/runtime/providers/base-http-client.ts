import type { PromptClient } from "../client";
import type { PromptRequest, PromptResponse } from "../types";
import {
  AuthenticationError,
  InvalidRequestError,
  NetworkError,
  NotFoundError,
  type PromptClientError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from "../errors";
import { parseRetryAfter, readJsonObject } from "./response";
import { withRetry } from "./retry";

/** What a provider sends: the client adds the method, timeout and retries. */
export interface HttpRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface HttpClientSettings {
  provider: string;
  timeout: number;
  maxRetries: number;
  retryDelay: number;
}

type ErrorBody = { error?: { message?: string } };

/**
 * The transport shared by the HTTP providers: one POST per attempt with a
 * timeout, retries, typed errors for non-2xx statuses, and a JSON-object check
 * on the body. A provider supplies only `buildRequest` and `parseResponse`.
 */
export abstract class BaseHttpClient implements PromptClient {
  protected readonly provider: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(settings: HttpClientSettings) {
    this.provider = settings.provider;
    this.timeout = settings.timeout;
    this.maxRetries = settings.maxRetries;
    this.retryDelay = settings.retryDelay;
  }

  /** The URL, headers and JSON body for one request. */
  protected abstract buildRequest(request: PromptRequest): HttpRequestSpec;

  /** Reads a 2xx JSON object into a PromptResponse; throws InvalidResponseError on a bad shape. */
  protected abstract parseResponse(
    data: Record<string, unknown>,
    request: PromptRequest
  ): PromptResponse;

  /** The error for a non-2xx response. Providers with other status meanings override it. */
  protected async errorFor(
    response: Response,
    _request: PromptRequest
  ): Promise<PromptClientError> {
    let message: string | undefined;
    try {
      message = ((await response.json()) as ErrorBody)?.error?.message;
    } catch {
      // A non-JSON error body still gets classified by its status below.
    }
    switch (response.status) {
      case 401:
        return new AuthenticationError(message, this.provider);
      case 429:
        return new RateLimitError(
          message,
          this.provider,
          parseRetryAfter(response.headers.get("retry-after"))
        );
      case 400:
        return new InvalidRequestError(message, this.provider);
      // Apart from the request, so routing tells a model or endpoint this
      // provider lacks from a request no provider would accept.
      case 404:
        return new NotFoundError(message, this.provider);
      default:
        return new ServerError(response.status, message, this.provider);
    }
  }

  /** The error for a fetch that rejected other than by the timeout. */
  protected networkError(error: Error): PromptClientError {
    return new NetworkError(`Network error: ${error.message}`, this.provider);
  }

  async complete(request: PromptRequest): Promise<PromptResponse> {
    return withRetry(() => this.send(request), this.maxRetries, this.retryDelay);
  }

  private async send(request: PromptRequest): Promise<PromptResponse> {
    const spec = this.buildRequest(request);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    let response: Response;
    try {
      response = await fetch(spec.url, {
        method: "POST",
        headers: spec.headers,
        body: JSON.stringify(spec.body),
        signal: controller.signal,
      });
    } catch (err) {
      const error = err as Error;
      if (error.name === "AbortError") {
        throw new TimeoutError(`Request timed out after ${this.timeout}ms`, this.provider);
      }
      throw redacted(this.networkError(error), spec.headers);
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) throw redacted(await this.errorFor(response, request), spec.headers);
    return this.parseResponse(await readJsonObject(response, this.provider), request);
  }
}

const CREDENTIAL_HEADER = /key|authorization|token/i;

/**
 * Removes the request's credentials from `error`. Its message quotes the
 * provider's error body, which reaches terminals, CI logs and committed run
 * records; a provider or a proxy that echoes the key must not leak it there.
 */
function redacted<E extends Error>(error: E, headers: Record<string, string>): E {
  for (const [name, value] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADER.test(name)) continue;
    const secret = value.replace(/^Bearer\s+/i, "");
    // A short value would match ordinary words; real keys are far longer.
    if (secret.length < 8) continue;
    error.message = error.message.replaceAll(secret, "[redacted]");
    if (error.stack) error.stack = error.stack.replaceAll(secret, "[redacted]");
  }
  return error;
}
