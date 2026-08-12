import { describe, test, expect } from "bun:test";
import { buildAnalysisUserMessage, AI_LINTER_SYSTEM_PROMPT } from "./analysis-prompt";
import type { PromptDeclaration } from "../../../ast/nodes";

function makePrompt(overrides: Partial<PromptDeclaration> = {}): PromptDeclaration {
  return {
    kind: "PromptDeclaration",
    name: "test_prompt",
    parameters: [],
    returnType: { kind: "PrimitiveType", name: "string", line: 1, column: 1 },
    sections: [],
    line: 1,
    column: 1,
    ...overrides,
  };
}

describe("buildAnalysisUserMessage", () => {
  test("includes the prompt name", () => {
    const msg = buildAnalysisUserMessage(makePrompt({ name: "classify_ticket" }));
    expect(msg).toContain("Name: classify_ticket");
  });

  test("includes typed parameters", () => {
    const prompt = makePrompt({
      parameters: [
        { kind: "Parameter", name: "ticket", type: { kind: "PrimitiveType", name: "string", line: 1, column: 1 }, line: 1, column: 1 },
        { kind: "Parameter", name: "priority", type: { kind: "PrimitiveType", name: "number", line: 1, column: 1 }, line: 1, column: 1 },
      ],
    });
    const msg = buildAnalysisUserMessage(prompt);
    expect(msg).toContain("ticket: string");
    expect(msg).toContain("priority: number");
  });

  test("includes the system section content", () => {
    const prompt = makePrompt({
      sections: [
        { kind: "MessageSection", role: "system", content: { kind: "StringLiteral", value: "You are a classifier.", isTemplate: false, line: 2, column: 1 }, line: 2, column: 1 },
      ],
    });
    const msg = buildAnalysisUserMessage(prompt);
    expect(msg).toContain("You are a classifier.");
  });

  test("includes the user section content", () => {
    const prompt = makePrompt({
      sections: [
        { kind: "MessageSection", role: "user", content: { kind: "StringLiteral", value: "Classify: {{ticket}}", isTemplate: true, line: 3, column: 1 }, line: 3, column: 1 },
      ],
    });
    const msg = buildAnalysisUserMessage(prompt);
    expect(msg).toContain("Classify: {{ticket}}");
  });

  test("shows (none) when assistant section is absent", () => {
    const msg = buildAnalysisUserMessage(makePrompt());
    expect(msg).toContain("Assistant section (if any):\n(none)");
  });

  test("includes assistant section when present", () => {
    const prompt = makePrompt({
      sections: [
        { kind: "MessageSection", role: "assistant", content: { kind: "StringLiteral", value: "Sure, here is the result:", isTemplate: false, line: 4, column: 1 }, line: 4, column: 1 },
      ],
    });
    const msg = buildAnalysisUserMessage(prompt);
    expect(msg).toContain("Sure, here is the result:");
  });

  test("enum return type is rendered as pipe-separated values", () => {
    const prompt = makePrompt({
      returnType: { kind: "EnumType", values: ["bug", "feature", "question"], line: 1, column: 1 },
    });
    const msg = buildAnalysisUserMessage(prompt);
    expect(msg).toContain('"bug" | "feature" | "question"');
  });

  test("struct return type is rendered with field names", () => {
    const prompt = makePrompt({
      returnType: {
        kind: "StructType",
        fields: [
          { kind: "Field", name: "id", optional: false, type: { kind: "PrimitiveType", name: "number", line: 1, column: 1 }, line: 1, column: 1 },
          { kind: "Field", name: "label", optional: true, type: { kind: "PrimitiveType", name: "string", line: 1, column: 1 }, line: 1, column: 1 },
        ],
        line: 1,
        column: 1,
      },
    });
    const msg = buildAnalysisUserMessage(prompt);
    expect(msg).toContain("id: number");
    expect(msg).toContain("label?: string");
  });

  test("AI_LINTER_SYSTEM_PROMPT mentions all six categories", () => {
    const categories = [
      "VAGUE_INSTRUCTIONS",
      "MISSING_FORMAT_SPEC",
      "CONFLICTING_INSTRUCTIONS",
      "UNDEFINED_TERMS",
      "POTENTIAL_HALLUCINATION_RISK",
      "TOKEN_INEFFICIENCY",
    ];
    for (const cat of categories) {
      expect(AI_LINTER_SYSTEM_PROMPT).toContain(cat);
    }
  });
});
