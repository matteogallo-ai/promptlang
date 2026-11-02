/**
 * Supply-chain rules for GitHub Actions workflows, run by tests/workflows.test.ts
 * over every file in .github/workflows/.
 */
const PINNED = /^\s*(?:-\s+)?uses:\s+[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/;
const LOCAL = /^\s*(?:-\s+)?uses:\s+\.\//;
const WRITE = /^\s+[\w-]+:\s*write\s*$/;

/**
 * Returns one message per broken rule in a workflow file:
 * - every action is pinned to a full commit SHA, followed by `# vX.Y.Z`;
 * - the workflow-level token is `contents: read` and nothing else;
 * - every job-level `write` permission has a comment line right above it saying why;
 * - no `pull_request_target`, which runs with secrets on code from forks.
 */
export function workflowViolations(file: string, text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(?:-\s+)?uses:/.test(line) && !LOCAL.test(line) && !PINNED.test(line))
      out.push(`${file}:${i + 1}: action not pinned to a full SHA with a # vX.Y.Z comment`);
    if (WRITE.test(line) && !lines[i - 1]?.trim().startsWith("#"))
      out.push(`${file}:${i + 1}: write permission without a comment saying why`);
    if (/\bwrite-all\b/.test(line)) out.push(`${file}:${i + 1}: write-all permission`);
  });
  const doc = Bun.YAML.parse(text) as { on?: unknown; permissions?: unknown };
  const perms = JSON.stringify(doc.permissions);
  if (perms !== JSON.stringify({ contents: "read" }))
    out.push(`${file}: workflow-level permissions must be { contents: read }, got ${perms}`);
  const on = doc.on;
  const events = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
  if (events.includes("pull_request_target")) out.push(`${file}: uses pull_request_target`);
  return out;
}
