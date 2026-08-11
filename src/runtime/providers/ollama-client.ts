import type { PromptClient } from "../client";
import type { PromptRequest, PromptResponse } from "../types";
import {
  ConnectionError,
  NetworkError,
  NotFoundError,
  ServerError,
  TimeoutError,
} from "../errors";
import { withRetry } from "./retry";

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

type OllamaResponseBody = {
  message: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
};
type OllamaErrorBody = { error?: string };

/** HTTP client for local Ollama servers (`/api/chat`). No authentication required. */
export class OllamaClient implements PromptClient {
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(options: OllamaClientOptions = {}) {
    this.baseURL = options.baseURL ?? "http://localhost:11434";
    this.timeout = options.timeout ?? 120_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelay = options.retryDelay ?? 500;
  }

  async complete(request: PromptRequest): Promise<PromptResponse> {
    return withRetry(() => this.doRequest(request), this.maxRetries, this.retryDelay);
  }

  private async doRequest(request: PromptRequest): Promise<PromptResponse> {
    const ollamaOptions: Record<string, unknown> = {};
    if (request.temperature !== undefined) ollamaOptions.temperature = request.temperature;
    if (request.max_tokens !== undefined) ollamaOptions.num_predict = request.max_tokens;

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: false,
    };

    if (Object.keys(ollamaOptions).length > 0) {
      body.options = ollamaOptions;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(`${this.baseURL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const error = err as Error & { code?: string };
      if (error.name === "AbortError") {
        throw new TimeoutError(`Request timed out after ${this.timeout}ms`, "ollama");
      }
      if (
        error.code === "ECONNREFUSED" ||
        error.message?.includes("ECONNREFUSED") ||
        error.message?.includes("Connection refused")
      ) {
        throw new ConnectionError(
          `Could not connect to Ollama at ${this.baseURL}. ` +
            "Make sure the server is running ('ollama serve').",
          "ollama"
        );
      }
      throw new NetworkError(`Network error: ${error.message}`, "ollama");
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        let detail = "";
        try {
          const errorBody = (await response.json()) as OllamaErrorBody;
          detail = errorBody.error ? ` (${errorBody.error})` : "";
        } catch {
          // Ignore JSON parse failures.
        }
        throw new NotFoundError(
          `Model '${request.model}' not found on the Ollama server${detail}. ` +
            `Run 'ollama pull ${request.model}' to download it.`,
          "ollama"
        );
      }
      throw new ServerError(response.status, undefined, "ollama");
    }

    const data = (await response.json()) as OllamaResponseBody;

    return {
      content: data.message.content,
      usage: {
        // Ollama uses prompt_eval_count / eval_count; we normalize to our interface.
        input_tokens: data.prompt_eval_count ?? 0,
        output_tokens: data.eval_count ?? 0,
      },
    };
  }
}
