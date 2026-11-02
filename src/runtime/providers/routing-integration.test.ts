import { describe, expect, test } from "bun:test";
import { fetchSpy, useFetchSpy } from "../../../tests/support/fetch-spy";
import { AllProvidersFailedError, AuthenticationError } from "../errors";
import { AnthropicClient } from "./anthropic-client";
import { OpenAIClient } from "./openai-client";
import { RoutingClient } from "./routing-client";

/** Anthropic → OpenAI through the real clients, with fetch mocked. */
useFetchSpy();

const REQUEST = {
  model: "claude-opus-5-5",
  messages: [{ role: "user" as const, content: "Hi" }],
};
const OPENAI_OK = JSON.stringify({
  choices: [{ message: { content: "from openai" } }],
  usage: { prompt_tokens: 2, completion_tokens: 3 },
});

function routing() {
  return new RoutingClient({
    primary: new AnthropicClient({ apiKey: "sk-ant", maxRetries: 0 }),
    fallbacks: [
      {
        client: new OpenAIClient({ apiKey: "sk-oai", maxRetries: 0 }),
        modelMap: { "claude-opus-5-5": "gpt-5" },
      },
    ],
  });
}

function sent(i: number): { url: string; model: unknown } {
  const [url, init] = fetchSpy.mock.calls[i] as [string, RequestInit];
  return { url, model: (JSON.parse(init.body as string) as { model: unknown }).model };
}

describe("RoutingClient — Anthropic to OpenAI fallback", () => {
  test("Anthropic 500 falls back to OpenAI 200, which receives its own model name", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('{"error":{"message":"boom"}}', { status: 500 }))
      .mockResolvedValueOnce(new Response(OPENAI_OK, { status: 200 }));
    const res = await routing().complete(REQUEST);
    expect(res.content).toBe("from openai");
    expect([sent(0), sent(1)]).toEqual([
      { url: "https://api.anthropic.com/v1/messages", model: "claude-opus-5-5" },
      { url: "https://api.openai.com/v1/chat/completions", model: "gpt-5" },
    ]);
  });

  test("an Anthropic 401 never reaches OpenAI", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"error":{"message":"bad key"}}', { status: 401 })
    );
    await expect(routing().complete(REQUEST)).rejects.toBeInstanceOf(AuthenticationError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("a fallback with no mapping for the requested model is skipped, not sent a Claude ID", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const err = await routing()
      .complete({ ...REQUEST, model: "claude-sonnet-5-5" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllProvidersFailedError);
    expect((err as AllProvidersFailedError).errors.map((e) => e.message)).toEqual([
      "Server error (500). The provider may be temporarily unavailable.",
      "no model mapped for 'claude-sonnet-5-5' on fallback 0",
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
