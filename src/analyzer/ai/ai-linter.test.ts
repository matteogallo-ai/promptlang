import { describe, test, expect } from "bun:test";
import { AiLinter } from "./ai-linter";
import type { AnalysisContext } from "../analyzer";
import type { PromptClient, PromptRequest, PromptResponse } from "../../runtime";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(issues: unknown[]): PromptResponse {
  return { content: JSON.stringify({ issues }) };
}

class SequentialMockClient implements PromptClient {
  private queue: PromptResponse[];
  constructor(responses: PromptResponse[]) {
    this.queue = [...responses];
  }
  async complete(_req: PromptRequest): Promise<PromptResponse> {
    const next = this.queue.shift();
    if (!next) throw new Error("MockClient: no more responses");
    return next;
  }
}

class FailingMockClient implements PromptClient {
  async complete(_req: PromptRequest): Promise<PromptResponse> {
    throw new Error("rate_limit_error: Too many requests");
  }
}

function makeContext(prompts: Array<{ name: string; systemContent?: string }>): AnalysisContext {
  return {
    file: "test.prompt",
    ast: {
      kind: "Program",
      metadata: [],
      declarations: prompts.map((p) => ({
        kind: "PromptDeclaration" as const,
        name: p.name,
        parameters: [],
        returnType: { kind: "PrimitiveType" as const, name: "string" as const, line: 1, column: 1 },
        sections: p.systemContent
          ? [
              {
                kind: "MessageSection" as const,
                role: "system" as const,
                content: { kind: "StringLiteral" as const, value: p.systemContent, isTemplate: false, line: 2, column: 1 },
                line: 2,
                column: 1,
              },
            ]
          : [],
        line: 1,
        column: 1,
      })),
      line: 1,
      column: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AiLinter", () => {
  test("analyzes a single prompt with 0 issues", async () => {
    const client = new SequentialMockClient([makeResponse([])]);
    const linter = new AiLinter({ client });
    const issues = await linter.analyze([makeContext([{ name: "greet" }])]);
    expect(issues).toHaveLength(0);
  });

  test("analyzes a single prompt with 1 vague-instruction issue", async () => {
    const client = new SequentialMockClient([
      makeResponse([
        { category: "VAGUE_INSTRUCTIONS", prompt_name: "greet", location: "system", excerpt: "be nice", message: "Non-actionable.", suggestion: "Define criteria.", confidence: "high" },
      ]),
    ]);
    const linter = new AiLinter({ client });
    const issues = await linter.analyze([makeContext([{ name: "greet" }])]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("ai:vague-instructions");
    expect(issues[0].severity).toBe("warning");
  });

  test("analyzes a single prompt with multiple issues", async () => {
    const client = new SequentialMockClient([
      makeResponse([
        { category: "VAGUE_INSTRUCTIONS", prompt_name: "p", location: "system", excerpt: "a", message: "m1", suggestion: "s1", confidence: "high" },
        { category: "MISSING_FORMAT_SPEC", prompt_name: "p", location: "user", excerpt: "b", message: "m2", suggestion: "s2", confidence: "medium" },
      ]),
    ]);
    const linter = new AiLinter({ client });
    const issues = await linter.analyze([makeContext([{ name: "p" }])]);
    expect(issues).toHaveLength(2);
  });

  test("analyzes 3 prompts with concurrency=2", async () => {
    const client = new SequentialMockClient([
      makeResponse([]),
      makeResponse([]),
      makeResponse([{ category: "TOKEN_INEFFICIENCY", prompt_name: "c", location: "user", excerpt: "x", message: "m", suggestion: "s", confidence: "low" }]),
    ]);
    const linter = new AiLinter({ client, concurrency: 2 });
    const ctx = makeContext([{ name: "a" }, { name: "b" }, { name: "c" }]);
    const issues = await linter.analyze([ctx]);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("ai:token-inefficiency");
  });

  test("confidence high → severity warning", async () => {
    const client = new SequentialMockClient([
      makeResponse([{ category: "VAGUE_INSTRUCTIONS", prompt_name: "p", location: "system", excerpt: "x", message: "m", suggestion: "s", confidence: "high" }]),
    ]);
    const linter = new AiLinter({ client });
    const issues = await linter.analyze([makeContext([{ name: "p" }])]);
    expect(issues[0].severity).toBe("warning");
  });

  test("confidence medium → severity warning", async () => {
    const client = new SequentialMockClient([
      makeResponse([{ category: "CONFLICTING_INSTRUCTIONS", prompt_name: "p", location: "user", excerpt: "x", message: "m", suggestion: "s", confidence: "medium" }]),
    ]);
    const linter = new AiLinter({ client });
    const issues = await linter.analyze([makeContext([{ name: "p" }])]);
    expect(issues[0].severity).toBe("warning");
  });

  test("confidence low → severity info", async () => {
    const client = new SequentialMockClient([
      makeResponse([{ category: "TOKEN_INEFFICIENCY", prompt_name: "p", location: "user", excerpt: "x", message: "m", suggestion: "s", confidence: "low" }]),
    ]);
    const linter = new AiLinter({ client });
    const issues = await linter.analyze([makeContext([{ name: "p" }])]);
    expect(issues[0].severity).toBe("info");
  });

  test("rule is prefixed with ai:", async () => {
    const client = new SequentialMockClient([
      makeResponse([{ category: "UNDEFINED_TERMS", prompt_name: "p", location: "system", excerpt: "x", message: "m", suggestion: "s", confidence: "high" }]),
    ]);
    const linter = new AiLinter({ client });
    const issues = await linter.analyze([makeContext([{ name: "p" }])]);
    expect(issues[0].rule.startsWith("ai:")).toBe(true);
  });

  test("onProgress callback is called for each batch", async () => {
    const client = new SequentialMockClient([
      makeResponse([]),
      makeResponse([]),
      makeResponse([]),
    ]);
    const progress: Array<[number, number]> = [];
    const linter = new AiLinter({
      client,
      concurrency: 2,
      onProgress: (current, total) => progress.push([current, total]),
    });
    const ctx = makeContext([{ name: "a" }, { name: "b" }, { name: "c" }]);
    await linter.analyze([ctx]);
    // 2 batches: [2,3] then [3,3]
    expect(progress).toHaveLength(2);
    expect(progress[0]).toEqual([2, 3]);
    expect(progress[1]).toEqual([3, 3]);
  });

  test("failing client for one prompt does not stop others", async () => {
    let callCount = 0;
    const mixedClient: PromptClient = {
      async complete(_req) {
        callCount++;
        if (callCount === 1) throw new Error("rate_limit");
        return makeResponse([]);
      },
    };
    const linter = new AiLinter({ client: mixedClient, concurrency: 1 });
    const ctx = makeContext([{ name: "bad" }, { name: "ok" }]);
    const issues = await linter.analyze([ctx]);
    // The failing prompt is skipped, no crash, 0 issues from the successful one
    expect(issues).toHaveLength(0);
    expect(callCount).toBe(2);
  });

  test("throws clear error when no client and ANTHROPIC_API_KEY is missing", () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new AiLinter()).toThrow("ANTHROPIC_API_KEY");
    } finally {
      if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });

  test("custom client bypasses ANTHROPIC_API_KEY check", () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => new AiLinter({ client: new FailingMockClient() })).not.toThrow();
    } finally {
      if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });

  test("returns empty array when contexts have no PromptDeclarations", async () => {
    const client = new SequentialMockClient([]);
    const linter = new AiLinter({ client });
    const ctx: AnalysisContext = {
      file: "test.prompt",
      ast: {
        kind: "Program",
        metadata: [],
        declarations: [{ kind: "TestDeclaration", description: "t", input: { kind: "Identifier", name: "x", line: 1, column: 1 }, expectations: [], line: 1, column: 1 }],
        line: 1,
        column: 1,
      },
    };
    const issues = await linter.analyze([ctx]);
    expect(issues).toHaveLength(0);
  });

  test("aggregates issues across multiple files", async () => {
    const client = new SequentialMockClient([
      makeResponse([{ category: "VAGUE_INSTRUCTIONS", prompt_name: "a", location: "system", excerpt: "x", message: "m1", suggestion: "s1", confidence: "high" }]),
      makeResponse([{ category: "MISSING_FORMAT_SPEC", prompt_name: "b", location: "user", excerpt: "y", message: "m2", suggestion: "s2", confidence: "medium" }]),
    ]);
    const linter = new AiLinter({ client });
    const ctx1 = makeContext([{ name: "a" }]);
    const ctx2 = { ...makeContext([{ name: "b" }]), file: "other.prompt" };
    const issues = await linter.analyze([ctx1, ctx2]);
    expect(issues).toHaveLength(2);
  });
});
