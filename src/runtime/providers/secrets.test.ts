import { describe, expect, test } from "bun:test";
import { fetchSpy, useFetchSpy } from "../../../tests/support/fetch-spy";
import type { PromptRequest } from "../types";
import { AnthropicClient } from "./anthropic-client";
import { OpenAIClient } from "./openai-client";

const KEY = "sk-ant-api03-SECRET-0123456789abcdef";
const REQUEST: PromptRequest = {
  model: "m",
  max_tokens: 1,
  messages: [{ role: "user", content: "hi" }],
};

const echoing = (status: number) =>
  new Response(JSON.stringify({ error: { message: `invalid x-api-key: ${KEY} (key ${KEY})` } }), {
    status,
    headers: { "content-type": "application/json" },
  });

const clients = [
  ["Anthropic", () => new AnthropicClient({ apiKey: KEY, maxRetries: 0 })],
  ["OpenAI", () => new OpenAIClient({ apiKey: KEY, maxRetries: 0 })],
] as const;

// Error messages reach the terminal, CI logs and the committed runs/live/ records,
// so a provider (or a proxy in front of it) that echoes the key must not leak it.
describe("the API key never appears in an error message", () => {
  useFetchSpy();

  for (const [name, make] of clients)
    for (const status of [400, 401, 429, 500])
      test(`${name}: an HTTP ${status} body that echoes the key`, async () => {
        fetchSpy.mockResolvedValueOnce(echoing(status));
        const error = (await make()
          .complete(REQUEST)
          .catch((e: unknown) => e)) as Error;
        expect(error).toBeInstanceOf(Error);
        expect(error.message).not.toContain(KEY);
        expect(error.message).toContain("[redacted]");
        expect(String(error.stack)).not.toContain(KEY);
      });

  test("a network error whose text holds the key", async () => {
    fetchSpy.mockRejectedValueOnce(new Error(`connect failed for Bearer ${KEY}`));
    const error = (await new OpenAIClient({ apiKey: KEY, maxRetries: 0 })
      .complete(REQUEST)
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain(KEY);
  });
});
