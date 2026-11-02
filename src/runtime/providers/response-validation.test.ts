import { describe, expect, test } from "bun:test";
import { InvalidResponseError } from "../errors";
import type { PromptClient } from "../client";
import type { PromptRequest } from "../types";
import { AnthropicClient } from "./anthropic-client";
import { OllamaClient } from "./ollama-client";
import { OpenAIClient } from "./openai-client";
import { RoutingClient } from "./routing-client";
import { fetchSpy, useFetchSpy } from "../../../tests/support/fetch-spy";

const REQUEST: PromptRequest = { model: "m", messages: [{ role: "user", content: "hi" }] };

useFetchSpy();

function ok(body: string): Response {
  return new Response(body, { status: 200 });
}

describe("multi-provider runtime", () => {
  test("Anthropic, OpenAI and Ollama clients parse a well-formed response", async () => {
    const cases: Array<[PromptClient, unknown]> = [
      [
        new AnthropicClient({ apiKey: "k", maxRetries: 0 }),
        { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 3, output_tokens: 1 } },
      ],
      [
        new OpenAIClient({ apiKey: "k", maxRetries: 0 }),
        {
          choices: [{ message: { content: "ok" } }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        },
      ],
      [
        new OllamaClient({ maxRetries: 0 }),
        { message: { content: "ok" }, prompt_eval_count: 3, eval_count: 1 },
      ],
    ];
    for (const [client, body] of cases) {
      fetchSpy.mockResolvedValueOnce(ok(JSON.stringify(body)));
      expect(await client.complete(REQUEST)).toEqual({
        content: "ok",
        usage: { input_tokens: 3, output_tokens: 1 },
      });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

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
