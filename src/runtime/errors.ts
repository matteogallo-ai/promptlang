/** Base class for all PromptLang runtime errors. */
export class PromptClientError extends Error {
  readonly provider?: string;

  constructor(message: string, provider?: string) {
    super(message);
    this.name = "PromptClientError";
    this.provider = provider;
  }
}

/** Thrown when the API key is invalid or missing. Never retried. */
export class AuthenticationError extends PromptClientError {
  constructor(
    message = "Authentication failed. Check that your API key is valid.",
    provider?: string
  ) {
    super(message, provider);
    this.name = "AuthenticationError";
  }
}

/** Thrown when the provider returns HTTP 429 (too many requests). */
export class RateLimitError extends PromptClientError {
  /** Seconds to wait before retrying, if provided by the response headers. */
  retryAfter?: number;

  constructor(message = "Rate limit exceeded.", provider?: string, retryAfter?: number) {
    super(message, provider);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/** Thrown on 5xx responses from the provider. */
export class ServerError extends PromptClientError {
  readonly statusCode: number;

  constructor(statusCode: number, message?: string, provider?: string) {
    super(
      message ?? `Server error (${statusCode}). The provider may be temporarily unavailable.`,
      provider
    );
    this.name = "ServerError";
    this.statusCode = statusCode;
  }
}

/** Thrown on 400 responses. Never retried. */
export class InvalidRequestError extends PromptClientError {
  constructor(
    message = "Invalid request. Check the model name and request parameters.",
    provider?: string
  ) {
    super(message, provider);
    this.name = "InvalidRequestError";
  }
}

/** Thrown when a request exceeds the configured timeout. */
export class TimeoutError extends PromptClientError {
  constructor(message = "Request timed out.", provider?: string) {
    super(message, provider);
    this.name = "TimeoutError";
  }
}

/** Thrown on low-level network failures (excluding timeout and connection refused). */
export class NetworkError extends PromptClientError {
  constructor(message = "A network error occurred.", provider?: string) {
    super(message, provider);
    this.name = "NetworkError";
  }
}

/** Thrown when a local server (e.g. Ollama) refuses the connection. */
export class ConnectionError extends PromptClientError {
  constructor(
    message = "Connection refused. Make sure the local server is running.",
    provider?: string
  ) {
    super(message, provider);
    this.name = "ConnectionError";
  }
}

/**
 * Thrown on 404 responses that indicate a missing resource (e.g. a model not yet
 * downloaded in Ollama). Never retried.
 */
export class NotFoundError extends PromptClientError {
  constructor(message = "Resource not found.", provider?: string) {
    super(message, provider);
    this.name = "NotFoundError";
  }
}

/** Thrown by RoutingClient when every configured provider fails. */
export class AllProvidersFailedError extends PromptClientError {
  /** Errors thrown by each provider, in the order they were tried. */
  readonly errors: Error[];

  constructor(errors: Error[]) {
    super(
      `All ${errors.length} provider${errors.length === 1 ? "" : "s"} failed: ${errors.map((e) => e.message).join("; ")}`
    );
    this.name = "AllProvidersFailedError";
    this.errors = errors;
  }
}
