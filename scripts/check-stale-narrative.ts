/**
 * Fails when shipped code or docs talk about the future: "coming in v0.2",
 * sprint IDs, or TODOs with no issue to track them. Such text goes stale the
 * moment it is merged, and readers take it as a statement about the code.
 *
 * Usage: bun run scripts/check-stale-narrative.ts
 * Output: one `file:line: kind: excerpt` per finding; exit 1 when any exist.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export type FindingKind =
  | "implementation-coming"
  | "future-version"
  | "future-tense"
  | "sprint"
  | "todo-without-issue";

export interface Finding {
  file: string;
  line: number;
  kind: FindingKind;
  excerpt: string;
}

const VERSION = String.raw`v?\d+(?:\.(?:\d+|x))*\+?`;

const PATTERNS: ReadonlyArray<{ kind: FindingKind; regex: RegExp }> = [
  { kind: "implementation-coming", regex: /\bimplementation (?:is )?coming\b/i },
  {
    kind: "future-version",
    regex: new RegExp(
      String.raw`\b(?:coming|lands?|landing|planned|scheduled|deferred|moved|due|ships?|shipping)\s+(?:in|to|for)\s+(?:a\s+)?(?:post-)?${VERSION}`,
      "i"
    ),
  },
  { kind: "future-version", regex: /\bpost-v?\d+(?:\.\d+)*/i },
  // "requires the v0.6 engine": a feature gated on a release of this project.
  { kind: "future-version", regex: /\b(?:requires?|needs?)\s+(?:the\s+)?v\d+(?:\.\d+)*\b/i },
  { kind: "future-version", regex: /\bv\d+(?:\.\d+)*\+/ },
  {
    kind: "future-version",
    regex: /\bwill be (?:published|added|implemented|released|supported|available)\b/i,
  },
  { kind: "future-version", regex: /\bonce\b.*\b(?:is|are) (?:published|released|shipped)\b/i },
  // Only verbs about the project's own future: "the call will fail" describes
  // runtime behaviour and is not stale.
  {
    kind: "future-tense",
    regex: /\bwill (?:add|support|ship|land|implement|introduce|provide|allow|enable)\b/i,
  },
  { kind: "future-tense", regex: /\bcoming soon\b|\bplanned for\b|\bsoon\.?$/i },
  { kind: "future-tense", regex: /\b(?:not|no)\b[^.]*\byet\b/i },
  { kind: "sprint", regex: /\bsprints?\b/i },
  { kind: "sprint", regex: /\bS\d+\.\d+\b/ },
  {
    kind: "sprint",
    regex:
      /\b(?:lands?|landing|ships?|due|coming|scheduled|planned|deferred)\s+(?:in|to|for)\s+S\d+\b/i,
  },
  { kind: "todo-without-issue", regex: /\b(?:TODO|FIXME|XXX)\b(?!\(#\d+\))/ },
];

/**
 * Scans one file's text. Reports at most one finding per line, using the first
 * matching pattern, so one stale sentence yields one actionable line of output.
 */
export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = PATTERNS.find(({ regex }) => regex.test(line));
    if (match) findings.push({ file, line: i + 1, kind: match.kind, excerpt: line.trim() });
  }
  return findings;
}

/** Repository paths that describe shipped behaviour. */
const ROOTS = ["src", "docs", "README.md"];
/** History and the standard itself legitimately quote the forbidden phrases. */
const EXCLUDED = new Set(["docs/ENGINEERING_STANDARDS.md", "CHANGELOG.md"]);

const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) yield* walk(path);
    } else {
      yield path;
    }
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  );
}

async function listTargets(repoRoot: string): Promise<string[]> {
  const roots = [...ROOTS];
  for (const pkg of await readdir(join(repoRoot, "packages"), { withFileTypes: true })) {
    if (pkg.isDirectory()) roots.push(join("packages", pkg.name, "src"));
  }
  const files = new Set<string>();
  for (const root of roots) {
    const abs = join(repoRoot, root);
    if (!(await exists(abs))) continue;
    if ((await stat(abs)).isDirectory()) {
      for await (const f of walk(abs)) files.add(f);
    } else {
      files.add(abs);
    }
  }
  // .prompt files are shipped examples wherever they live, comments included.
  for await (const f of walk(repoRoot)) if (f.endsWith(".prompt")) files.add(f);
  return [...files]
    .map((f) => relative(repoRoot, f).split(sep).join("/"))
    .filter((f) => !EXCLUDED.has(f))
    .sort();
}

/** Scans the repository and returns every finding, sorted by path. */
export async function scanRepository(repoRoot: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const file of await listTargets(repoRoot)) {
    findings.push(...scanText(file, await readFile(join(repoRoot, file), "utf8")));
  }
  return findings;
}

if (import.meta.main) {
  const findings = await scanRepository(join(import.meta.dir, ".."));
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.kind}: ${f.excerpt}`);
  if (findings.length > 0) {
    console.error(`\n${findings.length} stale-narrative finding(s).`);
    process.exit(1);
  }
  console.log("stale-narrative: clean");
}
