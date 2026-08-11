import { describe, test, expect } from "bun:test";
import { MockClient } from "./client";
import type { PromptRequest, PromptResponse } from "./types";

const makeResponse = (content: string): PromptResponse => ({
  content,
  usage: { input_tokens: 10, output_tokens: 5 },
});

const makeRequest = (content: string): PromptRequest => ({
  model: "claude-opus-4.7",
  messages: [{ role: "user", content }],
});

// ---------------------------------------------------------------------------
// MockClient — array mode
// ---------------------------------------------------------------------------

describe("MockClient (array)", () => {
  test("returns responses in queue order", async () => {
    const client = new MockClient([makeResponse("first"), makeResponse("second")]);
    const r1 = await client.complete(makeRequest("q1"));
    const r2 = await client.complete(makeRequest("q2"));
    expect(r1.content).toBe("first");
    expect(r2.content).toBe("second");
  });

  test("throws when queue is exhausted", async () => {
    const client = new MockClient([makeResponse("only")]);
    await client.complete(makeRequest("q1"));
    await expect(client.complete(makeRequest("q2"))).rejects.toThrow(
      "MockClient: no more responses queued"
    );
  });

  test("single response is consumed", async () => {
    const client = new MockClient([makeResponse("done")]);
    const r = await client.complete(makeRequest("q"));
    expect(r.content).toBe("done");
  });

  test("response includes usage when provided", async () => {
    const client = new MockClient([makeResponse("ok")]);
    const r = await client.complete(makeRequest("q"));
    expect(r.usage?.input_tokens).toBe(10);
    expect(r.usage?.output_tokens).toBe(5);
  });

  test("empty queue throws immediately", async () => {
    const client = new MockClient([]);
    await expect(client.complete(makeRequest("q"))).rejects.toThrow(
      "MockClient: no more responses queued"
    );
  });
});

// ---------------------------------------------------------------------------
// MockClient — function mode
// ---------------------------------------------------------------------------

describe("MockClient (function)", () => {
  test("calls function with the request and returns result", async () => {
    const client = new MockClient((req) => makeResponse(`echo:${req.messages[0]?.content}`));
    const r = await client.complete(makeRequest("hello"));
    expect(r.content).toBe("echo:hello");
  });

  test("function is called for every request", async () => {
    let callCount = 0;
    const client = new MockClient(() => {
      callCount++;
      return makeResponse("ok");
    });
    await client.complete(makeRequest("a"));
    await client.complete(makeRequest("b"));
    expect(callCount).toBe(2);
  });

  test("function receives temperature from request", async () => {
    let seenTemperature: number | undefined;
    const client = new MockClient((req) => {
      seenTemperature = req.temperature;
      return makeResponse("ok");
    });
    const req: PromptRequest = { model: "m", temperature: 0.7, messages: [] };
    await client.complete(req);
    expect(seenTemperature).toBe(0.7);
  });

  test("function can return different responses based on request content", async () => {
    const client = new MockClient((req) => {
      const content = req.messages[0]?.content ?? "";
      return makeResponse(content.includes("bug") ? "bug" : "other");
    });
    const r1 = await client.complete(makeRequest("It crashes — bug"));
    const r2 = await client.complete(makeRequest("How do I do X?"));
    expect(r1.content).toBe("bug");
    expect(r2.content).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// Type shape tests
// ---------------------------------------------------------------------------

describe("PromptRequest type shape", () => {
  test("minimal request with model and messages is valid", () => {
    const req: PromptRequest = { model: "gpt-4o", messages: [] };
    expect(req.model).toBe("gpt-4o");
  });

  test("optional temperature and max_tokens can be omitted", () => {
    const req: PromptRequest = { model: "m", messages: [] };
    expect(req.temperature).toBeUndefined();
    expect(req.max_tokens).toBeUndefined();
  });

  test("message roles are typed correctly", () => {
    const req: PromptRequest = {
      model: "m",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
        { role: "assistant", content: "ast" },
      ],
    };
    expect(req.messages).toHaveLength(3);
  });
});
