#!/usr/bin/env bun
/**
 * Runs the README's fresh-clone command, as written, in an empty directory.
 *
 *   bun run scripts/fresh-clone.ts [<repository>]
 *
 * <repository> replaces the GitHub URL in the clone (CI passes its own checkout,
 * so a pull request is tested before it is on GitHub's default branch); without
 * it the command clones from GitHub. The command then does `cd promptlang`, and
 * `git clone <path>` names the copy after the path's last component, so the
 * source directory must be named promptlang (on GitHub Actions it is). Exits
 * with the command's status.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const CLONE_URL = "https://github.com/matteogallo-ai/promptlang.git";

/** The one command between the README's fresh-clone markers. */
export function freshCloneCommand(readme: string): string {
  const m = /<!-- fresh-clone:start -->\n```bash\n([^\n]+)\n```\n<!-- fresh-clone:end -->/.exec(
    readme
  );
  if (!m) throw new Error("README.md: no single-line bash block between the fresh-clone markers");
  if (!m[1]!.startsWith(`git clone ${CLONE_URL} `))
    throw new Error(`README.md: the fresh-clone command must start with git clone ${CLONE_URL}`);
  return m[1]!;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const command = freshCloneCommand(await Bun.file(join(root, "README.md")).text());
  const source = process.argv[2];
  const run = source ? command.replace(CLONE_URL, resolve(source)) : command;
  const dir = await mkdtemp(join(tmpdir(), "promptlang-fresh-"));
  try {
    console.error(`$ ${run}   (in ${dir})`);
    const proc = Bun.spawnSync(["bash", "-euo", "pipefail", "-c", run], {
      cwd: dir,
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exitCode = proc.exitCode ?? 1;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
