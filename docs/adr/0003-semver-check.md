# ADR 0003 — How `semver-check` finds the base and judges a bump

- Status: accepted
- Date: 2026-11-02

## Context

`promptlang semver-check` must compare the current state of each `.prompt` file
with an earlier one and say whether `@version` moved enough. That needs a base,
a list of files, and a rule for what "moved enough" means.

## Decision

- **Base from Git.** `--base <ref>`, else `origin/main`, else the most recent tag
  reachable from `HEAD`; with none of these, exit 2. Base text is read with
  `git show <commit>:<path>`; the current text is the working tree, so the check
  runs before committing as well as in CI.
- **Files.** The given paths (files, directories, globs, as for `compile`), else
  every tracked or untracked-but-not-ignored `*.prompt` file. Paths are resolved
  through symlinks against the repository top; a file outside the repository is a
  usage error. A file absent at the base that Git pairs with a deleted one
  (staged rename, similarity ≥ 30%) is compared with the old path when both
  declare at least one prompt or chain of the same name; otherwise it is `new`. A file absent at the base is `new` and passes; a
  failure to read a file that does exist at the base is an error, never `new`. A
  deleted file is not reported, because there is no `@version` left to bump.
- **Known limits.** A rename combined with a rewrite below 30% similarity, or one
  that also renames every declaration, reads as a deleted file plus a `new` one, so
  its interface changes are not checked. A rename done with plain `mv` and left
  unstaged is invisible to `git diff` and reads as `new` before `git add` (CI, which
  checks commits, sees it).
- **Judging a bump.** The required level is the strictest change (ADR 0002). The
  actual bump is the first of MAJOR, MINOR, PATCH that differs. A version of lower
  precedence (`1.5.0 → 1.4.0`, `1.2.3 → 1.2.3-beta`) is a downgrade and fails, even
  when nothing else changed. Build metadata alone is not a bump. Below 1.0.0 the
  bump is read as `^` reads it: at 0.0.z every bump counts as major; at 0.y.z a
  minor bump counts as major and a patch bump as minor. What the check accepts is
  what consumers' `requires "^…"` ranges accept.
- **Pre-release cycles.** From a pre-release, moving forward to a later
  pre-release or to its release (`2.0.0-rc.1 → 2.0.0-rc.2`, `→ 2.0.0`) satisfies
  any change: SemVer 2.0.0 (item 9) makes pre-releases promise no compatibility,
  and `^` ranges do not select them. Staying on the same pre-release with a
  change fails.
- **Failure output** names the file, both versions, the required level, the
  smallest passing release (`expected`, always a version; from a pre-release the
  reason also names the later pre-releases that pass), and every change with its level. `--json` emits the
  same data. Exit 1 on any violation or unparsable file.
- **CI** runs it on `docs/examples` against the PR base, or the pushed-over commit,
  falling back to the merge-base with `origin/main` like the commits job.

## Rejected

- **Comparing against the last tag only.** Tags are cut by the human; between two
  tags, every PR would be judged against a stale base and could not see that an
  earlier PR in the same release already bumped major.
- **Requiring a bump for deleted files.** Impossible to express in-file; whoever
  deletes a published prompt has to communicate it in the changelog.
- **Ignoring pre-release identifiers.** An earlier version of this check did, so
  `2.0.0-rc.1 → 2.0.0-rc.2` with any change asked for 3.0.0: no pre-release cycle
  could pass.
