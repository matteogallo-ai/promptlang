import type { PromptDeclaration, TypeExpression } from "../../../ast/nodes";

/** System prompt sent to Claude Haiku for semantic analysis. */
export const AI_LINTER_SYSTEM_PROMPT = `You are a static analyzer for LLM prompts. You analyze prompts defined in a DSL called PromptLang.

Your job: detect semantic issues that static analysis cannot catch. You DO NOT verify syntax (that's already done).

Focus on these categories:
1. VAGUE_INSTRUCTIONS: non-actionable phrases ("be careful", "make it good") without concrete criteria
2. MISSING_FORMAT_SPEC: output type expects structured data but no format constraint in the prompt
3. CONFLICTING_INSTRUCTIONS: contradictory or ambiguous requirements
4. UNDEFINED_TERMS: business terms used without definition (e.g. "premium user" undefined)
5. POTENTIAL_HALLUCINATION_RISK: instruction that invites the model to guess vs refuse
6. TOKEN_INEFFICIENCY: verbose phrasing that could be shorter without loss

You respond with STRICT JSON matching this schema:
{
  "issues": [
    {
      "category": "VAGUE_INSTRUCTIONS" | "MISSING_FORMAT_SPEC" | "CONFLICTING_INSTRUCTIONS" | "UNDEFINED_TERMS" | "POTENTIAL_HALLUCINATION_RISK" | "TOKEN_INEFFICIENCY",
      "prompt_name": "classify_ticket",
      "location": "system" | "user" | "assistant" | "output",
      "excerpt": "the specific text that has the issue",
      "message": "one-sentence explanation of the issue",
      "suggestion": "concrete rewrite or fix",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

If no issues found, respond with {"issues": []}.
DO NOT include text outside the JSON. DO NOT wrap in markdown fences.`;

function typeToString(type: TypeExpression): string {
  switch (type.kind) {
    case "PrimitiveType":
      return type.name;
    case "EnumType":
      return type.values.map((v) => `"${v}"`).join(" | ");
    case "StructType":
      return `{ ${type.fields.map((f) => `${f.name}${f.optional ? "?" : ""}: ${typeToString(f.type)}`).join(", ")} }`;
    case "TypeReference":
      return type.name;
  }
}

/** Builds the user message sent to Claude Haiku for a single prompt declaration. */
export function buildAnalysisUserMessage(prompt: PromptDeclaration): string {
  const params =
    prompt.parameters.length > 0
      ? prompt.parameters.map((p) => `${p.name}: ${typeToString(p.type)}`).join(", ")
      : "(none)";

  const systemSection =
    (prompt.sections.find((s) => s.kind === "MessageSection" && s.role === "system") as
      | { kind: "MessageSection"; role: string; content: { value: string } }
      | undefined)?.content.value ?? "(none)";

  const userSection =
    (prompt.sections.find((s) => s.kind === "MessageSection" && s.role === "user") as
      | { kind: "MessageSection"; role: string; content: { value: string } }
      | undefined)?.content.value ?? "(none)";

  const assistantSection =
    (prompt.sections.find((s) => s.kind === "MessageSection" && s.role === "assistant") as
      | { kind: "MessageSection"; role: string; content: { value: string } }
      | undefined)?.content.value ?? "(none)";

  return `Analyze this prompt:

Name: ${prompt.name}
Parameters: ${params}
Return type: ${typeToString(prompt.returnType)}

System section:
${systemSection}

User section:
${userSection}

Assistant section (if any):
${assistantSection}

Respond with the JSON schema. Only issues, no other text.`;
}
