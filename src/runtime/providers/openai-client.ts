import type { PromptRequest, PromptResponse } from "../types";
import { BaseHttpClient, type HttpRequestSpec } from "./base-http-client";
import {
  type StopKind,
  invalidField,
  isRecord,
  requireApiKey,
  requireCompleteAnswer,
} from "./response";

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

/** `stop` is a finished answer; a body with no `finish_reason` is judged by its text alone. */
function openaiStop(raw: string): StopKind {
  if (raw === "" || raw === "stop") return "complete";
  if (raw === "length") return "max_tokens";
  if (raw === "content_filter" || raw === "refusal") return "refusal";
  return "unexpected_stop";
}

/** HTTP client for the OpenAI Chat Completions API (`/v1/chat/completions`). */
export class OpenAIClient extends BaseHttpClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly organization?: string;

  constructor(options: OpenAIClientOptions) {
    super({
      provider: "openai",
      timeout: options.timeout ?? 60_000,
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 1_000,
    });
    this.apiKey = requireApiKey(options.apiKey, "OpenAIClient", "OPENAI_API_KEY");
    this.baseURL = options.baseURL ?? "https://api.openai.com/v1";
    this.organization = options.organization;
  }

  protected buildRequest(request: PromptRequest): HttpRequestSpec {
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
    if (this.organization) headers["OpenAI-Organization"] = this.organization;
    return { url: `${this.baseURL}/chat/completions`, headers, body };
  }

  protected parseResponse(data: Record<string, unknown>, request: PromptRequest): PromptResponse {
    const choice = Array.isArray(data.choices) ? data.choices[0] : undefined;
    if (!isRecord(choice) || !isRecord(choice.message))
      invalidField("openai", "choices[0].message");
    const message = (choice as { message: Record<string, unknown> }).message;
    // `content` is null when the model answers with a refusal or tool call only.
    if (typeof message.content !== "string" && message.content !== null) {
      invalidField("openai", "choices[0].message.content");
    }
    const content = (message.content as string | null) ?? "";
    const usage = data.usage;
    if (
      !isRecord(usage) ||
      typeof usage.prompt_tokens !== "number" ||
      typeof usage.completion_tokens !== "number"
    ) {
      invalidField("openai", "usage");
    }
    const refused = typeof message.refusal === "string" && message.refusal !== "";
    const finish = (choice as Record<string, unknown>).finish_reason;
    const raw = refused ? "refusal" : typeof finish === "string" ? finish : "";
    requireCompleteAnswer("openai", openaiStop(raw), raw, content, request.max_tokens);
    return {
      content,
      usage: {
        // OpenAI uses prompt_tokens / completion_tokens; we normalize to our interface.
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
      },
    };
  }
}
