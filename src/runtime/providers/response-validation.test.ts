import { describe, expect, test } from "bun:test";
import { IncompleteResponseError, InvalidResponseError } from "../errors";
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

describe("IncompleteResponseError on a well-formed 200 that is not a complete answer", () => {
  const anthropic = (body: Record<string, unknown>) =>
    JSON.stringify({ usage: { input_tokens: 3, output_tokens: 1 }, ...body });
  const openai = (choice: Record<string, unknown>) =>
    JSON.stringify({ choices: [choice], usage: { prompt_tokens: 3, completion_tokens: 1 } });
  const ollama = (body: Record<string, unknown>) =>
    JSON.stringify({ prompt_eval_count: 3, eval_count: 1, ...body });

  const cases: Array<[string, () => PromptClient, string, IncompleteResponseError["reason"]]> = [
    // Thinking models can spend the whole budget before the first text block.
    [
      "Anthropic max_tokens with thinking only",
      () => new AnthropicClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      anthropic({ content: [{ type: "thinking", thinking: "..." }], stop_reason: "max_tokens" }),
      "max_tokens",
    ],
    [
      "Anthropic max_tokens with truncated text",
      () => new AnthropicClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      anthropic({ content: [{ type: "text", text: '{"label": "bu' }], stop_reason: "max_tokens" }),
      "max_tokens",
    ],
    [
      "Anthropic refusal",
      () => new AnthropicClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      anthropic({ content: [], stop_reason: "refusal" }),
      "refusal",
    ],
    [
      "Anthropic pause_turn",
      () => new AnthropicClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      anthropic({ content: [{ type: "text", text: "partial" }], stop_reason: "pause_turn" }),
      "unexpected_stop",
    ],
    [
      "Anthropic end_turn with no text",
      () => new AnthropicClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      anthropic({ content: [], stop_reason: "end_turn" }),
      "empty",
    ],
    [
      "OpenAI length",
      () => new OpenAIClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      openai({ message: { content: "trunc" }, finish_reason: "length" }),
      "max_tokens",
    ],
    [
      "OpenAI content_filter",
      () => new OpenAIClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      openai({ message: { content: null }, finish_reason: "content_filter" }),
      "refusal",
    ],
    [
      "OpenAI message.refusal",
      () => new OpenAIClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      openai({ message: { content: null, refusal: "I can't help." }, finish_reason: "stop" }),
      "refusal",
    ],
    [
      "OpenAI null content",
      () => new OpenAIClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      openai({ message: { content: null }, finish_reason: "stop" }),
      "empty",
    ],
    [
      "Anthropic model_context_window_exceeded",
      () => new AnthropicClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      anthropic({
        content: [{ type: "text", text: "partial" }],
        stop_reason: "model_context_window_exceeded",
      }),
      "unexpected_stop",
    ],
    [
      "Anthropic whitespace-only text",
      () => new AnthropicClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      anthropic({ content: [{ type: "text", text: " \n " }], stop_reason: "end_turn" }),
      "empty",
    ],
    [
      "OpenAI tool_calls",
      () => new OpenAIClient({ apiKey: "k", maxRetries: 3, retryDelay: 0 }),
      openai({ message: { content: null }, finish_reason: "tool_calls" }),
      "unexpected_stop",
    ],
    [
      "Ollama length",
      () => new OllamaClient({ maxRetries: 3, retryDelay: 0 }),
      ollama({ message: { content: "trunc" }, done_reason: "length" }),
      "max_tokens",
    ],
    [
      "Ollama empty content",
      () => new OllamaClient({ maxRetries: 3, retryDelay: 0 }),
      ollama({ message: { content: "" }, done_reason: "stop" }),
      "empty",
    ],
  ];

  for (const [name, make, body, reason] of cases) {
    test(`${name} → IncompleteResponseError(${reason}), not retried`, async () => {
      fetchSpy.mockResolvedValue(ok(body));
      const error = await make()
        .complete(REQUEST)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IncompleteResponseError);
      expect((error as IncompleteResponseError).reason).toBe(reason);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  }

  test("the max_tokens message names the annotation to raise", async () => {
    fetchSpy.mockResolvedValue(
      ok(anthropic({ content: [{ type: "text", text: "x" }], stop_reason: "max_tokens" }))
    );
    const error = await new AnthropicClient({ apiKey: "k", maxRetries: 0 })
      .complete({ ...REQUEST, max_tokens: 64 })
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      "anthropic stopped at the output limit (max_tokens 64) before finishing the answer; raise @max_tokens on the prompt"
    );
  });

  test("without @max_tokens the message names the limit that applied", async () => {
    fetchSpy.mockResolvedValueOnce(
      ok(anthropic({ content: [{ type: "text", text: "x" }], stop_reason: "max_tokens" }))
    );
    const a = await new AnthropicClient({ apiKey: "k", maxRetries: 0 })
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect((a as Error).message).toContain("(max_tokens 1024)");
    fetchSpy.mockResolvedValueOnce(
      ok(openai({ message: { content: "x" }, finish_reason: "length" }))
    );
    const o = await new OpenAIClient({ apiKey: "k", maxRetries: 0 })
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect((o as Error).message).toContain("(the provider default)");
  });

  // The message quotes what decided, so it can be looked up in the provider's docs.
  test("an OpenAI refusal names the field that carried it, not a stop value it did not send", async () => {
    fetchSpy.mockResolvedValueOnce(
      ok(openai({ message: { content: null, refusal: "no" }, finish_reason: "stop" }))
    );
    const error = await new OpenAIClient({ apiKey: "k", maxRetries: 0 })
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe("openai refused to answer (`message.refusal`)");
  });

  // A cut answer is billed in full; callers that meter spend must still see it.
  test("the error carries the usage the provider reported", async () => {
    fetchSpy.mockResolvedValueOnce(
      ok(anthropic({ content: [{ type: "text", text: "x" }], stop_reason: "max_tokens" }))
    );
    const error = await new AnthropicClient({ apiKey: "k", maxRetries: 0 })
      .complete(REQUEST)
      .catch((e: unknown) => e);
    expect((error as IncompleteResponseError).usage).toEqual({ input_tokens: 3, output_tokens: 1 });
  });

  test("a normal stop still returns the text", async () => {
    const successes: Array<[PromptClient, string]> = [
      ...["end_turn", "stop_sequence"].map((stop_reason): [PromptClient, string] => [
        new AnthropicClient({ apiKey: "k", maxRetries: 0 }),
        anthropic({ content: [{ type: "text", text: "ok" }], stop_reason }),
      ]),
      [
        new OpenAIClient({ apiKey: "k", maxRetries: 0 }),
        openai({ message: { content: "ok" }, finish_reason: "stop" }),
      ],
      [
        new OllamaClient({ maxRetries: 0 }),
        ollama({ message: { content: "ok" }, done_reason: "stop" }),
      ],
    ];
    for (const [client, body] of successes) {
      fetchSpy.mockResolvedValueOnce(ok(body));
      expect((await client.complete(REQUEST)).content).toBe("ok");
    }
  });

  // Sending a refused or cut request to another provider would route around a
  // safety refusal, or pay twice for an answer cut at the same limit.
  test("RoutingClient does not fall back on an incomplete answer", async () => {
    fetchSpy.mockResolvedValueOnce(ok(anthropic({ content: [], stop_reason: "refusal" })));
    const client = new RoutingClient({
      primary: new AnthropicClient({ apiKey: "k", maxRetries: 0 }),
      fallbacks: [new OpenAIClient({ apiKey: "k", maxRetries: 0 })],
    });
    const error = await client.complete(REQUEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IncompleteResponseError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
