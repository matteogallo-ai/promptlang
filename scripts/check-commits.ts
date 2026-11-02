/**
 * Fails when a commit subject in the given range is not a Conventional Commit.
 *
 * Usage: bun run scripts/check-commits.ts <base>..<head>
 * Merge commits are skipped: their subjects are written by git, not by authors.
 */
const SUBJECT =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w./-]+\))?!?: \S.*$/;

/** Returns the subjects that do not match the Conventional Commits format. */
export function invalidSubjects(subjects: string[]): string[] {
  return subjects.filter((s) => !SUBJECT.test(s));
}

if (import.meta.main) {
  const range = process.argv[2];
  if (!range) {
    console.error("usage: bun run scripts/check-commits.ts <base>..<head>");
    process.exit(2);
  }
  const log = Bun.spawnSync(["git", "log", "--no-merges", "--format=%s", range]);
  if (log.exitCode !== 0) {
    console.error(log.stderr.toString());
    process.exit(2);
  }
  const subjects = log.stdout.toString().split("\n").filter(Boolean);
  const bad = invalidSubjects(subjects);
  for (const s of bad) console.error(`not a Conventional Commit: ${s}`);
  if (bad.length > 0) process.exit(1);
  console.log(`commits: ${subjects.length} subject(s) OK`);
}
