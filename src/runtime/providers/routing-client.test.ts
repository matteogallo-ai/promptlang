import { describe, test, expect } from "bun:test";
import { RoutingClient } from "./routing-client";
import {
  AuthenticationError,
  AllProvidersFailedError,
  InvalidRequestError,
  RateLimitError,
  ServerError,
  TimeoutError,
} from "../errors";
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

/** An outage, the case fallbacks exist for. */
const outage = (message: string) => new ServerError(503, message);

function failingClient(error: Error = outage("provider failed")): PromptClient {
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
    const primaryError = outage("primary timed out");
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
      primary: failingClient(outage("primary failed")),
      fallbacks: [failingClient(outage("fallback0 failed")), succeedingClient("third")],
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
      onFallback: () => {
        called = true;
      },
    });
    await client.complete(BASE_REQUEST);
    expect(called).toBe(false);
  });
});

describe("RoutingClient — AllProvidersFailedError", () => {
  test("throws AllProvidersFailedError when all providers fail", async () => {
    const client = new RoutingClient({
      primary: failingClient(outage("p1")),
      fallbacks: [failingClient(outage("p2")), failingClient(outage("p3"))],
    });
    await expect(client.complete(BASE_REQUEST)).rejects.toBeInstanceOf(AllProvidersFailedError);
  });

  test("AllProvidersFailedError contains all individual errors", async () => {
    const e1 = outage("p1 failed");
    const e2 = outage("p2 failed");
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
    const client = new RoutingClient({ primary: failingClient(outage("solo fail")) });
    const err = await client.complete(BASE_REQUEST).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AllProvidersFailedError);
    expect((err as AllProvidersFailedError).errors).toHaveLength(1);
  });
});

describe("RoutingClient — which errors fall back", () => {
  const routeAfter = async (error: Error) => {
    let reached = false;
    const client = new RoutingClient({
      primary: failingClient(error),
      fallbacks: [
        {
          async complete() {
            reached = true;
            return { content: "fallback" };
          },
        },
      ],
    });
    const thrown = await client.complete(BASE_REQUEST).catch((e: unknown) => e);
    return { reached, thrown };
  };

  test("an outage, a rate limit or a timeout falls back", async () => {
    for (const e of [outage("down"), new RateLimitError(), new TimeoutError()])
      expect((await routeAfter(e)).reached).toBe(true);
  });

  // The request itself is wrong: another provider would get the user's data for nothing.
  test("a 400 from the provider is thrown, not sent to the next one", async () => {
    const e = new InvalidRequestError("max_tokens: unsupported");
    expect(await routeAfter(e)).toEqual({ reached: false, thrown: e });
  });

  // A bug in the caller or a client is not an outage.
  test("an error that is not a PromptClientError is thrown at once", async () => {
    const e = new TypeError("cannot read properties of undefined");
    expect(await routeAfter(e)).toEqual({ reached: false, thrown: e });
  });
});
