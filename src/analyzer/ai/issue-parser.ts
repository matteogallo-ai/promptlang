import type { Issue } from "../analyzer";
import type { PromptDeclaration } from "../../ast/nodes";

interface RawAiIssue {
  category: string;
  prompt_name: string;
  location: string;
  excerpt: string;
  message: string;
  suggestion: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Parses the raw JSON string returned by Claude Haiku into typed Issue objects.
 * Strips markdown fences if present. Returns a parse-failure issue on malformed JSON.
 */
export function parseAiResponse(
  raw: string,
  prompt: PromptDeclaration,
  file: string
): Issue[] {
  const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, "");

  let parsed: { issues?: RawAiIssue[] };
  try {
    parsed = JSON.parse(cleaned) as { issues?: RawAiIssue[] };
  } catch {
    return [
      {
        severity: "info",
        rule: "ai:parse-failure",
        file,
        line: prompt.line,
        column: prompt.column,
        message: `AI linter response could not be parsed as JSON for prompt '${prompt.name}'. This may indicate an API issue.`,
      },
    ];
  }

  if (!parsed.issues || !Array.isArray(parsed.issues)) return [];

  const severityMap: Record<string, "warning" | "info"> = {
    high: "warning",
    medium: "warning",
    low: "info",
  };

  return parsed.issues.map((rawIssue) => ({
    severity: severityMap[rawIssue.confidence] ?? "info",
    rule: `ai:${rawIssue.category.toLowerCase().replace(/_/g, "-")}`,
    file,
    line: prompt.line,
    column: prompt.column,
    message: `[${rawIssue.location}] ${rawIssue.message}`,
    suggestion: rawIssue.suggestion,
  }));
}
