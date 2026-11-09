# Supply-chain security records

## `scorecard-before.json`: the score before

[OpenSSF Scorecard](https://github.com/ossf/scorecard) on `main` at `28c9223`, before
the supply-chain changes (Dependabot, pinned actions, CodeQL, OSV-Scanner,
Scorecard workflow). Overall score 4.8/10. Produced with:

```bash
GITHUB_AUTH_TOKEN=$(gh auth token) docker run --rm -e GITHUB_AUTH_TOKEN \
  ghcr.io/ossf/scorecard@sha256:c0a21a1c33a2d8819937d0a8a62e6f4189c800639abd9f0bfbe61c90c71fae90 \
  --repo=github.com/matteogallo-ai/promptlang --format=json --show-details
```

The image is Scorecard v5.6.0. `gcr.io/openssf/scorecard:stable` refused the pull
(registry billing error), so the same release was taken from `ghcr.io`, pinned by
digest. The file is the command's output, reformatted by Biome; the token is passed
through the environment and appears nowhere in it.

`.github/workflows/scorecard.yml` publishes the score on each push to `main` and
weekly; the README badge reads it.

## `scorecard-after.json`: the score check by check

The result published by `scorecard.yml` for `main` at `b3270b7` (2026-11-02),
read from `https://api.scorecard.dev/projects/github.com/matteogallo-ai/promptlang`:
**6.6/10**. Scorecard weighs each check (Critical 10, High 7.5, Medium 5, Low 2.5)
and leaves out the checks scored -1. The live value is the README badge; this file
records one run so that the explanations below can be checked against it.

| Check | Score | Why |
| ----- | ----- | --- |
| Binary-Artifacts | 10 | No binary file is tracked. |
| Branch-Protection | 3 | `main` has a ruleset: pull request, required checks, no force-push, no deletion. Scorecard's tiers are cumulative and the next one asks for approving reviews, which a single maintainer cannot give to their own pull requests; required checks are only counted in the tier after that, so requiring more of them leaves this at 3. |
| CI-Tests | 10 | Every merged pull request ran CI. |
| CII-Best-Practices | 0 | The project is not registered on bestpractices.dev. |
| Code-Review | 0 | Low by nature on a solo repository: Scorecard counts changesets with an approving GitHub review from someone other than their author, and there is no second maintainer. |
| Contributors | 0 | Low by nature on a solo repository: Scorecard counts the distinct companies and organizations (GitHub profile company, public org memberships) of contributors with at least 5 commits, and gives 10 at three. The only author has 4 commits, under that threshold; past it, their one company scores about 3, and more needs contributors from other organizations. |
| Dangerous-Workflow | 10 | No `pull_request_target`, and no `github.event.*` or `github.head_ref` expression inside a `run:` script; `tests/workflows.test.ts` keeps both so. |
| Dependency-Update-Tool | 10 | `.github/dependabot.yml`. |
| Fuzzing | 0 | No fuzzing or property-based tests detected at `b3270b7`; see the Fuzzing check below. |
| License | 10 | `LICENSE` is the MIT text; GitHub reports its SPDX id as `MIT`. |
| Maintained | 0 | The repository was created on 2026-08-11; Scorecard scores 0 for its first 90 days, whatever the activity. |
| Packaging | -1 | Scorecard has detected no successful run of a publishing workflow: `release.yml` has never run successfully. |
| Pinned-Dependencies | 10 | Every action is pinned by commit SHA; `tests/workflows.test.ts` keeps it so. |
| SAST | 8 | CodeQL runs on every pull request; the commits merged before it existed are still in the window Scorecard reads. |
| Security-Policy | 10 | `SECURITY.md`. |
| Signed-Releases | -1 | No GitHub Release has assets, and Scorecard skips releases without assets. |
| Token-Permissions | 10 | Workflow tokens are read-only by default; each write is per job and commented. |
| Vulnerabilities | 10 | No known vulnerability; OSV-Scanner checks `bun.lock` in CI. |

## `ruleset-main.json`: the ruleset for `main`

The `main` ruleset as applied on 2026-11-03: pull request, no force-push, no
deletion, fifteen required checks and a `code_scanning` rule. Beyond the eight checks
of the first ruleset it requires `semver-check`, `osv-scanner`, `package (node 20)`,
`package (node lts/*)`, `analyze (javascript-typescript)`, `analyze (actions)` and
`fresh-clone`; the `code_scanning` rule
blocks a merge on a CodeQL security alert of high severity or above, or on any
CodeQL alert of severity error. `tests/ruleset.test.ts`
fails if a required check is not a check that pull requests run, so a renamed job
cannot leave a check that never reports and blocks every merge. It also fails on
what would let a required check skip a pull request: a `pull_request` filter
(`paths`, `branches`, `types`…) or a job-level `if:`. A change to this file reaches
GitHub only when the maintainer applies it:

```bash
gh api -X PUT repos/matteogallo-ai/promptlang/rulesets/26384704 \
  --input docs/security/ruleset-main.json
```

## Fuzzing check

`scorecard-before.json` scores Fuzzing 0 ("project is not fuzzed"). In Scorecard v5.6.0,
`checks/raw/fuzzing.go` counts a TypeScript repository as fuzzed when a `*.ts` or `*.tsx`
file matches

```
(from\s+['"](fast-check|@fast-check/(ava|jest|vitest))['"]|require\(\s*['"](fast-check|@fast-check/(ava|jest|vitest))['"]\s*\))
```

and TypeScript is a prominent language of the repository (at least a quarter of the
average lines per language; GitHub reports TypeScript as the only one). The property
tests import `fc from "fast-check"`: `src/lexer/lexer.property.test.ts`,
`src/parser/parser.property.test.ts`, `src/semver/semver.property.test.ts`,
`packages/yaml-parser/tests/parser.property.test.ts` and `tests/support/property.ts`.
The same image run as `--local=<checkout> --checks=Fuzzing` on a checkout with these
files scores Fuzzing 10 and lists them as `TypeScriptPropertyBasedTesting` integrations
(local mode also walks untracked directories such as `node_modules`).
