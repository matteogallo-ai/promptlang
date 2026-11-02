import { relative, resolve } from "node:path";
import { checkFile, type FileCheck } from "../../semver/check";
import { formatChange } from "../../semver/interface";
import { resolveFiles } from "../files";

/** Exit codes: 0 every file is versioned correctly, 1 a violation, 2 a usage or git problem. */
const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_USAGE = 2;

class UsageError extends Error {}

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

/** The file's text at `ref`, or null when the file does not exist there. */
function textAt(cwd: string, top: string, ref: string, file: string): string | null {
  const path = relative(top, resolve(cwd, file)).split("\\").join("/");
  const r = git(cwd, ["show", `${ref}:${path}`]);
  return r.ok ? r.stdout : null;
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

  const files =
    opts.paths.length > 0
      ? (await resolveFiles(opts.paths.map((p) => resolve(cwd, p)))).map((f) => relative(cwd, f))
      : gitOrThrow(cwd, [
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "--",
          "*.prompt",
        ])
          .split("\n")
          .filter(Boolean);

  const results: FileCheck[] = [];
  for (const file of files.sort()) {
    const current = Bun.file(resolve(cwd, file));
    // `ls-files --cached` still lists a file deleted from the working tree.
    if (!(await current.exists())) continue;
    results.push(checkFile(file, textAt(cwd, top, commit, file), await current.text()));
  }

  const ok = results.every((r) => r.status === "ok" || r.status === "new");
  if (opts.json) console.log(JSON.stringify({ base, commit, ok, files: results }, null, 2));
  else printHuman(base, commit, results);
  return ok ? EXIT_OK : EXIT_VIOLATION;
}
