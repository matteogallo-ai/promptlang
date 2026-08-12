import { describe, test, expect } from "bun:test";
import { parseAiResponse } from "./issue-parser";
import type { PromptDeclaration } from "../../ast/nodes";

const PROMPT: PromptDeclaration = {
  kind: "PromptDeclaration",
  name: "classify_ticket",
  parameters: [],
  returnType: { kind: "PrimitiveType", name: "string", line: 1, column: 1 },
  sections: [],
  line: 5,
  column: 1,
};

const FILE = "src/classify-ticket.prompt";

describe("parseAiResponse", () => {
  test("parses valid JSON with zero issues", () => {
    const result = parseAiResponse('{"issues": []}', PROMPT, FILE);
    expect(result).toHaveLength(0);
  });

  test("parses valid JSON with one issue", () => {
    const raw = JSON.stringify({
      issues: [
        {
          category: "VAGUE_INSTRUCTIONS",
          prompt_name: "classify_ticket",
          location: "system",
          excerpt: "be very careful",
          message: "Non-actionable instruction without concrete criteria.",
          suggestion: "Specify exact fallback behavior.",
          confidence: "high",
        },
      ],
    });
    const result = parseAiResponse(raw, PROMPT, FILE);
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("ai:vague-instructions");
    expect(result[0].severity).toBe("warning");
    expect(result[0].message).toContain("[system]");
    expect(result[0].suggestion).toBe("Specify exact fallback behavior.");
  });

  test("parses valid JSON with multiple issues", () => {
    const raw = JSON.stringify({
      issues: [
        { category: "VAGUE_INSTRUCTIONS", prompt_name: "p", location: "system", excerpt: "x", message: "m1", suggestion: "s1", confidence: "high" },
        { category: "MISSING_FORMAT_SPEC", prompt_name: "p", location: "user", excerpt: "y", message: "m2", suggestion: "s2", confidence: "medium" },
        { category: "TOKEN_INEFFICIENCY", prompt_name: "p", location: "user", excerpt: "z", message: "m3", suggestion: "s3", confidence: "low" },
      ],
    });
    const result = parseAiResponse(raw, PROMPT, FILE);
    expect(result).toHaveLength(3);
    expect(result[0].rule).toBe("ai:vague-instructions");
    expect(result[1].rule).toBe("ai:missing-format-spec");
    expect(result[2].rule).toBe("ai:token-inefficiency");
  });

  test("strips markdown fences before parsing", () => {
    const raw = "```json\n{\"issues\": []}\n```";
    const result = parseAiResponse(raw, PROMPT, FILE);
    expect(result).toHaveLength(0);
  });

  test("strips case-insensitive markdown fences", () => {
    const raw = "```JSON\n{\"issues\": []}\n```";
    const result = parseAiResponse(raw, PROMPT, FILE);
    expect(result).toHaveLength(0);
  });

  test("returns parse-failure issue on malformed JSON", () => {
    const result = parseAiResponse("not json at all {{", PROMPT, FILE);
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe("ai:parse-failure");
    expect(result[0].severity).toBe("info");
    expect(result[0].message).toContain("classify_ticket");
    expect(result[0].file).toBe(FILE);
    expect(result[0].line).toBe(5);
  });

  test("returns empty array when issues field is missing", () => {
    const result = parseAiResponse('{"other": "data"}', PROMPT, FILE);
    expect(result).toHaveLength(0);
  });

  test("category with underscores is converted to kebab-case in rule", () => {
    const raw = JSON.stringify({
      issues: [
        { category: "POTENTIAL_HALLUCINATION_RISK", prompt_name: "p", location: "user", excerpt: "x", message: "m", suggestion: "s", confidence: "high" },
      ],
    });
    const result = parseAiResponse(raw, PROMPT, FILE);
    expect(result[0].rule).toBe("ai:potential-hallucination-risk");
  });

  test("suggestion is preserved in the result", () => {
    const suggestion = "Add: Respond with valid JSON only, no explanation.";
    const raw = JSON.stringify({
      issues: [
        { category: "MISSING_FORMAT_SPEC", prompt_name: "p", location: "output", excerpt: "x", message: "m", suggestion, confidence: "medium" },
      ],
    });
    const result = parseAiResponse(raw, PROMPT, FILE);
    expect(result[0].suggestion).toBe(suggestion);
  });

  test("confidence high maps to severity warning", () => {
    const raw = JSON.stringify({
      issues: [{ category: "VAGUE_INSTRUCTIONS", prompt_name: "p", location: "system", excerpt: "x", message: "m", suggestion: "s", confidence: "high" }],
    });
    expect(parseAiResponse(raw, PROMPT, FILE)[0].severity).toBe("warning");
  });

  test("confidence medium maps to severity warning", () => {
    const raw = JSON.stringify({
      issues: [{ category: "VAGUE_INSTRUCTIONS", prompt_name: "p", location: "system", excerpt: "x", message: "m", suggestion: "s", confidence: "medium" }],
    });
    expect(parseAiResponse(raw, PROMPT, FILE)[0].severity).toBe("warning");
  });

  test("confidence low maps to severity info", () => {
    const raw = JSON.stringify({
      issues: [{ category: "VAGUE_INSTRUCTIONS", prompt_name: "p", location: "system", excerpt: "x", message: "m", suggestion: "s", confidence: "low" }],
    });
    expect(parseAiResponse(raw, PROMPT, FILE)[0].severity).toBe("info");
  });

  test("file and line are taken from the PromptDeclaration", () => {
    const raw = JSON.stringify({
      issues: [{ category: "VAGUE_INSTRUCTIONS", prompt_name: "p", location: "system", excerpt: "x", message: "m", suggestion: "s", confidence: "high" }],
    });
    const result = parseAiResponse(raw, PROMPT, FILE);
    expect(result[0].file).toBe(FILE);
    expect(result[0].line).toBe(5);
    expect(result[0].column).toBe(1);
  });
});
