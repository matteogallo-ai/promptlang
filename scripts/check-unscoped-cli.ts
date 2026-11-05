/**
 * Fails when a tracked file tells the reader to run `npx promptlang` (or the
 * bunx / pnpm dlx / yarn dlx / npm exec equivalents). The unscoped npm package
 * `promptlang` belongs to a third party: without `@promptlang/core` installed
 * locally, that command downloads and runs someone else's code. Our CLI is run
 * as `npx @promptlang/core ...`, or as `promptlang` after a local install.
 *
 * Usage: bun run scripts/check-unscoped-cli.ts
 * Output: one `file:line: excerpt` per finding; exit 1 when any exist.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Finding {
  file: string;
  line: number;
  excerpt: string;
}

// Runner, then any flags (`-y`, `--yes`), then the bare package name. A scoped
// name (`@promptlang/core`) or `--package=@promptlang/core promptlang` does not match.
const UNSCOPED_RUN =
  /(?:^|[\s`'"(])(?:npx|pnpx|bunx|pnpm\s+dlx|yarn\s+dlx|npm\s+(?:exec|x))(?:\s+-{1,2}[A-Za-z][\w-]*)*\s+promptlang(?![\w@/-])/;

/**
 * Exempt paths. Audit reports are published unedited, and the commands they quote
 * were run after a local install, where `npx promptlang` resolves the local binary.
 * This check and its test quote the forbidden command on purpose.
 */
function isExempt(file: string): boolean {
  return file.startsWith("docs/audit/") || /^scripts\/check-unscoped-cli(\.test)?\.ts$/.test(file);
}

export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (UNSCOPED_RUN.test(line)) findings.push({ file, line: i + 1, excerpt: line.trim() });
  }
  return findings;
}

async function trackedFiles(repoRoot: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "ls-files", "-z"], { cwd: repoRoot, stdout: "pipe" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`git ls-files failed in ${repoRoot}`);
  return out.split("\0").filter(Boolean);
}

/** Scans every tracked text file; binary files are skipped by their NUL byte. */
export async function scanRepository(repoRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const file of await trackedFiles(repoRoot)) {
    if (isExempt(file)) continue;
    const text = await readFile(join(repoRoot, file), "utf8");
    if (text.includes("\0")) continue;
    findings.push(...scanText(file, text));
  }
  return findings;
}

if (import.meta.main) {
  const findings = await scanRepository(join(import.meta.dir, ".."));
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.excerpt}`);
  if (findings.length > 0) {
    console.error(`\n${findings.length} unscoped CLI call(s); use npx @promptlang/core.`);
    process.exit(1);
  }
  console.log("unscoped-cli: clean");
}
