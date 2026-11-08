/**
 * Fails when a commit in the given range changes more than 400 lines, the limit
 * CLAUDE.md sets: a reviewer cannot read more in one sitting. Lockfiles and
 * generated artefacts do not count: nobody reviews them line by line, and their
 * generators are reviewed instead.
 *
 * Usage: bun run scripts/check-commit-size.ts <base>..<head>
 * Merge commits are skipped, as in check-commits.ts. Renames are read as a removal
 * and an addition, so each path is matched as written rather than as `{a => b}`.
 */
const LIMIT = 400;

// Written by a tool, never by hand: lockfiles, live-run records, the generated
// corpus with its labels and checksums, the review answer keys and scores, media,
// and the mutation and benchmark reports. An annotated review.csv and
// docs/mutation/survivors.md are written by a person and count.
const GENERATED = [
  /(^|\/)bun\.lock$/,
  /^runs\//,
  /(^|\/)SHA256SUMS$/,
  /^evals\/linter\/cases\//,
  /^evals\/linter\/labels\.json$/,
  /^evals\/linter\/[^/]+\/(key|score)\.json$/,
  /^docs\/media\//,
  /^docs\/mutation\/(README\.md|summary\.json)$/,
  /^docs\/benchmarks\.md$/,
];

/** Sum of added and removed lines in `git show --numstat` output; binary files (`-`) count 0. */
export function changedLines(numstat: string): number {
  let total = 0;
  for (const line of numstat.split("\n")) {
    const [added, removed, file] = line.split("\t");
    if (!file || GENERATED.some((re) => re.test(file))) continue;
    total += (Number(added) || 0) + (Number(removed) || 0);
  }
  return total;
}

export function oversized(commits: { sha: string; subject: string; lines: number }[]): string[] {
  return commits
    .filter((c) => c.lines > LIMIT)
    .map(
      (c) =>
        `${c.sha} ${c.subject}: ${c.lines} changed lines (limit ${LIMIT}, lockfiles and generated artefacts excluded)`
    );
}

function git(args: string[]): string {
  const r = Bun.spawnSync(["git", ...args]);
  if (r.exitCode !== 0) {
    console.error(r.stderr.toString());
    process.exit(2);
  }
  return r.stdout.toString();
}

if (import.meta.main) {
  const range = process.argv[2];
  if (!range) {
    console.error("usage: bun run scripts/check-commit-size.ts <base>..<head>");
    process.exit(2);
  }
  const commits = git(["log", "--no-merges", "--format=%h%x09%s", range])
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, ...rest] = l.split("\t");
      const numstat = git(["show", "--numstat", "--no-renames", "--format=", sha!]);
      return { sha: sha!, subject: rest.join("\t"), lines: changedLines(numstat) };
    });
  const bad = oversized(commits);
  for (const b of bad) console.error(b);
  if (bad.length > 0) process.exit(1);
  console.log(`commit-size: ${commits.length} commit(s) within ${LIMIT} lines`);
}
