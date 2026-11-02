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
  usage error. A file Git sees as renamed since the base (similarity ≥ 30%) is
  compared with its old path. A file absent at the base is `new` and passes; a
  failure to read a file that does exist at the base is an error, never `new`. A
  deleted file is not reported, because there is no `@version` left to bump.
- **Known limit.** A rename combined with a rewrite below 30% similarity reads as a
  deleted file plus a `new` one, so its interface changes are not checked.
- **Judging a bump.** The required level is the strictest change (ADR 0002). The
  actual bump is the first of MAJOR, MINOR, PATCH that differs; a lower version is
  a downgrade and fails. Pre-release and build metadata are ignored, so
  `1.0.0-rc.1 → 1.0.0` is not a bump. Below 1.0.0 a minor bump counts as major and
  a patch bump as minor, matching how `^0.y.z` ranges resolve: what the check
  accepts is what consumers' `requires` ranges accept.
- **Failure output** names the file, both versions, the required level, the
  smallest passing version, and every change with its level. `--json` emits the
  same data. Exit 1 on any violation or unparsable file.
- **CI** runs it on `docs/examples` against the PR base, or the pushed-over commit,
  falling back to the merge-base with `origin/main` like the commits job.

## Rejected

- **Comparing against the last tag only.** Tags are cut by the human; between two
  tags, every PR would be judged against a stale base and could not see that an
  earlier PR in the same release already bumped major.
- **Requiring a bump for deleted files.** Impossible to express in-file; whoever
  deletes a published prompt has to communicate it in the changelog.
- **Treating pre-release graduation as a bump.** `1.0.0-rc.1 → 1.0.0` changes no
  precedence class a `^1.0.0` consumer cares about, and changes made during the
  rc should have been versioned within it.
