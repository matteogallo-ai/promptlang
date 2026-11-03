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

/** True when `x` is an issue the linter can report: it needs at least a string category. */
function isRawIssue(x: unknown): x is RawAiIssue {
  return typeof x === "object" && x !== null && typeof (x as RawAiIssue).category === "string";
}

/**
 * Parses the raw JSON string returned by the AI linter model into typed Issue
 * objects. Strips markdown fences if present. An answer that is not JSON, or is
 * JSON without an `issues` array of issues, is a parse-failure issue: a wrong
 * answer must not read as "no issues found".
 */
export function parseAiResponse(raw: string, prompt: PromptDeclaration, file: string): Issue[] {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "");

  const failure = (why: string): Issue[] => [
    {
      // A warning, like a request failure: the prompt was not linted.
      severity: "warning",
      rule: "ai:parse-failure",
      file,
      line: prompt.line,
      column: prompt.column,
      message: `AI linter response for prompt '${prompt.name}' ${why}. This may indicate an API issue.`,
    },
  ];

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return failure("could not be parsed as JSON");
  }
  const issues = (parsed as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues) || !issues.every(isRawIssue))
    return failure("is JSON but not an object with an array of issues");

  const severityMap: Record<string, "warning" | "info"> = {
    high: "warning",
    medium: "warning",
    low: "info",
  };

  return issues.map((rawIssue) => ({
    severity: severityMap[rawIssue.confidence] ?? "info",
    rule: `ai:${rawIssue.category.toLowerCase().replace(/_/g, "-")}`,
    file,
    line: prompt.line,
    column: prompt.column,
    message: `[${rawIssue.location}] ${rawIssue.message}`,
    suggestion: rawIssue.suggestion,
  }));
}
