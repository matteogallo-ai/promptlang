/**
 * Fails when a tracked file tells the reader to run or install the unscoped npm
 * package `promptlang` (npx, bunx, pnpm/yarn dlx, npm exec; npm/bun/pnpm/yarn
 * install or add). That package belongs to a third party: running it downloads
 * someone else's code, and a global install puts their `promptlang` binary on
 * PATH. Our CLI is run as `npx @promptlang/core ...`, or as `promptlang` after
 * installing `@promptlang/core`.
 *
 * Usage: bun run scripts/check-unscoped-cli.ts
 * Output: one `file:line: excerpt` per finding; exit 1 when any exist.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { statOrNull } from "./lib/stat-or-null";

export interface Finding {
  file: string;
  line: number;
  excerpt: string;
}

// A runner downloads the package named by its first non-flag argument, or by -p/--package.
const RUNNER =
  /(?:^|[\s$;|&])(?:npx|pnpx|bunx|bun\s+x|pnpm\s+dlx|yarn\s+dlx|npm\s+(?:exec|x))(?=\s)/g;
// An installer takes every non-flag argument up to the end of the shell command.
const INSTALLER =
  /(?:^|[\s$;|&])(?:npm\s+(?:i|install|add)|bun\s+(?:i|install|add)|pnpm\s+(?:i|install|add)|yarn\s+(?:global\s+)?add)(?=\s)/g;
const COMMAND_END = new Set([";", "&&", "||", "|", "&"]);
// A version or tag suffix still names the third-party package.
const BARE = /^promptlang(?:@\S*)?$/;

/**
 * Markdown and HTML wrap commands in backticks, tags, links and emphasis; they are
 * replaced by spaces so the command reads as plain words.
 */
function plainWords(line: string): string {
  return line.replace(/<[^>]*>/g, " ").replace(/[`*[\]()"'>]/g, " ");
}

function tokensAfter(text: string, index: number): string[] {
  // Separators glued to a word (`core;`) still end the command.
  return text
    .slice(index)
    .replace(/&&|\|\||[;|&]/g, " $& ")
    .split(/\s+/)
    .filter(Boolean);
}

function runnerRunsBare(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (COMMAND_END.has(t)) return false;
    if (t === "-p" || t === "--package") return BARE.test(tokens[i + 1] ?? "");
    if (t.startsWith("--package=")) return BARE.test(t.slice("--package=".length));
    if (t.startsWith("-")) continue;
    return BARE.test(t);
  }
  return false;
}

function installerAddsBare(tokens: string[]): boolean {
  for (const t of tokens) {
    if (COMMAND_END.has(t)) return false;
    if (BARE.test(t.replace(/[;,.]+$/, ""))) return true;
  }
  return false;
}

export function hasUnscopedCall(line: string): boolean {
  const text = plainWords(line);
  for (const m of text.matchAll(RUNNER)) {
    if (runnerRunsBare(tokensAfter(text, m.index + m[0].length))) return true;
  }
  for (const m of text.matchAll(INSTALLER)) {
    if (installerAddsBare(tokensAfter(text, m.index + m[0].length))) return true;
  }
  return false;
}

/** A command continued with a trailing backslash is read whole and reported at its first line. */
export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const start = i;
    let command = lines[i]!;
    while (command.endsWith("\\") && i + 1 < lines.length)
      command = `${command.slice(0, -1)} ${lines[++i]}`;
    if (hasUnscopedCall(command))
      findings.push({ file, line: start + 1, excerpt: lines[start]!.trim() });
  }
  return findings;
}

/**
 * Exempt files. The audit report is published unedited, and the commands it quotes
 * were run after a local install, where npx resolves the local binary; it is named
 * so that a later report quoting a real download is still checked. This check and
 * its test quote the forbidden commands on purpose.
 */
const EXEMPT = new Set([
  "docs/audit/2026-11-03-f1-neutral-audit.md",
  "scripts/check-unscoped-cli.ts",
  "scripts/check-unscoped-cli.test.ts",
]);

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
    if (EXEMPT.has(file)) continue;
    // Tracked but deleted in the working tree: nothing left to ship or read.
    if ((await statOrNull(join(repoRoot, file))) === null) continue;
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
    console.error(`\n${findings.length} unscoped promptlang call(s); use @promptlang/core.`);
    process.exit(1);
  }
  console.log("unscoped-cli: clean");
}
