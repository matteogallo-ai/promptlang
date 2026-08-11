import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { AnthropicClient } from "./anthropic-client";
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
  model: "claude-opus-4-6",
  messages: [{ role: "user", content: "Hello" }],
};

const OK_BODY = JSON.stringify({
  content: [{ type: "text", text: "Hi there!" }],
  usage: { input_tokens: 5, output_tokens: 3 },
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

describe("AnthropicClient — headers and URL", () => {
  test("sends x-api-key header", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({ apiKey: "sk-ant-test-key" }).complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test-key");
  });

  test("sends anthropic-version header", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({ apiKey: "key" }).complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
  });

  test("sends content-type: application/json header", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({ apiKey: "key" }).complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  test("POST to default URL", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({ apiKey: "key" }).complete(BASE_REQUEST);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  test("respects custom baseURL", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({
      apiKey: "key",
      baseURL: "https://proxy.example.com/v1",
    }).complete(BASE_REQUEST);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://proxy.example.com/v1/messages");
  });

  test("uses method POST", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({ apiKey: "key" }).complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

describe("AnthropicClient — request body", () => {
  test("separates system messages into top-level system field", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({ apiKey: "key" }).complete({
      model: "claude-opus-4-6",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.system).toBe("You are helpful.");
    const messages = body.messages as Array<{ role: string }>;
    expect(messages.every((m) => m.role !== "system")).toBe(true);
  });

  test("concatenates multiple system messages with newline", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({ apiKey: "key" }).complete({
      model: "m",
      messages: [
        { role: "system", content: "Part 1." },
        { role: "system", content: "Part 2." },
        { role: "user", content: "Go" },
      ],
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.system).toBe("Part 1.\nPart 2.");
  });

  test("maps temperature when provided", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({ apiKey: "key" }).complete({
      ...BASE_REQUEST,
      temperature: 0.7,
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.temperature).toBe(0.7);
  });

  test("max_tokens defaults to 1024 when not provided", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({ apiKey: "key" }).complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.max_tokens).toBe(1024);
  });

  test("passes through explicit max_tokens", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new AnthropicClient({ apiKey: "key" }).complete({
      ...BASE_REQUEST,
      max_tokens: 512,
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.max_tokens).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

describe("AnthropicClient — response parsing", () => {
  test("extracts text from content blocks", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    const result = await new AnthropicClient({ apiKey: "key" }).complete(BASE_REQUEST);
    expect(result.content).toBe("Hi there!");
  });

  test("concatenates multiple text content blocks", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: "Hello" },
            { type: "text", text: " World" },
          ],
          usage: { input_tokens: 1, output_tokens: 2 },
        }),
        { status: 200 }
      )
    );
    const result = await new AnthropicClient({ apiKey: "key" }).complete(BASE_REQUEST);
    expect(result.content).toBe("Hello World");
  });

  test("maps usage.input_tokens correctly", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    const result = await new AnthropicClient({ apiKey: "key" }).complete(BASE_REQUEST);
    expect(result.usage?.input_tokens).toBe(5);
  });

  test("maps usage.output_tokens correctly", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    const result = await new AnthropicClient({ apiKey: "key" }).complete(BASE_REQUEST);
    expect(result.usage?.output_tokens).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Error handling and retries
// ---------------------------------------------------------------------------

describe("AnthropicClient — errors and retries", () => {
  test("throws AuthenticationError on 401", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(401, "Invalid API key"));
    const client = new AnthropicClient({ apiKey: "bad", maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(AuthenticationError);
  });

  test("does not retry on 401", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(401, "Invalid key"));
    const client = new AnthropicClient({ apiKey: "bad", maxRetries: 3, retryDelay: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(AuthenticationError);
    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  test("throws RateLimitError after exhausting retries on 429", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(errResponse(429, "Rate limited")));
    const client = new AnthropicClient({ apiKey: "key", maxRetries: 2, retryDelay: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(RateLimitError);
    expect(fetchSpy.mock.calls.length).toBe(3); // 1 initial + 2 retries
  });

  test("retries on 429 and succeeds on subsequent attempt", async () => {
    fetchSpy
      .mockResolvedValueOnce(errResponse(429, "Rate limited"))
      .mockResolvedValueOnce(okResponse());
    const client = new AnthropicClient({ apiKey: "key", maxRetries: 3, retryDelay: 0 });
    const result = await client.complete(BASE_REQUEST);
    expect(result.content).toBe("Hi there!");
    expect(fetchSpy.mock.calls.length).toBe(2);
  });

  test("throws InvalidRequestError on 400", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(400, "Bad request"));
    const client = new AnthropicClient({ apiKey: "key", maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(InvalidRequestError);
  });

  test("does not retry on 400", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(400, "Bad request"));
    const client = new AnthropicClient({ apiKey: "key", maxRetries: 3, retryDelay: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(InvalidRequestError);
    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  test("throws ServerError on 500", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(errResponse(500, "Internal error")));
    const client = new AnthropicClient({ apiKey: "key", maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(ServerError);
  });

  test("retries on 500 and succeeds on subsequent attempt", async () => {
    fetchSpy
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(okResponse());
    const client = new AnthropicClient({ apiKey: "key", maxRetries: 3, retryDelay: 0 });
    const result = await client.complete(BASE_REQUEST);
    expect(result.content).toBe("Hi there!");
    expect(fetchSpy.mock.calls.length).toBe(2);
  });

  test("throws TimeoutError when fetch is aborted", async () => {
    fetchSpy.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted."), { name: "AbortError" })
    );
    const client = new AnthropicClient({ apiKey: "key", maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(TimeoutError);
  });

  test("throws NetworkError on generic network failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Failed to fetch"));
    const client = new AnthropicClient({ apiKey: "key", maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(NetworkError);
  });

  test("AuthenticationError carries provider name", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(401));
    const client = new AnthropicClient({ apiKey: "bad", maxRetries: 0 });
    const err = await client.complete(BASE_REQUEST).catch((e: unknown) => e);
    expect((err as AuthenticationError).provider).toBe("anthropic");
  });
});
