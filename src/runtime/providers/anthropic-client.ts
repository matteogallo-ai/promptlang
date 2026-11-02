import type { PromptRequest, PromptResponse } from "../types";
import { BaseHttpClient, type HttpRequestSpec } from "./base-http-client";
import { invalidField, isRecord, requireApiKey } from "./response";

/** The `anthropic-version` header sent unless `apiVersion` overrides it. */
export const DEFAULT_ANTHROPIC_VERSION = "2026-10-21";

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
   * Value of the `anthropic-version` header. Defaults to DEFAULT_ANTHROPIC_VERSION. The
   * client never sends `temperature`, whatever the version: 2026-10-21 rejects
   * it on every model, and earlier versions reject a non-default value on
   * Claude 4.7 and later.
   */
  apiVersion?: string;
}

type AnthropicContentBlock = { type: string; text: string };

/** HTTP client for the Anthropic Messages API (`/v1/messages`). */
export class AnthropicClient extends BaseHttpClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly apiVersion: string;

  constructor(options: AnthropicClientOptions) {
    super({
      provider: "anthropic",
      timeout: options.timeout ?? 60_000,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1_000,
    });
    this.apiKey = requireApiKey(options.apiKey, "AnthropicClient", "ANTHROPIC_API_KEY");
    this.baseURL = options.baseURL ?? "https://api.anthropic.com/v1";
    this.apiVersion = options.apiVersion ?? DEFAULT_ANTHROPIC_VERSION;
  }

  protected buildRequest(request: PromptRequest): HttpRequestSpec {
    // Anthropic separates the system prompt from user/assistant messages.
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.filter((m) => m.role !== "system"),
      max_tokens: request.max_tokens ?? 1024,
    };
    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join("\n");
    }
    return {
      url: `${this.baseURL}/messages`,
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
        "content-type": "application/json",
      },
      body,
    };
  }

  protected parseResponse(data: Record<string, unknown>): PromptResponse {
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
      usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens },
    };
  }
}
