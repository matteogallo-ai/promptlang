/**
 * Enforces docs/CLAIMS.md: every advertised capability is backed by a test
 * that passes, and the README never shows an unimplemented one as delivered.
 *
 * Usage: bun run scripts/check-claims.ts
 * Exit 1 when a shipped claim's test fails, is skipped or matches nothing, or
 * when the README comparison table disagrees with docs/CLAIMS.md.
 */
import { join } from "node:path";

type Status = "shipped" | "partial" | "roadmap";
const STATUSES: ReadonlySet<string> = new Set(["shipped", "partial", "roadmap"]);

export interface Claim {
  claim: string;
  status: Status;
  testFile: string | null;
  testName: string | null;
}

export interface ComparisonRow {
  feature: string;
  cell: string;
}

const EMPTY = new Set(["", "—", "-"]);

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}/.test(line.trim());
}

function stripMarkup(text: string): string {
  return text.replace(/\*\*|`/g, "").trim();
}

/** Parses the claims table. Throws on malformed rows so CI fails loudly. */
export function parseClaims(markdown: string): Claim[] {
  const rows = markdown.split("\n").filter((l) => l.trim().startsWith("|"));
  const [header, ...rest] = rows;
  if (!header || !cells(header)[0]?.startsWith("Claim")) {
    throw new Error("docs/CLAIMS.md: claims table header not found");
  }
  return rest
    .filter((l) => !isSeparator(l))
    .map((line) => {
      const [claim = "", status = "", , testFile = "", testName = ""] = cells(line);
      const name = stripMarkup(claim);
      if (!STATUSES.has(status)) {
        throw new Error(`docs/CLAIMS.md: '${name}' has unknown status '${status}'`);
      }
      const file = EMPTY.has(testFile) ? null : stripMarkup(testFile);
      const test = EMPTY.has(testName) ? null : testName;
      if (status !== "roadmap" && (file === null || test === null)) {
        throw new Error(`docs/CLAIMS.md: '${name}' is ${status} but names no test`);
      }
      return { claim: name, status: status as Status, testFile: file, testName: test };
    });
}

/** Reads the README comparison table: feature label → PromptLang (last) column. */
export function parseComparisonTable(readme: string): ComparisonRow[] {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => /^##\s+Comparison\b/.test(l));
  if (start === -1) throw new Error("README.md: '## Comparison' section not found");
  const rows: ComparisonRow[] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.trim().startsWith("|")) {
      if (inTable) break;
      continue;
    }
    if (!inTable) {
      inTable = true; // header row
      continue;
    }
    if (isSeparator(line)) continue;
    const row = cells(line);
    rows.push({ feature: stripMarkup(row[0] ?? ""), cell: stripMarkup(row[row.length - 1] ?? "") });
  }
  return rows;
}

/** Returns one message per README/CLAIMS disagreement (empty when consistent). */
export function checkConsistency(claims: Claim[], rows: ComparisonRow[]): string[] {
  const byName = new Map(claims.map((c) => [c.claim, c]));
  const errors: string[] = [];
  for (const { feature, cell } of rows) {
    if (!cell.includes("✅")) continue;
    const claim = byName.get(feature);
    if (!claim) {
      errors.push(`README shows '${feature}' as ✅ but it is not listed in docs/CLAIMS.md`);
    } else if (claim.status !== "shipped") {
      errors.push(`README shows '${feature}' as ✅ but docs/CLAIMS.md marks it ${claim.status}`);
    }
  }
  return errors;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Runs one named test; it must pass, not merely exist or be skipped. */
async function runClaimTest(repoRoot: string, claim: Claim): Promise<string | null> {
  const proc = Bun.spawn(
    [
      process.execPath,
      "test",
      claim.testFile!,
      "--test-name-pattern",
      escapeRegex(claim.testName!),
    ],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const output = stdout + stderr;
  const passed = Number(/^\s*(\d+) pass/m.exec(output)?.[1] ?? 0);
  if (exitCode !== 0) return `'${claim.claim}': test failed or not found (exit ${exitCode})`;
  if (passed === 0) return `'${claim.claim}': test was skipped or matched nothing`;
  return null;
}

if (import.meta.main) {
  const repoRoot = join(import.meta.dir, "..");
  const claims = parseClaims(await Bun.file(join(repoRoot, "docs/CLAIMS.md")).text());
  const rows = parseComparisonTable(await Bun.file(join(repoRoot, "README.md")).text());
  const errors = checkConsistency(claims, rows);
  for (const claim of claims.filter((c) => c.status !== "roadmap")) {
    const error = await runClaimTest(repoRoot, claim);
    console.log(`${error ? "FAIL" : "ok  "}  [${claim.status}] ${claim.claim}`);
    if (error) errors.push(error);
  }
  for (const claim of claims.filter((c) => c.status === "roadmap")) {
    console.log(`--    [roadmap] ${claim.claim}`);
  }
  if (errors.length > 0) {
    console.error(`\n${errors.join("\n")}`);
    process.exit(1);
  }
  console.log("\nclaims: consistent");
}
