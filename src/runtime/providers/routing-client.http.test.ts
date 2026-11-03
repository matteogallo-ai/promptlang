import { describe, expect, test } from "bun:test";
import { fetchSpy, useFetchSpy } from "../../../tests/support/fetch-spy";
import { InvalidRequestError } from "../errors";
import { AnthropicClient } from "./anthropic-client";
import { OpenAIClient } from "./openai-client";
import { RoutingClient } from "./routing-client";

// The routing rule meets the status mapping here: each case is a real answer
// from the first provider, read by its real client.
useFetchSpy();

const openAiOk = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: "from openai" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200 }
  );

const status = (code: number) => () =>
  new Response(JSON.stringify({ error: { message: "no" } }), { status: code });

function routing(): RoutingClient {
  return new RoutingClient({
    primary: new AnthropicClient({ apiKey: "anthropic-test-key", maxRetries: 0, timeout: 50 }),
    fallbacks: [new OpenAIClient({ apiKey: "openai-test-key", maxRetries: 0 })],
  });
}

const request = { model: "claude-haiku-5-5", messages: [{ role: "user" as const, content: "hi" }] };

describe("RoutingClient over the HTTP clients — which answers fall back", () => {
  const fallingBack: Array<[string, () => Promise<Response>]> = [
    ["a 404 (unknown model or endpoint)", async () => status(404)()],
    ["a 503", async () => status(503)()],
    ["a 429", async () => status(429)()],
    ["a non-JSON 200 body", async () => new Response("<html>", { status: 200 })],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "a timeout",
      (_url?: unknown, init?: RequestInit) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          )
        ),
    ],
  ];
  for (const [name, first] of fallingBack) {
    test(`${name} from Anthropic is sent to OpenAI`, async () => {
      fetchSpy.mockImplementationOnce(first).mockResolvedValueOnce(openAiOk());
      const response = await routing().complete(request);
      expect(response.content).toBe("from openai");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  }

  test("a 400 from Anthropic is thrown and OpenAI never receives the request", async () => {
    fetchSpy.mockResolvedValueOnce(status(400)());
    await expect(routing().complete(request)).rejects.toBeInstanceOf(InvalidRequestError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
