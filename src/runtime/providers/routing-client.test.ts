import { describe, test, expect } from "bun:test";
import { RoutingClient } from "./routing-client";
import { AuthenticationError, AllProvidersFailedError } from "../errors";
import type { PromptClient } from "../client";
import type { PromptRequest, PromptResponse } from "../types";

// ---------------------------------------------------------------------------
// Test helpers (no fetch mocking needed — routing logic uses PromptClient objects)
// ---------------------------------------------------------------------------

function succeedingClient(content = "ok"): PromptClient {
  return {
    async complete(): Promise<PromptResponse> {
      return { content, usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
}

function failingClient(error: Error = new Error("provider failed")): PromptClient {
  return {
    async complete(): Promise<PromptResponse> {
      throw error;
    },
  };
}

const BASE_REQUEST: PromptRequest = {
  model: "m",
  messages: [{ role: "user", content: "hello" }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RoutingClient — primary succeeds", () => {
  test("returns primary response when primary succeeds", async () => {
    const client = new RoutingClient({ primary: succeedingClient("primary response") });
    const result = await client.complete(BASE_REQUEST);
    expect(result.content).toBe("primary response");
  });

  test("does not call fallback when primary succeeds", async () => {
    let fallbackCalled = false;
    const fallback: PromptClient = {
      async complete() {
        fallbackCalled = true;
        return { content: "fallback" };
      },
    };
    const client = new RoutingClient({
      primary: succeedingClient(),
      fallbacks: [fallback],
    });
    await client.complete(BASE_REQUEST);
    expect(fallbackCalled).toBe(false);
  });
});

describe("RoutingClient — fallback behavior", () => {
  test("calls fallback[0] when primary fails", async () => {
    const client = new RoutingClient({
      primary: failingClient(),
      fallbacks: [succeedingClient("fallback response")],
    });
    const result = await client.complete(BASE_REQUEST);
    expect(result.content).toBe("fallback response");
  });

  test("calls fallback[1] when primary and fallback[0] both fail", async () => {
    const client = new RoutingClient({
      primary: failingClient(),
      fallbacks: [failingClient(), succeedingClient("second fallback")],
    });
    const result = await client.complete(BASE_REQUEST);
    expect(result.content).toBe("second fallback");
  });

  test("returns the first successful response, not all", async () => {
    let thirdCalled = false;
    const third: PromptClient = {
      async complete() {
        thirdCalled = true;
        return { content: "third" };
      },
    };
    const client = new RoutingClient({
      primary: failingClient(),
      fallbacks: [succeedingClient("second"), third],
    });
    const result = await client.complete(BASE_REQUEST);
    expect(result.content).toBe("second");
    expect(thirdCalled).toBe(false);
  });

  test("works with zero fallbacks (primary only)", async () => {
    const client = new RoutingClient({ primary: succeedingClient("solo") });
    const result = await client.complete(BASE_REQUEST);
    expect(result.content).toBe("solo");
  });
});

describe("RoutingClient — AuthenticationError is never retried", () => {
  test("does not try fallbacks on AuthenticationError from primary", async () => {
    let fallbackCalled = false;
    const fallback: PromptClient = {
      async complete() {
        fallbackCalled = true;
        return { content: "ok" };
      },
    };
    const client = new RoutingClient({
      primary: failingClient(new AuthenticationError("Bad API key")),
      fallbacks: [fallback],
    });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(AuthenticationError);
    expect(fallbackCalled).toBe(false);
  });
});

describe("RoutingClient — onFallback callback", () => {
  test("onFallback called with the error from primary and index 0", async () => {
    const primaryError = new Error("primary timed out");
    const calls: Array<{ error: Error; index: number }> = [];

    const client = new RoutingClient({
      primary: failingClient(primaryError),
      fallbacks: [succeedingClient()],
      onFallback: (error, index) => calls.push({ error, index }),
    });

    await client.complete(BASE_REQUEST);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.error).toBe(primaryError);
    expect(calls[0]?.index).toBe(0);
  });

  test("onFallback called twice when two providers fail sequentially", async () => {
    const calls: number[] = [];
    const client = new RoutingClient({
      primary: failingClient(new Error("primary failed")),
      fallbacks: [
        failingClient(new Error("fallback0 failed")),
        succeedingClient("third"),
      ],
      onFallback: (_, index) => calls.push(index),
    });

    await client.complete(BASE_REQUEST);

    expect(calls).toEqual([0, 1]);
  });

  test("onFallback not called when primary succeeds", async () => {
    let called = false;
    const client = new RoutingClient({
      primary: succeedingClient(),
      fallbacks: [succeedingClient()],
      onFallback: () => { called = true; },
    });
    await client.complete(BASE_REQUEST);
    expect(called).toBe(false);
  });
});

describe("RoutingClient — AllProvidersFailedError", () => {
  test("throws AllProvidersFailedError when all providers fail", async () => {
    const client = new RoutingClient({
      primary: failingClient(new Error("p1")),
      fallbacks: [failingClient(new Error("p2")), failingClient(new Error("p3"))],
    });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  test("AllProvidersFailedError contains all individual errors", async () => {
    const e1 = new Error("p1 failed");
    const e2 = new Error("p2 failed");
    const client = new RoutingClient({
      primary: failingClient(e1),
      fallbacks: [failingClient(e2)],
    });
    const err = await client.complete(BASE_REQUEST).catch((e: unknown) => e);
    expect((err as AllProvidersFailedError).errors).toHaveLength(2);
    expect((err as AllProvidersFailedError).errors[0]).toBe(e1);
    expect((err as AllProvidersFailedError).errors[1]).toBe(e2);
  });

  test("AllProvidersFailedError with primary only (no fallbacks)", async () => {
    const client = new RoutingClient({ primary: failingClient(new Error("solo fail")) });
    const err = await client.complete(BASE_REQUEST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllProvidersFailedError);
    expect((err as AllProvidersFailedError).errors).toHaveLength(1);
  });
});
