import type { PromptClient } from "../client";
import type { PromptRequest, PromptResponse } from "../types";
import {
  AuthenticationError,
  InvalidRequestError,
  NetworkError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from "../errors";
import { withRetry } from "./retry";

/** Options for configuring the OpenAIClient. */
export interface OpenAIClientOptions {
  /** OpenAI API key (required). Never hard-coded — use an environment variable. */
  apiKey: string;
  /** Base URL for the OpenAI API. Defaults to "https://api.openai.com/v1". */
  baseURL?: string;
  /** Request timeout in milliseconds. Defaults to 60 000. */
  timeout?: number;
  /** Maximum number of retry attempts on retryable errors. Defaults to 3. */
  maxRetries?: number;
  /** Base retry delay in ms, doubled on each attempt. Defaults to 1 000. */
  retryDelay?: number;
  /** Optional OpenAI organization ID sent in the `OpenAI-Organization` header. */
  organization?: string;
}

type OpenAIResponseBody = {
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number };
};
type OpenAIErrorBody = { error?: { message?: string } };

/** HTTP client for the OpenAI Chat Completions API (`/v1/chat/completions`). */
export class OpenAIClient implements PromptClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly organization?: string;

  constructor(options: OpenAIClientOptions) {
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL ?? "https://api.openai.com/v1";
    this.timeout = options.timeout ?? 60_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelay = options.retryDelay ?? 1_000;
    this.organization = options.organization;
  }

  async complete(request: PromptRequest): Promise<PromptResponse> {
    return withRetry(() => this.doRequest(request), this.maxRetries, this.retryDelay);
  }

  private async doRequest(request: PromptRequest): Promise<PromptResponse> {
    // OpenAI supports system/user/assistant roles natively in the messages array.
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
    };

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };

    if (this.organization) {
      headers["OpenAI-Organization"] = this.organization;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const error = err as Error;
      if (error.name === "AbortError") {
        throw new TimeoutError(`Request timed out after ${this.timeout}ms`, "openai");
      }
      throw new NetworkError(`Network error: ${error.message}`, "openai");
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage: string | undefined;
      try {
        const errorBody = (await response.json()) as OpenAIErrorBody;
        errorMessage = errorBody?.error?.message;
      } catch {
        // Ignore JSON parse failures on error responses.
      }

      switch (response.status) {
        case 401:
          throw new AuthenticationError(errorMessage, "openai");
        case 429:
          throw new RateLimitError(errorMessage, "openai");
        case 400:
        case 404:
          throw new InvalidRequestError(errorMessage, "openai");
        default:
          throw new ServerError(response.status, errorMessage, "openai");
      }
    }

    const data = (await response.json()) as OpenAIResponseBody;
    const content = data.choices[0]?.message.content ?? "";

    return {
      content,
      usage: {
        // OpenAI uses prompt_tokens / completion_tokens; we normalize to our interface.
        input_tokens: data.usage.prompt_tokens,
        output_tokens: data.usage.completion_tokens,
      },
    };
  }
}
