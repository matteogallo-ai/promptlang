import { describe, expect, test } from "bun:test";
import { fetchSpy, useFetchSpy } from "../../tests/support/fetch-spy";
import { createLiveClient } from "./live";

describe("createLiveClient", () => {
  useFetchSpy();

  test("makes exactly one attempt, so a retryable error is not billed again", async () => {
    fetchSpy.mockResolvedValue(new Response('{"error":{"message":"overloaded"}}', { status: 529 }));
    const client = createLiveClient("--live", { ANTHROPIC_API_KEY: "sk-test" });
    const request = {
      model: "claude-haiku-5-5",
      messages: [{ role: "user" as const, content: "x" }],
    };
    await expect(client.complete(request)).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("refuses to start without ANTHROPIC_API_KEY, naming the flag", () => {
    expect(() => createLiveClient("--ai", {})).toThrow("--ai needs ANTHROPIC_API_KEY");
  });
});
