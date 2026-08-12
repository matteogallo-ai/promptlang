import type { Issue } from "./analyzer";
import { RESET, BOLD, DIM, RED, YELLOW, BLUE, CYAN, WHITE } from "../cli/output";

const GREEN = "\x1b[32m";

export interface DeclarationCounts {
  prompts: number;
  chains: number;
  tests: number;
  evals: number;
}

function renderIssueBlock(issue: Issue, color: string, lines: string[]): void {
  lines.push("");
  lines.push(`  ${WHITE}${issue.file}:${issue.line}${RESET}`);
  lines.push(`    ${color}[${issue.rule}]${RESET} ${issue.message}`);
  if (issue.suggestion) {
    lines.push(`    ${DIM}${issue.suggestion}${RESET}`);
  }
}

export function formatTerminalReport(
  issues: Issue[],
  counts: DeclarationCounts,
  filesAnalyzed: number
): string {
  const staticIssues = issues.filter((i) => !i.rule.startsWith("ai:"));
  const aiIssues = issues.filter((i) => i.rule.startsWith("ai:"));

  const errors = staticIssues.filter((i) => i.severity === "error");
  const warnings = staticIssues.filter((i) => i.severity === "warning");
  const infos = staticIssues.filter((i) => i.severity === "info");

  const lines: string[] = [];

  lines.push(`${BOLD}${CYAN}PromptLang Static Analysis Report${RESET}`);
  lines.push(`${DIM}${"=".repeat(35)}${RESET}`);
  lines.push("");
  lines.push(`${BOLD}Files analyzed:${RESET} ${filesAnalyzed}`);
  lines.push(`${BOLD}Prompts:${RESET}  ${counts.prompts}`);
  lines.push(`${BOLD}Chains:${RESET}   ${counts.chains}`);
  lines.push(`${BOLD}Tests:${RESET}    ${counts.tests}`);
  lines.push(`${BOLD}Evals:${RESET}    ${counts.evals}`);

  if (errors.length > 0) {
    lines.push("");
    lines.push(`${BOLD}${RED}✕  ERRORS (${errors.length})${RESET}`);
    for (const issue of errors) renderIssueBlock(issue, RED, lines);
  }

  if (warnings.length > 0) {
    lines.push("");
    lines.push(`${BOLD}${YELLOW}⚠  WARNINGS (${warnings.length})${RESET}`);
    for (const issue of warnings) renderIssueBlock(issue, YELLOW, lines);
  }

  if (infos.length > 0) {
    lines.push("");
    lines.push(`${BOLD}${BLUE}ℹ  INFO (${infos.length})${RESET}`);
    for (const issue of infos) renderIssueBlock(issue, BLUE, lines);
  }

  if (staticIssues.length === 0) {
    lines.push("");
    lines.push(`${BOLD}✓  No static issues found.${RESET}`);
  }

  if (aiIssues.length > 0) {
    lines.push("");
    lines.push(`${BOLD}${GREEN}🤖  AI-LINTER ISSUES (${aiIssues.length})${RESET}`);
    for (const issue of aiIssues) {
      const color = issue.severity === "warning" ? YELLOW : BLUE;
      renderIssueBlock(issue, color, lines);
    }
  }

  lines.push("");
  const parts: string[] = [];
  if (errors.length > 0) parts.push(`${errors.length} error${errors.length > 1 ? "s" : ""}`);
  if (warnings.length > 0) parts.push(`${warnings.length} warning${warnings.length > 1 ? "s" : ""}`);
  if (infos.length > 0) parts.push(`${infos.length} info`);
  if (aiIssues.length > 0) parts.push(`${aiIssues.length} ai`);
  if (parts.length === 0) parts.push("0 issues");
  lines.push(`${DIM}Summary: ${parts.join(", ")}. Use --strict to fail on warnings.${RESET}`);

  return lines.join("\n");
}

export function formatJsonReport(
  issues: Issue[],
  counts: DeclarationCounts,
  filesAnalyzed: number
): string {
  const staticIssues = issues.filter((i) => !i.rule.startsWith("ai:"));
  const aiIssues = issues.filter((i) => i.rule.startsWith("ai:"));

  const warnings = staticIssues.filter((i) => i.severity === "warning").length;
  const errors = staticIssues.filter((i) => i.severity === "error").length;
  const infos = staticIssues.filter((i) => i.severity === "info").length;

  function serializeIssue(i: Issue) {
    return {
      severity: i.severity,
      rule: i.rule,
      file: i.file,
      line: i.line,
      column: i.column,
      message: i.message,
      ...(i.suggestion ? { suggestion: i.suggestion } : {}),
    };
  }

  const output = {
    files_analyzed: filesAnalyzed,
    counts: {
      prompts: counts.prompts,
      chains: counts.chains,
      tests: counts.tests,
      evals: counts.evals,
    },
    issues: staticIssues.map(serializeIssue),
    ai_issues: aiIssues.map(serializeIssue),
    summary: { errors, warnings, info: infos, ai: aiIssues.length },
  };

  return JSON.stringify(output, null, 2);
}
