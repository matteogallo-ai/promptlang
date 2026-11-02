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
import { invalidField, isRecord, readJsonObject, requireApiKey } from "./response";
import { withRetry } from "./retry";

/** Options for configuring the AnthropicClient. */
export interface AnthropicClientOptions {
  /** Anthropic API key (required). Never hard-coded — use an environment variable. */
  apiKey: string;
  /** Base URL for the Anthropic API. Defaults to "https://api.anthropic.com/v1". */
  baseURL?: string;
  /** Request timeout in milliseconds. Defaults to 60 000. */
  timeout?: number;
  /** Maximum number of retry attempts on retryable errors. Defaults to 3. */
  maxRetries?: number;
  /** Base retry delay in ms, doubled on each attempt (exponential backoff). Defaults to 1 000. */
  retryDelay?: number;
  /**
   * Value of the `anthropic-version` header. Defaults to "2026-10-21". The
   * client never sends `temperature`, whatever the version: 2026-10-21 rejects
   * it on every model, and earlier versions reject a non-default value on
   * Claude 4.7 and later.
   */
  apiVersion?: string;
}

type AnthropicContentBlock = { type: string; text: string };
type AnthropicErrorBody = { error?: { message?: string } };

/** HTTP client for the Anthropic Messages API (`/v1/messages`). */
export class AnthropicClient implements PromptClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;
  private readonly apiVersion: string;

  constructor(options: AnthropicClientOptions) {
    this.apiKey = requireApiKey(options.apiKey, "AnthropicClient", "ANTHROPIC_API_KEY");
    this.baseURL = options.baseURL ?? "https://api.anthropic.com/v1";
    this.timeout = options.timeout ?? 60_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelay = options.retryDelay ?? 1_000;
    this.apiVersion = options.apiVersion ?? "2026-10-21";
  }

  async complete(request: PromptRequest): Promise<PromptResponse> {
    return withRetry(() => this.doRequest(request), this.maxRetries, this.retryDelay);
  }

  private async doRequest(request: PromptRequest): Promise<PromptResponse> {
    // Anthropic separates the system prompt from user/assistant messages.
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const chatMessages = request.messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: request.model,
      messages: chatMessages,
      max_tokens: request.max_tokens ?? 1024,
    };

    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join("\n");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": this.apiVersion,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const error = err as Error;
      if (error.name === "AbortError") {
        throw new TimeoutError(`Request timed out after ${this.timeout}ms`, "anthropic");
      }
      throw new NetworkError(`Network error: ${error.message}`, "anthropic");
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage: string | undefined;
      try {
        const errorBody = (await response.json()) as AnthropicErrorBody;
        errorMessage = errorBody?.error?.message;
      } catch {
        // Ignore JSON parse failures on error responses.
      }

      switch (response.status) {
        case 401:
          throw new AuthenticationError(errorMessage, "anthropic");
        case 429:
          throw new RateLimitError(errorMessage, "anthropic");
        case 400:
        case 404:
          throw new InvalidRequestError(errorMessage, "anthropic");
        default:
          throw new ServerError(response.status, errorMessage, "anthropic");
      }
    }

    const data = await readJsonObject(response, "anthropic");
    if (!Array.isArray(data.content)) invalidField("anthropic", "content");
    const usage = data.usage;
    if (
      !isRecord(usage) ||
      typeof usage.input_tokens !== "number" ||
      typeof usage.output_tokens !== "number"
    ) {
      invalidField("anthropic", "usage");
    }
    const text = (data.content as unknown[])
      .filter(
        (block): block is AnthropicContentBlock =>
          isRecord(block) && block.type === "text" && typeof block.text === "string"
      )
      .map((block) => block.text)
      .join("");

    return {
      content: text,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
    };
  }
}
