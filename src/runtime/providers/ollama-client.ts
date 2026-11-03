import type { PromptRequest, PromptResponse } from "../types";
import {
  ConnectionError,
  NetworkError,
  NotFoundError,
  type PromptClientError,
  ServerError,
} from "../errors";
import { BaseHttpClient, type HttpRequestSpec } from "./base-http-client";
import { invalidField, isRecord, requireCompleteAnswer } from "./response";

/** Options for configuring the OllamaClient. */
export interface OllamaClientOptions {
  /**
   * Base URL of the Ollama server. Defaults to "http://localhost:11434".
   * Override when running Ollama on a custom host or port.
   */
  baseURL?: string;
  /**
   * Request timeout in milliseconds. Defaults to 120 000 (2 min) — local models
   * are typically slower than cloud APIs.
   */
  timeout?: number;
  /** Maximum number of retry attempts on retryable errors. Defaults to 2. */
  maxRetries?: number;
  /** Base retry delay in ms, doubled on each attempt. Defaults to 500. */
  retryDelay?: number;
}

type OllamaErrorBody = { error?: string };

/** HTTP client for local Ollama servers (`/api/chat`). No authentication required. */
export class OllamaClient extends BaseHttpClient {
  private readonly baseURL: string;

  constructor(options: OllamaClientOptions = {}) {
    super({
      provider: "ollama",
      timeout: options.timeout ?? 120_000,
      maxRetries: options.maxRetries ?? 2,
      retryDelay: options.retryDelay ?? 500,
    });
    this.baseURL = options.baseURL ?? "http://localhost:11434";
  }

  protected buildRequest(request: PromptRequest): HttpRequestSpec {
    const ollamaOptions: Record<string, unknown> = {};
    if (request.temperature !== undefined) ollamaOptions.temperature = request.temperature;
    if (request.max_tokens !== undefined) ollamaOptions.num_predict = request.max_tokens;
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: false,
    };
    if (Object.keys(ollamaOptions).length > 0) body.options = ollamaOptions;
    return {
      url: `${this.baseURL}/api/chat`,
      headers: { "content-type": "application/json" },
      body,
    };
  }

  /** A local server that is not running is a ConnectionError, with the fix in the message. */
  protected networkError(error: Error & { code?: string }): PromptClientError {
    if (
      error.code === "ECONNREFUSED" ||
      error.message?.includes("ECONNREFUSED") ||
      error.message?.includes("Connection refused")
    ) {
      return new ConnectionError(
        `Could not connect to Ollama at ${this.baseURL}. ` +
          "Make sure the server is running ('ollama serve').",
        "ollama"
      );
    }
    return new NetworkError(`Network error: ${error.message}`, "ollama");
  }

  /** Ollama answers 404 for a model it has not pulled; every other status is a server error. */
  protected async errorFor(response: Response, request: PromptRequest): Promise<PromptClientError> {
    if (response.status !== 404) return new ServerError(response.status, undefined, "ollama");
    let detail = "";
    try {
      const errorBody = (await response.json()) as OllamaErrorBody;
      detail = errorBody.error ? ` (${errorBody.error})` : "";
    } catch {
      // A non-JSON 404 body still names the model and the fix.
    }
    return new NotFoundError(
      `Model '${request.model}' not found on the Ollama server${detail}. ` +
        `Run 'ollama pull ${request.model}' to download it.`,
      "ollama"
    );
  }

  protected parseResponse(data: Record<string, unknown>, request: PromptRequest): PromptResponse {
    if (!isRecord(data.message) || typeof data.message.content !== "string") {
      invalidField("ollama", "message.content");
    }
    const content = (data.message as { content: string }).content;
    // Ollama uses prompt_eval_count / eval_count; we normalize to our interface.
    const counts = {
      input_tokens: typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : 0,
      output_tokens: typeof data.eval_count === "number" ? data.eval_count : 0,
    };
    // Ollama reports `length` when num_predict cut generation; older servers omit done_reason.
    const raw = typeof data.done_reason === "string" ? data.done_reason : "";
    requireCompleteAnswer(
      "ollama",
      raw === "length" ? "max_tokens" : "complete",
      raw,
      content,
      request.max_tokens,
      counts
    );
    return { content, usage: counts };
  }
}
