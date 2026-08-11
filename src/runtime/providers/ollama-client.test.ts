import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { OllamaClient } from "./ollama-client";
import {
  ConnectionError,
  NotFoundError,
  ServerError,
  TimeoutError,
  NetworkError,
} from "../errors";
import type { PromptRequest } from "../types";

const BASE_REQUEST: PromptRequest = {
  model: "llama3",
  messages: [{ role: "user", content: "Hello" }],
};

const OK_BODY = JSON.stringify({
  message: { content: "Hello from Llama!" },
  prompt_eval_count: 12,
  eval_count: 7,
});

function okResponse(body = OK_BODY): Response {
  return new Response(body, { status: 200 });
}

function errResponse(status: number, error = "An error occurred"): Response {
  return new Response(JSON.stringify({ error }), { status });
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

describe("OllamaClient — headers and URL", () => {
  test("POST to default URL", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OllamaClient().complete(BASE_REQUEST);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/chat");
  });

  test("respects custom baseURL", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OllamaClient({ baseURL: "http://gpu-server:11434" }).complete(BASE_REQUEST);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://gpu-server:11434/api/chat");
  });

  test("sends no Authorization header", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OllamaClient().complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["x-api-key"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

describe("OllamaClient — request body", () => {
  test("sets stream: false", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OllamaClient().complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.stream).toBe(false);
  });

  test("sends temperature in options.temperature", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OllamaClient().complete({ ...BASE_REQUEST, temperature: 0.8 });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect((body.options as Record<string, unknown>)?.temperature).toBe(0.8);
  });

  test("sends max_tokens as options.num_predict", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OllamaClient().complete({ ...BASE_REQUEST, max_tokens: 200 });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect((body.options as Record<string, unknown>)?.num_predict).toBe(200);
  });

  test("omits options field when no temperature or max_tokens", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OllamaClient().complete(BASE_REQUEST);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.options).toBeUndefined();
  });

  test("passes messages array unchanged", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    await new OllamaClient().complete({
      model: "llama3",
      messages: [
        { role: "system", content: "You are a pirate." },
        { role: "user", content: "Hello" },
      ],
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    const messages = body.messages as Array<{ role: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
  });
});

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

describe("OllamaClient — response parsing", () => {
  test("extracts content from message.content", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    const result = await new OllamaClient().complete(BASE_REQUEST);
    expect(result.content).toBe("Hello from Llama!");
  });

  test("maps prompt_eval_count to input_tokens", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    const result = await new OllamaClient().complete(BASE_REQUEST);
    expect(result.usage?.input_tokens).toBe(12);
  });

  test("maps eval_count to output_tokens", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse());
    const result = await new OllamaClient().complete(BASE_REQUEST);
    expect(result.usage?.output_tokens).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Error handling and retries
// ---------------------------------------------------------------------------

describe("OllamaClient — errors and retries", () => {
  test("throws ConnectionError on ECONNREFUSED", async () => {
    fetchSpy.mockRejectedValueOnce(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), {
        code: "ECONNREFUSED",
      })
    );
    const client = new OllamaClient({ maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(ConnectionError);
  });

  test("ConnectionError message mentions 'ollama serve'", async () => {
    fetchSpy.mockRejectedValueOnce(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), {
        code: "ECONNREFUSED",
      })
    );
    const client = new OllamaClient({ maxRetries: 0 });
    const err = await client.complete(BASE_REQUEST).catch((e: unknown) => e);
    expect((err as ConnectionError).message).toContain("ollama serve");
  });

  test("throws NotFoundError on 404", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(404, "model 'llama3' not found"));
    const client = new OllamaClient({ maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("NotFoundError message contains model name and pull command", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(404, "model 'llama3' not found"));
    const client = new OllamaClient({ maxRetries: 0 });
    const err = await client.complete(BASE_REQUEST).catch((e: unknown) => e);
    expect((err as NotFoundError).message).toContain("llama3");
    expect((err as NotFoundError).message).toContain("ollama pull");
  });

  test("does not retry on NotFoundError (404)", async () => {
    fetchSpy.mockResolvedValueOnce(errResponse(404, "not found"));
    const client = new OllamaClient({ maxRetries: 3, retryDelay: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(NotFoundError);
    expect(fetchSpy.mock.calls.length).toBe(1);
  });

  test("throws ServerError on 500", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(errResponse(500)));
    const client = new OllamaClient({ maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(ServerError);
  });

  test("retries on 500 and succeeds on subsequent attempt", async () => {
    fetchSpy
      .mockResolvedValueOnce(errResponse(500))
      .mockResolvedValueOnce(okResponse());
    const client = new OllamaClient({ maxRetries: 2, retryDelay: 0 });
    const result = await client.complete(BASE_REQUEST);
    expect(result.content).toBe("Hello from Llama!");
    expect(fetchSpy.mock.calls.length).toBe(2);
  });

  test("throws TimeoutError when fetch is aborted", async () => {
    fetchSpy.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted."), { name: "AbortError" })
    );
    const client = new OllamaClient({ maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(TimeoutError);
  });

  test("throws NetworkError on generic network failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Failed to fetch"));
    const client = new OllamaClient({ maxRetries: 0 });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(NetworkError);
  });
});
