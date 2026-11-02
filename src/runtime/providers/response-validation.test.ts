import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { InvalidResponseError } from "../errors";
import type { PromptClient } from "../client";
import type { PromptRequest } from "../types";
import { AnthropicClient } from "./anthropic-client";
import { OllamaClient } from "./ollama-client";
import { OpenAIClient } from "./openai-client";
import { RoutingClient } from "./routing-client";

const REQUEST: PromptRequest = { model: "m", messages: [{ role: "user", content: "hi" }] };

// biome-ignore lint/suspicious/noExplicitAny: Bun types fetch with a static preconnect member, so typed mock implementations do not satisfy it; this spy only feeds canned Responses.
let fetchSpy: any;

beforeEach(() => {
  fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("unmocked fetch"));
});

afterEach(() => {
  fetchSpy.mockRestore();
});

function ok(body: string): Response {
  return new Response(body, { status: 200 });
}

describe("API key validation", () => {
  for (const [name, make] of [
    ["AnthropicClient", (apiKey: string) => new AnthropicClient({ apiKey })],
    ["OpenAIClient", (apiKey: string) => new OpenAIClient({ apiKey })],
  ] as const) {
    test(`${name} rejects an empty or whitespace API key at construction`, () => {
      expect(() => make("")).toThrow(/apiKey/);
      expect(() => make("   ")).toThrow(/apiKey/);
    });

    test(`${name} rejects an undefined API key (unset environment variable)`, () => {
      expect(() => make(undefined as unknown as string)).toThrow(/apiKey/);
    });
  }
});

describe("InvalidResponseError on unexpected 200 bodies", () => {
  const cases: Array<[string, () => PromptClient, string[]]> = [
    [
      "AnthropicClient",
      () => new AnthropicClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      ["{}", JSON.stringify({ content: "text", usage: {} }), JSON.stringify({ content: [] })],
    ],
    [
      "OpenAIClient",
      () => new OpenAIClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      ["{}", JSON.stringify({ choices: [{ message: {} }], usage: {} })],
    ],
    [
      "OllamaClient",
      () => new OllamaClient({ maxRetries: 3, retryDelay: 0 }),
      ["{}", JSON.stringify({ message: {} })],
    ],
  ];

  for (const [name, make, bodies] of cases) {
    for (const body of bodies) {
      test(`${name}: ${body} → InvalidResponseError, not retried`, async () => {
        fetchSpy.mockResolvedValue(ok(body));
        const error = await make()
          .complete(REQUEST)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(InvalidResponseError);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
    }

    test(`${name}: a non-JSON 200 body → InvalidResponseError`, async () => {
      fetchSpy.mockResolvedValue(ok("<html>gateway</html>"));
      const error = await make()
        .complete(REQUEST)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidResponseError);
    });
  }

  test("RoutingClient falls back when the primary returns a malformed body", async () => {
    fetchSpy.mockResolvedValueOnce(ok("{}")).mockResolvedValueOnce(
      ok(
        JSON.stringify({
          choices: [{ message: { content: "fallback" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      )
    );
    const client = new RoutingClient({
      primary: new AnthropicClient({ apiKey: "k", maxRetries: 0 }),
      fallbacks: [new OpenAIClient({ apiKey: "k", maxRetries: 0 })],
    });
    expect((await client.complete(REQUEST)).content).toBe("fallback");
  });
});
