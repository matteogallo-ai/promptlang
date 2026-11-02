import type { PromptClient } from "../client";
import type { PromptRequest, PromptResponse } from "../types";
import {
  AuthenticationError,
  InvalidRequestError,
  NetworkError,
  type PromptClientError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from "../errors";
import { readJsonObject } from "./response";
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
        return new RateLimitError(message, this.provider);
      case 400:
      case 404:
        return new InvalidRequestError(message, this.provider);
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
      throw this.networkError(error);
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) throw await this.errorFor(response, request);
    return this.parseResponse(await readJsonObject(response, this.provider), request);
  }
}
