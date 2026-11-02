import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { LexerError } from "../../lexer/errors";
import { tokenize } from "../../lexer/lexer";
import { ParserError } from "../../parser/errors";
import { parse } from "../../parser/parser";
import { checkFile, type FileCheck } from "../../semver/check";
import { formatChange } from "../../semver/interface";
import { resolveFiles } from "../files";
import { UsageError } from "../usage-error";

/** Exit codes: 0 every file is versioned correctly, 1 a violation, 2 a usage or git problem. */
const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_USAGE = 2;

function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    ok: proc.exitCode === 0,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function gitOrThrow(cwd: string, args: string[]): string {
  const r = git(cwd, args);
  if (!r.ok) throw new UsageError(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

/** origin/main when it exists, otherwise the most recent tag reachable from HEAD. */
function defaultBase(cwd: string): string {
  if (git(cwd, ["rev-parse", "--verify", "--quiet", "origin/main^{commit}"]).ok)
    return "origin/main";
  const tag = git(cwd, ["describe", "--tags", "--abbrev=0"]);
  if (tag.ok) return tag.stdout.trim();
  throw new UsageError(
    "no --base given, and neither origin/main nor a tag exists to compare against"
  );
}

/** `file` as a POSIX path from the repository top; symlinks resolved on both sides. */
function repoPath(top: string, cwd: string, file: string): string {
  const path = relative(realpathSync(top), realpathSync(resolve(cwd, file)));
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new UsageError(`${file} is outside the Git repository (${top})`);
  }
  return path.split("\\").join("/");
}

/**
 * Rename candidates Git finds between `commit` and the index or working tree:
 * new path → old path. Git's default 50% similarity misses a small .prompt file
 * renamed and edited at once, so the threshold is low, and `followRename` keeps
 * a pairing only when the two files share a declaration name. `-z` keeps
 * non-ASCII paths unquoted.
 */
function renames(cwd: string, commit: string): Map<string, string> {
  const map = new Map<string, string>();
  const fields = gitOrThrow(cwd, ["diff", "-z", "--name-status", "-M30%", commit, "--"]).split(
    "\0"
  );
  for (let i = 0; i < fields.length; ) {
    const status = fields[i++] ?? "";
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = fields[i++];
      const to = fields[i++];
      if (status.startsWith("R") && from && to) map.set(to, from);
    } else i++;
  }
  return map;
}

/** Names of the prompts and chains a file declares, or none if it does not parse. */
function declarationNames(text: string): Set<string> {
  try {
    const program = parse(tokenize(text));
    return new Set(
      program.declarations.flatMap((d) =>
        d.kind === "PromptDeclaration" || d.kind === "ChainDeclaration" ? [d.name] : []
      )
    );
  } catch (error) {
    // A file that does not parse shares nothing; checkFile reports its syntax error.
    if (error instanceof LexerError || error instanceof ParserError) return new Set();
    throw error;
  }
}

/** The base text to compare `path` with: its own, or its old path's when it is a real rename. */
function baseTextOf(
  cwd: string,
  commit: string,
  path: string,
  current: string,
  renamed: Map<string, string>
): string | null {
  const own = textAt(cwd, commit, path);
  if (own !== null) return own;
  const from = renamed.get(path);
  if (!from) return null;
  const old = textAt(cwd, commit, from);
  if (old === null) return null;
  const now = declarationNames(current);
  return [...declarationNames(old)].some((n) => now.has(n)) ? old : null;
}

/**
 * The file's text at `commit`, or null when the path does not exist there. Any
 * other `git show` failure is an error: reading it as "new" would let a
 * breaking change pass.
 */
function textAt(cwd: string, commit: string, path: string): string | null {
  const r = git(cwd, ["show", `${commit}:${path}`]);
  if (r.ok) return r.stdout;
  // --full-tree: `path` is relative to the top, whatever the cwd.
  const listed = gitOrThrow(cwd, [
    "ls-tree",
    "--full-tree",
    "-z",
    "--name-only",
    commit,
    "--",
    path,
  ]).replace(/\0/g, "");
  if (listed === "") return null;
  throw new UsageError(`cannot read ${path} at ${commit.slice(0, 12)}: ${r.stderr.trim()}`);
}

function parseArgs(args: string[]): { base?: string; json: boolean; paths: string[] } {
  const out: { base?: string; json: boolean; paths: string[] } = { json: false, paths: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") out.json = true;
    else if (a === "--base") {
      const v = args[++i];
      if (!v || v.startsWith("--")) throw new UsageError("--base requires a git ref");
      out.base = v;
    } else if (a.startsWith("--")) throw new UsageError(`unknown flag '${a}'`);
    else out.paths.push(a);
  }
  return out;
}

function printHuman(base: string, commit: string, results: FileCheck[]): void {
  console.log(`semver-check against ${base} (${commit.slice(0, 12)})`);
  for (const r of results) {
    const versions = `${r.baseVersion ?? "(none)"} → ${r.currentVersion ?? "(none)"}`;
    if (r.status === "error") {
      console.log(`  ERROR  ${r.file}\n         ${r.error}`);
    } else if (r.status === "new") {
      console.log(`  new    ${r.file}  ${r.currentVersion ?? "(no @version)"}`);
    } else if (r.status === "ok") {
      const note = r.required === "none" ? "no interface or text change" : `${r.required} required`;
      console.log(`  ok     ${r.file}  ${versions}  (${note})`);
    } else {
      console.log(`  FAIL   ${r.file}  ${versions}`);
      console.log(`         ${r.required} bump required: ${r.reason}`);
      for (const c of r.changes ?? []) console.log(`         - ${formatChange(c)}`);
    }
  }
  const failed = results.filter((r) => r.status === "fail" || r.status === "error").length;
  console.log(
    failed === 0 ? "\nall files versioned correctly" : `\n${failed} file(s) need attention`
  );
}

/**
 * `promptlang semver-check [paths] [--base <ref>] [--json]`: compares every
 * `.prompt` file with its version at `ref` and fails when `@version` does not
 * move by at least what the interface changes require.
 */
export async function runSemverCheck(args: string[], cwd = process.cwd()): Promise<number> {
  let opts: ReturnType<typeof parseArgs>;
  let base: string;
  let commit: string;
  let top: string;
  try {
    opts = parseArgs(args);
    top = gitOrThrow(cwd, ["rev-parse", "--show-toplevel"]).trim();
    base = opts.base ?? defaultBase(cwd);
    commit = gitOrThrow(cwd, ["rev-parse", "--verify", `${base}^{commit}`]).trim();
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Error: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
  }

  const results: FileCheck[] = [];
  try {
    const files =
      opts.paths.length > 0
        ? (await resolveFiles(opts.paths.map((p) => resolve(cwd, p)))).map((f) => relative(cwd, f))
        : gitOrThrow(cwd, [
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
            "*.prompt",
          ])
            .split("\0")
            .filter(Boolean);
    const renamed = renames(cwd, commit);
    for (const file of files.sort()) {
      const current = Bun.file(resolve(cwd, file));
      // `ls-files --cached` still lists a file deleted from the working tree.
      if (!(await current.exists())) continue;
      const path = repoPath(top, cwd, file);
      const text = await current.text();
      results.push(checkFile(file, baseTextOf(cwd, commit, path, text, renamed), text));
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Error: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
  }

  const ok = results.every((r) => r.status === "ok" || r.status === "new");
  if (opts.json) console.log(JSON.stringify({ base, commit, ok, files: results }, null, 2));
  else printHuman(base, commit, results);
  return ok ? EXIT_OK : EXIT_VIOLATION;
}
