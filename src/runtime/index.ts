// Core types and interfaces
export type { PromptRequest, PromptResponse } from "./types";
export type { PromptClient } from "./client";

// MockClient — for local development and unit tests
export { MockClient } from "./client";

// Error hierarchy
export {
  PromptClientError,
  AuthenticationError,
  RateLimitError,
  ServerError,
  InvalidRequestError,
  TimeoutError,
  NetworkError,
  ConnectionError,
  NotFoundError,
  AllProvidersFailedError,
} from "./errors";

// Provider clients
export { AnthropicClient } from "./providers/anthropic-client";
export { OpenAIClient } from "./providers/openai-client";
export { OllamaClient } from "./providers/ollama-client";
export { RoutingClient } from "./providers/routing-client";

// Option types
export type { AnthropicClientOptions } from "./providers/anthropic-client";
export type { OpenAIClientOptions } from "./providers/openai-client";
export type { OllamaClientOptions } from "./providers/ollama-client";
export type { RoutingClientOptions } from "./providers/routing-client";
