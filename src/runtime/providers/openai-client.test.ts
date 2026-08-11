import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { OpenAIClient } from "./openai-client";
import {
  AuthenticationError,
  RateLimitError,
  ServerError,
  InvalidRequestError,
  TimeoutError,
  NetworkError,
} from "../errors";
import type { PromptRequest } from "../types";

const BASE_REQUEST: PromptRequest = {
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
};

const OK_BODY = JSON.stringify({
  choices: [{ message: { content: "Hello from GPT!" } }],
  usage: { prompt_tokens: 8, completion_tokens: 4 },
});

function okResponse(body = OK_BODY): Response {
  return new Response(body, { status: 200 });
}

function errResponse(status: number, message = "An error occurred"): Response {
  return new Response(JSON.stringify({ error: { message } }), { status });
}

// ---------------------------------------------------------------------------
// Spy setup
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fetchSpy: any;

beforeEach(() => {
  fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("fetch called without a mock — call fetchSpy.mockResolvedValueOnce in the test")
  );
});

afterEach(() => {
  fetchSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Headers and URL
// ---------------------------------------------------------------------------

describe("OpenAIClient — headers and URL", () => {
  test("sends Authorization Bearer header", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OpenAIClient({ apiKey: "sk-test-key" }).complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer sk-test-key"
    );
  });

  test("sends content-type: application/json header", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OpenAIClient({ apiKey: "key" }).complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  test("POST to default URL", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OpenAIClient({ apiKey: "key" }).complete(BASE_REQUEST);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
  });

  test("respects custom baseURL", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OpenAIClient({
      apiKey: "key",
      baseURL: "https://my-proxy.com/v1",
    }).complete(BASE_REQUEST);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://my-proxy.com/v1/chat/completions");
  });

  test("sends OpenAI-Organization header when provided", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OpenAIClient({ apiKey: "key", organization: "org-abc123" }).complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["OpenAI-Organization"]).toBe("org-abc123");
  });

  test("omits OpenAI-Organization header when not provided", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OpenAIClient({ apiKey: "key" }).complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["OpenAI-Organization"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

describe("OpenAIClient — request body", () => {
  test("passes messages array through unchanged (including system role)", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    const req: PromptRequest = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hi" },
      ],
    };
    await new OpenAIClient({ apiKey: "key" }).complete(req);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    const messages = body.messages as Array<{ role: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
  });

  test("maps temperature when provided", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OpenAIClient({ apiKey: "key" }).complete({ ...BASE_REQUEST, temperature: 0.5 });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.temperature).toBe(0.5);
  });

  test("maps max_tokens when provided", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OpenAIClient({ apiKey: "key" }).complete({ ...BASE_REQUEST, max_tokens: 256 });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.max_tokens).toBe(256);
  });
});

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

describe("OpenAIClient — response parsing", () => {
  test("extracts content from choices[0].message.content", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    const result = await new OpenAIClient({ apiKey: "key" }).complete(BASE_REQUEST);
    expect(result.content).toBe("Hello from GPT!");
  });

  test("maps prompt_tokens to input_tokens", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    const result = await new OpenAIClient({ apiKey: "key" }).complete(BASE_REQUEST);
    expect(result.usage?.input_tokens).toBe(8);
  });

  test("maps completion_tokens to output_tokens", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    const result = await new OpenAIClient({ apiKey: "key" }).complete(BASE_REQUEST);
    expect(result.usage?.output_tokens).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Error handling and retries
// ---------------------------------------------------------------------------

describe("OpenAIClient — errors and retries", () => {
  test("throws AuthenticationError on 401", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(401, "Incorrect API key"));
    const client = new OpenAIClient({ apiKey: "bad", maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(AuthenticationError);
  });

  test("does not retry on 401", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(401));
    const client = new OpenAIClient({ apiKey: "bad", maxRetries: 3, retryDelay: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(AuthenticationError);
    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  test("throws RateLimitError after exhausting retries on 429", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(errResponse(429, "Rate limited")));
    const client = new OpenAIClient({ apiKey: "key", maxRetries: 2, retryDelay: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchSpy.mock.calls.length).toBe(3);
  });

  test("retries on 429 and succeeds on subsequent attempt", async () => {
    fetchSpy
      .mockResolvedValueOnce(errResponse(429))
      .mockResolvedValueOnce(okResponse());
    const client = new OpenAIClient({ apiKey: "key", maxRetries: 3, retryDelay: 0 });
    const result = await client.complete(BASE_REQUEST);
    expect(result.content).toBe("Hello from GPT!");
    expect(fetchSpy.mock.calls.length).toBe(2);
  });

  test("throws InvalidRequestError on 400", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(400, "Invalid model"));
    const client = new OpenAIClient({ apiKey: "key", maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(InvalidRequestError);
  });

  test("throws ServerError on 503", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(errResponse(503, "Service unavailable")));
    const client = new OpenAIClient({ apiKey: "key", maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(ServerError);
  });

  test("throws TimeoutError when fetch is aborted", async () => {
    fetchSpy.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted."), { name: "AbortError" })
    );
    const client = new OpenAIClient({ apiKey: "key", maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(TimeoutError);
  });

  test("throws NetworkError on generic network failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Failed to fetch"));
    const client = new OpenAIClient({ apiKey: "key", maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(NetworkError);
  });

  test("AuthenticationError carries provider name 'openai'", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(401));
    const client = new OpenAIClient({ apiKey: "bad", maxRetries: 0 });
    const err = await client.complete(BASE_REQUEST).catch((e: unknown) => e);
    expect((err as AuthenticationError).provider).toBe("openai");
  });
});
